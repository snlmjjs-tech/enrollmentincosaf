// Pruebas de la base de datos (supabase/schema.sql) contra un Postgres LOCAL con datos ficticios.
// Uso: PGPORT=5499 node tests/seguridad/prueba-sql.js
// Simula una actualización: la base ya tiene el esquema anterior y datos; se aplica el esquema nuevo.
const { execFileSync } = require('child_process');
const path = require('path');
const { crearRpc } = require('./rpc-local');

const RAIZ = path.resolve(__dirname, '../..');
const PUERTO = process.env.PGPORT || '5499';
const db = crearRpc({ host: '127.0.0.1', port: +PUERTO, user: 'postgres', database: 'postgres' });
const psql = archivo => execFileSync('psql', ['-h', '127.0.0.1', '-p', PUERTO, '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', archivo],
  { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

let pasadas = 0, falladas = 0;
function registrar(nombre, bien, detalle) {
  if (bien) { pasadas++; console.log(`  ✔ ${nombre}`); }
  else { falladas++; console.log(`  ✘ ${nombre}${detalle ? '  → ' + detalle : ''}`); }
}
const ok = (n, c, d) => registrar(n, !!c, d);
async function falla(nombre, promesa, patron) {
  try { const r = await promesa; registrar(nombre, false, 'no falló; devolvió ' + JSON.stringify(r)); }
  catch (e) { registrar(nombre, patron.test(e.message), 'mensaje: ' + e.message); }
}
async function funciona(nombre, promesa, verifica) {
  try { const r = await promesa; registrar(nombre, verifica ? verifica(r) : true, 'devolvió ' + JSON.stringify(r)); return r; }
  catch (e) { registrar(nombre, false, 'falló: ' + e.message); }
}
const seccion = t => console.log(`\n${t}`);

// Ficha con la misma forma que envía la página (RUT, correos y datos ficticios)
const ficha = (extra = {}, con = {}) => ({
  tipo: 'nuevo',
  estudiante: { nombre: 'Nombre Ficticio', rut: '11.111.111-1', fnac: '2012-03-15', direccion: 'Calle Falsa 123', comuna: 'San Fernando',
    nacionalidad: 'Chilena', celular: '+56 9 1234 5678', correo: '', procedencia: 'Colegio Ficticio', cursoMatricula: '',
    repitencia: 'no', repCurso: '', repAnio: '', pie: 'no', pieDiagnostico: '', pieDocumentacion: '', salud: 'no', saludDetalle: '',
    observaciones: 'Línea uno\nLínea dos', ...(extra.estudiante || {}) },
  apoderado: { nombre: 'Apoderado Ficticio', rut: '12.345.678-5', edad: '40', direccion: 'Calle Falsa 123', comuna: 'San Fernando',
    nacionalidad: 'Chilena', celular: '+56 9 8765 4321', correo: 'apoderado@example.com', parentesco: 'Madre', viveConEstudiante: 'si',
    nivelEducacional: 'Titulado de una Universidad', situacionLaboral: 'Trabaja jornada completa (todo el día)', lugarTrabajo: 'Fuera del hogar',
    ...(extra.apoderado || {}) },
  suplente: extra.suplente === undefined ? null : extra.suplente,
  ...con
});

(async () => {
  const IP_A = '198.51.100.1', IP_B = '198.51.100.2';
  const A = { ip: IP_A }, B = { ip: IP_B };

  seccion('0) Instalación: se aplica el esquema NUEVO sobre la base con el esquema ANTERIOR y datos');
  const antes = (await db.admin('select (select count(*) from public.matriculas) m, (select count(*) from public.prematriculas) p')).rows[0];
  try { psql(path.join(RAIZ, 'supabase/schema.sql')); registrar('el esquema nuevo se aplica sin errores', true); }
  catch (e) { registrar('el esquema nuevo se aplica sin errores', false, e.stderr.toString().slice(0, 400)); process.exit(1); }
  try { psql(path.join(RAIZ, 'supabase/schema.sql')); registrar('se puede ejecutar una segunda vez (idempotente)', true); }
  catch (e) { registrar('se puede ejecutar una segunda vez (idempotente)', false, e.stderr.toString().slice(0, 400)); }
  const despues = (await db.admin('select (select count(*) from public.matriculas) m, (select count(*) from public.prematriculas) p')).rows[0];
  ok('no se pierde ninguna matrícula ni pre-matrícula al actualizar', antes.m === despues.m && antes.p === despues.p, JSON.stringify({ antes, despues }));
  ok('el modo de transición queda activo (para no romper la página actual)', (await db.admin('select modo_transicion from public.config where id')).rows[0].modo_transicion === true);

  seccion('1) Las tablas y las funciones internas NO son accesibles desde el navegador (rol anon)');
  for (const t of ['matriculas', 'prematriculas', 'config', 'sesiones', 'intentos', 'auditoria'])
    await falla(`anon no puede leer public.${t}`, db.comoAnon(`select * from public.${t}`), /permission denied/);
  await falla('anon no puede leer public.matriculas aunque llame por SQL con insert', db.comoAnon(`insert into public.matriculas(folio,fecha_registro,tipo,datos) values (999,'x','nuevo','{}')`), /permission denied/);
  for (const f of ['_clave_ok', '_acceso', '_ip', '_validar_ficha', '_bloqueado', '_registrar_fallo', '_auditar', '_rol', '_rut_valido'])
    await falla(`anon no puede ejecutar la función interna ${f}`, db.comoAnon(`select pg_catalog.has_function_privilege('anon', (select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${f}' limit 1), 'execute') as x`)
      .then(r => { if (r.rows[0].x) throw new Error('anon SÍ puede ejecutarla'); throw new Error('permission denied (sin permiso, correcto)'); }), /permission denied/);
  await falla('anon no puede ejecutar limpiar_vencidos', db.rpc('limpiar_vencidos', { p_dias_prematricula: 30 }, A), /permission denied|not found|PGRST|no encontrada/i);

  seccion('2) Modo de transición: la página ACTUAL (que envía la clave directamente) sigue funcionando');
  await funciona('verificar_clave con la clave buena → true', db.rpc('verificar_clave', { p_clave: 'clave-encargados-ficticia' }, B), r => r === true);
  await funciona('verificar_clave_interna con la clave de funcionarios → true', db.rpc('verificar_clave_interna', { p_clave: 'clave-funcionarios-ficticia' }, B), r => r === true);
  await funciona('obtener_folio con la clave (formato anterior)', db.rpc('obtener_folio', { p_clave: 'clave-funcionarios-ficticia' }, B), r => Number.isInteger(r));
  const lista0 = await funciona('listar_matriculas con la clave de encargados (formato anterior)', db.rpc('listar_matriculas', { p_clave: 'clave-encargados-ficticia' }, B), r => Array.isArray(r) && r.length === 2);
  ok('las matrículas antiguas (con foto o campos faltantes) se listan igual', lista0 && lista0[0].estudiante.nombre === 'Estudiante Ficticio Uno');
  await falla('la clave de funcionarios NO abre el panel', db.rpc('listar_matriculas', { p_clave: 'clave-funcionarios-ficticia' }, B), /clave_incorrecta/);
  await funciona('cargar_prematricula con un código de 4 dígitos ya emitido (4821)', db.rpc('cargar_prematricula', { p_clave: 'clave-funcionarios-ficticia', p_codigo: '4821' }, B), r => r && r.estudiante.nombre === 'Pre Ficticio Vigente');

  seccion('3) Sesiones con token');
  const mal = await db.rpc('iniciar_sesion', { p_clave: 'incorrecta', p_rol: 'interna' }, B);
  ok('clave incorrecta → ok:false sin token', mal.ok === false && !mal.token && mal.motivo === 'clave');
  const sI = await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, B);
  ok('clave de funcionarios → token de 64 caracteres', sI.ok && /^[0-9a-f]{64}$/.test(sI.token) && sI.rol === 'interna');
  const sA = await db.rpc('iniciar_sesion', { p_clave: 'clave-encargados-ficticia', p_rol: 'admin' }, B);
  ok('clave de encargados → token de administrador', sA.ok && sA.rol === 'admin');
  const rolAdminConClaveInterna = await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'admin' }, B);
  ok('la clave de funcionarios NO da sesión de administrador', rolAdminConClaveInterna.ok === false);
  const hashes = (await db.admin('select token_hash from public.sesiones')).rows.map(r => r.token_hash);
  ok('en la base solo se guarda el hash del token, no el token', !hashes.includes(sI.token) && hashes.every(h => /^[0-9a-f]{64}$/.test(h)));
  await funciona('validar_token devuelve el rol', db.rpc('validar_token', { p_token: sI.token }, B), r => r === 'interna');
  await funciona('un token inventado no es válido', db.rpc('validar_token', { p_token: 'a'.repeat(64) }, B), r => r === null);
  await funciona('token de funcionario: obtener_folio', db.rpc('obtener_folio', { p_clave: sI.token }, B), r => Number.isInteger(r));
  await falla('token de funcionario NO sirve para el panel', db.rpc('listar_matriculas', { p_clave: sI.token }, B), /clave_incorrecta/);
  await funciona('token de administrador: listar_matriculas', db.rpc('listar_matriculas', { p_clave: sA.token }, B), r => r.length === 2 && r[0]._key);
  await funciona('token de administrador también sirve para registrar', db.rpc('obtener_folio', { p_clave: sA.token }, B), r => Number.isInteger(r));
  await db.admin(`update public.sesiones set expira = now() - interval '1 minute' where token_hash = encode(extensions.digest($1,'sha256'),'hex')`, [sI.token]);
  await falla('un token vencido deja de funcionar', db.rpc('obtener_folio', { p_clave: sI.token }, B), /clave_incorrecta/);
  await db.rpc('cerrar_sesion', { p_token: sA.token }, B);
  await falla('cerrar_sesion invalida el token', db.rpc('listar_matriculas', { p_clave: sA.token }, B), /clave_incorrecta/);

  seccion('4) Límite de intentos de clave');
  await db.admin('delete from public.intentos');
  let ultima;
  for (let i = 0; i < 10; i++) ultima = await db.rpc('iniciar_sesion', { p_clave: 'intento' + i, p_rol: 'interna' }, A);
  ok('los primeros 10 intentos fallidos responden «clave»', ultima.motivo === 'clave');
  const bloqueo = await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, A);
  ok('el intento 11 queda bloqueado AUNQUE la clave sea la correcta', bloqueo.ok === false && bloqueo.motivo === 'bloqueado');
  await falla('verificar_clave (formato anterior) también se bloquea desde esa dirección', db.rpc('verificar_clave', { p_clave: 'x' }, A), /demasiados_intentos/);
  const otraIp = await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, B);
  ok('otra dirección de red NO queda bloqueada (no se castiga a todo el colegio por un atacante)', otraIp.ok === true);
  await db.admin(`update public.intentos set momento = now() - interval '20 minutes'`);
  const trasEspera = await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, A);
  ok('pasados 15 minutos el bloqueo termina', trasEspera.ok === true);

  seccion('5) Validación de datos en el servidor (registro del personal)');
  const tk = (await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, B)).token;
  const folioA = await db.rpc('obtener_folio', { p_clave: tk }, B);
  const conFolio = (extra, f = folioA) => ficha(extra, { folio: String(f), fechaRegistro: '22-10-2026, 10:00:00' });
  await funciona('una ficha completa y válida se guarda', db.rpc('guardar_matricula', { p_clave: tk, p_ficha: conFolio({}) }, B), r => /^[0-9a-f-]{36}$/.test(r));
  const folioB = await db.rpc('obtener_folio', { p_clave: tk }, B);
  const malas = [
    ['nombre con HTML <img onerror>', { estudiante: { nombre: '<img src=x onerror=alert(1)>' } }, /caracteres no permitidos/],
    ['observaciones con <script>', { estudiante: { observaciones: 'hola <script>x</script>' } }, /caracteres no permitidos/],
    ['campo desconocido en el estudiante', { estudiante: { admin: 'si' } }, /campo no permitido/],
    ['foto (campo eliminado) ya no se acepta', { estudiante: { foto: 'data:image/png;base64,AAAA' } }, /campo no permitido/],
    ['RUT del estudiante con dígito verificador incorrecto', { estudiante: { rut: '11.111.111-2' } }, /RUT del estudiante/],
    ['RUT del apoderado inválido', { apoderado: { rut: '12.345.678-9' } }, /RUT del apoderado/],
    ['campo demasiado largo', { estudiante: { nombre: 'x'.repeat(201) } }, /demasiado largo/],
    ['valor que no es texto', { apoderado: { edad: 40 } }, /debe ser texto/],
    ['parentesco fuera de la lista', { apoderado: { parentesco: 'Vecino' } }, /parentesco/],
    ['correo mal formado', { apoderado: { correo: 'no-es-correo' } }, /correo/],
    ['edad fuera de rango', { apoderado: { edad: '17' } }, /edad/],
    ['opción sí/no inválida', { estudiante: { pie: 'quizás' } }, /sí\/no/],
    ['fecha de nacimiento mal formada', { estudiante: { fnac: '15/03/2012' } }, /fecha de nacimiento/],
    ['suplente con RUT inválido', { suplente: { nombre: 'S', rut: '1-1', parentesco: 'Padre', viveConEstudiante: 'no' } }, /RUT del suplente/]
  ];
  for (const [n, extra, patron] of malas)
    await falla(`se rechaza: ${n}`, db.rpc('guardar_matricula', { p_clave: tk, p_ficha: conFolio(extra, folioB) }, B), patron);
  await falla('se rechaza: sección adicional en la raíz', db.rpc('guardar_matricula', { p_clave: tk, p_ficha: { ...conFolio({}, folioB), rol: 'admin' } }, B), /campo no permitido/);
  await falla('se rechaza: tipo inválido', db.rpc('guardar_matricula', { p_clave: tk, p_ficha: { ...conFolio({}, folioB), tipo: 'otro' } }, B), /tipo de estudiante/);
  await falla('se rechaza: ficha enorme (más de 30 KB)', db.rpc('guardar_matricula', { p_clave: tk, p_ficha: conFolio({ estudiante: { observaciones: 'x'.repeat(1000) } , apoderado: {} }, folioB) && { ...conFolio({}, folioB), estudiante: { ...conFolio({}, folioB).estudiante, observaciones: 'x'.repeat(1000), relleno: 'y'.repeat(35000) } } }, B), /demasiado grande|campo no permitido/);
  await falla('se rechaza: un folio que nunca se entregó (inventado)', db.rpc('guardar_matricula', { p_clave: tk, p_ficha: conFolio({}, 99999) }, B), /folio_invalido|número de ficha/);
  await falla('se rechaza: folio repetido', db.rpc('guardar_matricula', { p_clave: tk, p_ficha: conFolio({}, folioA) }, B), /duplicate key|folio/);
  await funciona('una ficha con suplente válido se guarda', db.rpc('guardar_matricula', { p_clave: tk, p_ficha: conFolio({ suplente: { nombre: 'Suplente F', rut: '18.516.142-0', edad: '38', direccion: 'x', comuna: 'y', nacionalidad: 'Chilena', celular: '9', correo: '', parentesco: 'Padre', viveConEstudiante: 'no' } }, folioB) }, B), r => !!r);

  seccion('6) Formulario público de pre-matrículas');
  await db.admin('delete from public.prematriculas where codigo not in (\'4821\',\'1234\')');
  const cod = await funciona('mientras dura la transición se emiten códigos de 4 dígitos (la página antigua no lee otros)', db.rpc('crear_prematricula', { p_datos: ficha({}) }, { ip: '192.0.2.7' }), r => /^[0-9]{4}$/.test(r));
  const normal = await funciona('el personal carga la pre-matrícula con ese código', db.rpc('cargar_prematricula', { p_clave: tk, p_codigo: cod }, B), r => r && r.estudiante.nombre === 'Nombre Ficticio');
  ok('la pre-matrícula guardada no contiene el campo trampa ni la dirección de red', normal && !('_hp' in normal) && !('ip' in normal));
  await falla('el campo trampa lleno (robot) se rechaza', db.rpc('crear_prematricula', { p_datos: { ...ficha({}), _hp: 'http://spam' } }, { ip: '192.0.2.8' }), /solicitud_invalida/);
  await funciona('el campo trampa vacío (persona real) se acepta', db.rpc('crear_prematricula', { p_datos: { ...ficha({}), _hp: '' } }, { ip: '192.0.2.9' }), r => /^[0-9]{4}$/.test(r));
  await falla('HTML en un campo se rechaza en el formulario público', db.rpc('crear_prematricula', { p_datos: ficha({ estudiante: { nombre: '<svg onload=alert(1)>' } }) }, { ip: '192.0.2.10' }), /caracteres no permitidos/);
  await falla('un cuerpo que no es un objeto se rechaza', db.rpc('crear_prematricula', { p_datos: ['x'] }, { ip: '192.0.2.10' }), /formato/);
  await falla('un cuerpo enorme se rechaza', db.rpc('crear_prematricula', { p_datos: { ...ficha({}), relleno: 'x'.repeat(40000) } }, { ip: '192.0.2.10' }), /demasiado grande|campo no permitido/);
  await db.admin(`delete from public.prematriculas where ip is not null`);
  let aceptadas = 0, limite = null;
  for (let i = 0; i < 10; i++) { try { await db.rpc('crear_prematricula', { p_datos: ficha({}) }, { ip: '192.0.2.50' }); aceptadas++; } catch (e) { limite = e.message; break; } }
  ok('una misma dirección puede enviar 8 pre-matrículas por hora; la 9.ª se rechaza', aceptadas === 8 && /demasiadas_solicitudes/.test(limite || ''), `aceptadas=${aceptadas} ${limite}`);
  await funciona('otra dirección no se ve afectada', db.rpc('crear_prematricula', { p_datos: ficha({}) }, { ip: '192.0.2.51' }), r => /^[0-9]{4}$/.test(r));

  seccion('7) Consulta de códigos: límite contra la prueba masiva');
  await db.admin('delete from public.intentos');
  let inexistente;
  for (let i = 0; i < 15; i++) inexistente = await db.rpc('cargar_prematricula', { p_clave: tk, p_codigo: String(5000 + i) }, A);
  ok('los códigos que no existen devuelven null', inexistente === null);
  await falla('tras 15 códigos inexistentes seguidos se bloquean las consultas', db.rpc('cargar_prematricula', { p_clave: tk, p_codigo: '4821' }, A), /demasiados_intentos/);
  await funciona('desde otra dirección el funcionario puede consultar normalmente', db.rpc('cargar_prematricula', { p_clave: tk, p_codigo: '4821' }, B), r => r && r.estudiante.nombre === 'Pre Ficticio Vigente');
  await falla('sin token no se puede consultar ningún código', db.rpc('cargar_prematricula', { p_clave: 'a'.repeat(64), p_codigo: '4821' }, B), /clave_incorrecta/);

  seccion('8) Limpieza automática: no toca matrículas definitivas');
  await db.admin(`insert into public.prematriculas (codigo, creada, datos, created_at) values ('ZZ2222','x','{}', now() - interval '50 days'), ('YY3333','x','{}', now() - interval '5 days')`).catch(() => {});
  await db.admin(`insert into public.prematriculas (codigo, creada, datos, created_at) values ('2222','x','{"tipo":"nuevo"}', now() - interval '50 days')`);
  await db.admin(`insert into public.sesiones (token_hash, rol, expira) values ('v1','interna', now() - interval '1 hour'), ('v2','interna', now() + interval '1 hour')`);
  await db.admin(`update public.matriculas set created_at = now() - interval '900 days'`);
  const m0 = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;
  const p0 = (await db.admin(`select count(*)::int n from public.prematriculas`)).rows[0].n;
  await falla('un período menor a 7 días se rechaza (protección contra errores)', db.admin('select public.limpiar_vencidos(1)'), /menor a 7 días/);
  const res = (await db.admin('select public.limpiar_vencidos(30) r')).rows[0].r;
  const m1 = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;
  const viejas = (await db.admin(`select count(*)::int n from public.prematriculas where created_at < now() - interval '30 days'`)).rows[0].n;
  const recientes = (await db.admin(`select count(*)::int n from public.prematriculas where created_at >= now() - interval '30 days'`)).rows[0].n;
  ok('las matrículas definitivas NO se borran, aunque tengan más de 2 años', m0 === m1 && m1 > 0, `antes=${m0} después=${m1}`);
  ok('las pre-matrículas de más de 30 días se borran', viejas === 0 && res.prematriculas >= 2, JSON.stringify(res));
  ok('las pre-matrículas recientes se conservan', recientes > 0 && p0 - res.prematriculas === recientes, `recientes=${recientes}`);
  ok('las sesiones vencidas se borran y las vigentes se conservan', (await db.admin(`select count(*)::int n from public.sesiones where token_hash in ('v1','v2')`)).rows[0].n === 1);
  ok('la limpieza deja constancia en la auditoría', (await db.admin(`select count(*)::int n from public.auditoria where accion='limpieza_automatica'`)).rows[0].n >= 1);
  const t = await db.admin(`select pg_get_functiondef('public.limpiar_vencidos(integer)'::regprocedure) d`);
  ok('el código de limpieza no menciona la tabla de matrículas', !/delete\s+from\s+public\.matriculas/i.test(t.rows[0].d));

  seccion('9) Panel y registro de actividad');
  const sa = (await db.rpc('iniciar_sesion', { p_clave: 'clave-encargados-ficticia', p_rol: 'admin' }, B)).token;
  const acts = await funciona('listar_auditoria (solo administrador)', db.rpc('listar_auditoria', { p_clave: sa, p_limite: 100 }, B), r => Array.isArray(r) && r.length > 0);
  await falla('listar_auditoria NO está disponible para funcionarios', db.rpc('listar_auditoria', { p_clave: tk, p_limite: 5 }, B), /clave_incorrecta/);
  const acciones = new Set((acts || []).map(a => a.accion));
  ok('quedan registradas: inicio de sesión, guardar matrícula, listar, limpieza', ['inicio_sesion', 'guardar_matricula', 'limpieza_automatica'].every(x => acciones.has(x)), [...acciones].join(','));
  const todo = JSON.stringify(acts);
  ok('el registro de actividad no contiene nombres ni RUT de personas', !/Ficticio|11\.111\.111|12\.345\.678/.test(todo));
  const id1 = (await db.rpc('listar_matriculas', { p_clave: sa }, B)).find(m => m.folio === '1')._key;
  await funciona('el administrador cambia el N° de una ficha', db.rpc('cambiar_folio_matricula', { p_clave: sa, p_id: id1, p_folio: 777 }, B));
  await falla('no se puede repetir un N° de ficha', db.rpc('cambiar_folio_matricula', { p_clave: sa, p_id: id1, p_folio: 2 }, B), /folio_duplicado/);
  await falla('el contador no puede bajar por debajo de las fichas existentes', db.rpc('establecer_siguiente_folio', { p_clave: sa, p_valor: 1 }, B), /folio_en_uso/);
  const toEdit = (await db.rpc('listar_matriculas', { p_clave: sa }, B)).find(m => m.folio === '2');
  const { _key, ...sinKey } = toEdit;
  await funciona('el administrador edita una matrícula antigua (con la validación nueva)', db.rpc('actualizar_matricula', { p_clave: sa, p_id: _key, p_ficha: { ...sinKey, estudiante: { ...sinKey.estudiante, nombre: 'Editado Ficticio' } } }, B));
  await funciona('el administrador elimina una matrícula', db.rpc('eliminar_matricula', { p_clave: sa, p_id: id1 }, B));

  seccion('10) Cierre de la transición: solo tokens');
  try { psql(path.join(RAIZ, 'supabase/cerrar_transicion.sql')); registrar('cerrar_transicion.sql se ejecuta sin errores', true); }
  catch (e) { registrar('cerrar_transicion.sql se ejecuta sin errores', false, e.stderr.toString().slice(0, 300)); }
  await falla('la clave directa YA NO sirve en las funciones (formato anterior)', db.rpc('obtener_folio', { p_clave: 'clave-funcionarios-ficticia' }, B), /clave_incorrecta/);
  await falla('la clave de encargados directa tampoco abre el panel', db.rpc('listar_matriculas', { p_clave: 'clave-encargados-ficticia' }, B), /clave_incorrecta/);
  await falla('las funciones antiguas de verificación ya no existen', db.rpc('verificar_clave', { p_clave: 'x' }, B), /no encontrada/);
  const nueva = await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, B);
  await funciona('con token sigue todo funcionando', db.rpc('obtener_folio', { p_clave: nueva.token }, B), r => Number.isInteger(r));
  const nuevo = await funciona('el formulario público sigue abierto y ahora emite códigos de 6 caracteres (sin 0, 1, I ni O)', db.rpc('crear_prematricula', { p_datos: ficha({}) }, { ip: '192.0.2.77' }), r => /^[A-HJ-NP-Z2-9]{6}$/.test(r));
  await funciona('el personal carga el código nuevo escrito en minúsculas y con guion', db.rpc('cargar_prematricula', { p_clave: nueva.token, p_codigo: nuevo.slice(0, 3).toLowerCase() + '-' + nuevo.slice(3).toLowerCase() }, B), r => r && r.estudiante.nombre === 'Nombre Ficticio');
  await funciona('los códigos de 4 dígitos ya emitidos siguen cargándose', db.rpc('cargar_prematricula', { p_clave: nueva.token, p_codigo: '4821' }, B), r => r && r.estudiante.nombre === 'Pre Ficticio Vigente');
  const muestra = new Set(); for (let i = 0; i < 30; i++) { try { muestra.add(await db.rpc('crear_prematricula', { p_datos: ficha({}) }, { ip: '192.0.2.' + (100 + i) })); } catch (e) { break; } }
  ok('30 códigos nuevos son todos distintos y usan solo el alfabeto permitido', muestra.size === 30 && [...muestra].every(c => /^[A-HJ-NP-Z2-9]{6}$/.test(c)));

  console.log(`\nResultado: ${pasadas} pruebas correctas, ${falladas} fallidas`);
  await db.cerrar();
  process.exit(falladas ? 1 : 0);
})().catch(e => { console.error('Error inesperado:', e); process.exit(2); });
