// Prueba de los archivos SQL del entorno de pruebas (supabase/prueba/*.sql) siguiendo EXACTAMENTE el orden de la guía,
// en un Postgres LOCAL y VACÍO (como un proyecto de Supabase recién creado). No usa ningún servicio real.
// Uso: PGPORT=5498 node tests/seguridad/prueba-entorno-prueba.js   (con una base vacía: prepara-postgres.sh <carpeta> <puerto>, sin esquema anterior)
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { crearRpc } = require('./rpc-local');
const { exigirBaseLocal } = require('./guardia-entorno');

const RAIZ = path.resolve(__dirname, '../..');
const PUERTO = process.env.PGPORT || '5498';
exigirBaseLocal('127.0.0.1', PUERTO);
const db = crearRpc({ host: '127.0.0.1', port: +PUERTO, user: 'postgres', database: 'postgres' });
let P = 0, F = 0; const ok = (n, c, d) => { if (c) { P++; console.log(`  ✔ ${n}`); } else { F++; console.log(`  ✘ ${n}${d ? '  → ' + d : ''}`); } };
const sec = t => console.log('\n' + t);
const uuid = () => require('crypto').randomUUID();

// Ejecuta un archivo SQL con psql; devuelve { ok, salida (filas), error }
function psql(archivoOTexto, { esTexto = false } = {}) {
  let archivo = archivoOTexto;
  if (esTexto) { archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'incosaf-sql-')), 'q.sql'); fs.writeFileSync(archivo, archivoOTexto); }
  const r = spawnSync('psql', ['-h', '127.0.0.1', '-p', PUERTO, '-U', 'postgres', '-q', '-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-f', archivo], { encoding: 'utf8' });
  if (esTexto) fs.rmSync(path.dirname(archivo), { recursive: true, force: true });
  return { ok: r.status === 0, salida: (r.stdout || '').trim(), error: (r.stderr || '').trim() };
}
const sql = f => path.join(RAIZ, f);
const CLAVES = { enc: 'enc-' + 'a1b2c3d4e5f6a7b8c9d0e1f2', fun: 'fun-' + 'b1c2d3e4f5a6b7c8d9e0f1a2', scr: 'scr-' + 'c1d2e3f4a5b6c7d8e9f0a1b2' };
function claves(c = CLAVES) {
  return fs.readFileSync(sql('supabase/prueba/03_claves_prueba.sql.ejemplo'), 'utf8')
    .replace('<<CLAVE_ENCARGADOS_PRUEBA>>', c.enc).replace('<<CLAVE_FUNCIONARIOS_PRUEBA>>', c.fun).replace('<<SECRETO_SCRIPT_PRUEBA>>', c.scr);
}
const diag = () => psql(sql('supabase/prueba/06_diagnostico.sql')).salida.split('\n').filter(Boolean).map(l => { const [orden, comprobacion, estado, detalle] = l.split('|'); return { orden, comprobacion, estado, detalle }; });
const malas = d => d.filter(x => x.estado === 'FALLA' || x.estado === 'REVISAR');

(async () => {
  sec('0) Base vacía: el proyecto de pruebas recién creado');
  await db.admin(`drop schema if exists public cascade; create schema public; grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;`);
  let r = psql(sql('supabase/prueba/00_comprobar_que_es_el_proyecto_de_pruebas.sql'));
  ok('00: en un proyecto vacío no se detiene y avisa que está vacío', r.ok && /vacío/.test(r.error + r.salida), r.error.slice(0, 200));

  sec('1) Instalación en el orden de la guía (01 → 04)');
  r = psql(sql('supabase/schema.sql')); ok('01 schema.sql se aplica en un proyecto vacío', r.ok, r.error.slice(0, 300));
  r = psql(sql('supabase/migraciones/002_matricula_multiple.sql')); ok('02 la migración se aplica', r.ok, r.error.slice(0, 300));
  r = psql(claves(), { esTexto: true }); ok('03 las claves (plantilla con los textos reemplazados) se guardan', r.ok, r.error.slice(0, 300));
  r = psql(sql('supabase/cerrar_transicion.sql')); ok('04 se cierra la transición', r.ok && /^f$/m.test(r.salida), r.salida + r.error.slice(0, 200));
  let d = diag();
  ok('06 diagnóstico: hay comprobaciones y NINGUNA falla ni pide revisión', d.length > 60 && malas(d).length === 0, JSON.stringify(malas(d)));
  ok('06 incluye comprobaciones de tablas, RLS, permisos de tablas y de funciones', ['Tabla public.solicitudes', 'RLS activo en matriculas', 'Sin acceso directo de anon a config', 'Función pública guardar_solicitud', 'Funciones internas cerradas a anon'].every(c => d.some(x => x.comprobacion === c && x.estado === 'OK')));
  ok('06 no muestra claves ni hashes', !JSON.stringify(d).match(/\$2[aby]\$|enc-a1b2|fun-b1c2|scr-c1d2/));
  // Supabase crea public.rls_auto_enable() (devuelve event_trigger, abierta a anon por defecto): no debe contar como falla
  await db.admin(`create function public.rls_auto_enable() returns event_trigger language plpgsql security definer as $$ begin end $$; grant execute on function public.rls_auto_enable() to anon`);
  d = diag();
  ok('06 trata una función de disparador de la plataforma (rls_auto_enable) como INFO, no como falla', malas(d).length === 0 && d.some(x => /rls_auto_enable/.test(x.comprobacion) && x.estado === 'INFO'), JSON.stringify(malas(d)));
  await db.admin(`create function public.otra_normal() returns integer language sql as 'select 1'; grant execute on function public.otra_normal() to anon`);
  ok('06 sigue marcando como FALLA una función normal abierta a anon', malas(diag()).some(x => /otra_normal/.test(x.comprobacion)));
  await db.admin(`drop function public.otra_normal(); drop function public.rls_auto_enable()`);
  ok('06 informa pg_cron como INFO (no es obligatorio en pruebas)', d.some(x => /pg_cron/.test(x.comprobacion) && x.estado === 'INFO'));

  sec('2) El esquema instalado funciona con las claves de prueba');
  const lg = await db.rpc('iniciar_sesion', { p_clave: CLAVES.fun, p_rol: 'interna' }, { ip: '198.51.100.1' });
  ok('la clave de funcionarios de prueba abre sesión', lg.ok === true);
  ok('la de encargados también (rol admin)', (await db.rpc('iniciar_sesion', { p_clave: CLAVES.enc, p_rol: 'admin' }, { ip: '198.51.100.1' })).ok === true);
  ok('el secreto del script NO sirve como clave de personal', (await db.rpc('iniciar_sesion', { p_clave: CLAVES.scr, p_rol: 'interna' }, { ip: '198.51.100.2' })).ok === false);
  ok('el secreto del script sí es aceptado por reservar_envio (con una solicitud inexistente responde no_encontrada)', (await db.rpc('reservar_envio', { p_secreto: CLAVES.scr, p_solicitud: uuid(), p_token: lg.token }, { ip: '198.51.100.1' })).motivo === 'no_encontrada');

  sec('3) Datos ficticios (05) e idempotencia');
  r = psql(sql('supabase/prueba/05_datos_ficticios.sql')); ok('05 se ejecuta', r.ok && /Matrículas ficticias\|2/.test(r.salida) && /Pre-matrículas ficticias\|1/.test(r.salida), r.salida + r.error.slice(0, 200));
  r = psql(sql('supabase/prueba/05_datos_ficticios.sql')); ok('05 se puede repetir sin duplicar', r.ok && /Matrículas ficticias\|2/.test(r.salida));
  r = psql(sql('supabase/prueba/00_comprobar_que_es_el_proyecto_de_pruebas.sql')); ok('00 con datos TEST no se detiene', r.ok);
  for (const f of ['supabase/schema.sql', 'supabase/migraciones/002_matricula_multiple.sql', 'supabase/cerrar_transicion.sql']) { r = psql(sql(f)); ok(`volver a ejecutar ${path.basename(f)} no falla ni pierde datos`, r.ok, r.error.slice(0, 200)); }
  ok('tras repetir todo, siguen las 2 matrículas y la pre-matrícula ficticias', (await db.admin('select (select count(*) from public.matriculas)::int m, (select count(*) from public.prematriculas)::int p')).rows[0].m === 2);
  ok('tras repetir todo, las claves siguen siendo las de prueba (no se reiniciaron)', (await db.rpc('iniciar_sesion', { p_clave: CLAVES.fun, p_rol: 'interna' }, { ip: '198.51.100.3' })).ok === true);
  ok('el diagnóstico sigue sin fallas', malas(diag()).length === 0);
  const cargada = await db.rpc('cargar_prematricula', { p_clave: lg.token, p_codigo: 'TST234' }, { ip: '198.51.100.1' });
  ok('el código ficticio TST234 recupera la pre-matrícula de prueba', cargada && cargada.estudiante.nombre === 'Pre TEST Ficticia');
  const adm = (await db.rpc('iniciar_sesion', { p_clave: CLAVES.enc, p_rol: 'admin' }, { ip: '198.51.100.1' })).token;
  const lista = await db.rpc('listar_matriculas', { p_clave: adm }, { ip: '198.51.100.1' });
  ok('el panel lista las matrículas ficticias anteriores (sin solicitud) con los campos nuevos en blanco', lista.length === 2 && lista.every(x => x._solicitud === null && x._hermanos === 1));

  sec('4) Una solicitud de 3 estudiantes y los archivos de verificación (07, 08)');
  const rut = n => { let s = 0, m = 2; for (const x of String(n).split('').reverse()) { s += x * m; m = m === 7 ? 2 : m + 1; } const k = 11 - s % 11; return n + '-' + (k === 11 ? '0' : k === 10 ? 'K' : k); };
  const ficha = (n, tipo, curso) => ({ tipo, estudiante: { nombre: `Alumno TEST ${n}`, rut: rut(46000000 + n), fnac: '2012-01-01', direccion: 'x', comuna: 'x', nacionalidad: 'Chilena', celular: '1', correo: '', procedencia: tipo === 'nuevo' ? 'Colegio TEST' : '', cursoMatricula: curso, repitencia: 'no', repCurso: '', repAnio: '', pie: 'no', pieDiagnostico: '', pieDocumentacion: '', salud: 'no', saludDetalle: '', observaciones: '' },
    apoderado: { nombre: 'Apoderado TEST', rut: rut(22222222), edad: '40', direccion: 'x', comuna: 'x', nacionalidad: 'Chilena', celular: '1', correo: 'apoderado.test@example.invalid', parentesco: 'Madre', viveConEstudiante: 'si', nivelEducacional: '', situacionLaboral: '', lugarTrabajo: '' }, suplente: null });
  const sid = uuid(); const rv = await db.rpc('reservar_folios', { p_clave: lg.token, p_solicitud: sid, p_cantidad: 3 }, { ip: '198.51.100.1' });
  const fichas = [ficha(1, 'antiguo', '1° Medio A'), ficha(2, 'antiguo', '3° Medio B'), ficha(3, 'nuevo', '2° Medio')].map((f, i) => ({ ...f, folio: String(rv.folios[i]), fechaRegistro: '01-01-2027, 10:00:00' }));
  const gs = await db.rpc('guardar_solicitud', { p_clave: lg.token, p_solicitud: sid, p_fichas: fichas }, { ip: '198.51.100.1' });
  ok('se guarda la solicitud de 3 estudiantes', gs.ok && gs.matriculas.length === 3);
  r = psql(sql('supabase/prueba/07_verificar_folios.sql'));
  ok('07 se ejecuta sin errores', r.ok, r.error.slice(0, 200));
  const salida07 = r.salida;
  ok('07-B muestra la solicitud con 3 matrículas guardadas y sus 3 folios', new RegExp(`${sid.slice(0, 8)}\\|3\\|3\\|\\{${rv.folios.join(',')}\\}\\|pendiente`).test(salida07), salida07.slice(0, 300));
  ok('07-E lista a los 3 estudiantes con su solicitud y orden', ['1|antiguo|Alumno TEST 1|1° Medio A', '2|antiguo|Alumno TEST 2|3° Medio B', '3|nuevo|Alumno TEST 3|2° Medio'].every(x => salida07.includes(x)), salida07.slice(-500));
  const bloques07 = fs.readFileSync(sql('supabase/prueba/07_verificar_folios.sql'), 'utf8').split('\n').filter(l => !/^\s*--/.test(l)).join('\n').split(/;\s*\n/).map(x => x.trim()).filter(x => /^select/i.test(x));
  const vacio = bloque => { const q = psql(bloque + ';', { esTexto: true }); return q.ok && q.salida === ''; };
  ok('07-A (folios repetidos) y 07-C (solicitudes inconsistentes) devuelven 0 filas cuando todo está bien', bloques07.length === 5 && vacio(bloques07[0]) && vacio(bloques07[2]), 'bloques=' + bloques07.length);
  // forzamos una inconsistencia y comprobamos que 07-C la detecta
  await db.admin(`update public.matriculas set folio = 8888 where solicitud_id = $1 and orden = 2`, [sid]);
  r = psql(sql('supabase/prueba/07_verificar_folios.sql'));
  ok('07-C detecta cuando el folio de un hermano ya no coincide con el reservado', r.ok && r.salida.includes(`${sid.slice(0, 8)}|{${rv.folios.join(',')}}|`), r.salida.slice(0, 300));
  await db.admin(`update public.matriculas set folio = $1 where solicitud_id = $2 and orden = 2`, [rv.folios[1], sid]);
  r = psql(sql('supabase/prueba/08_verificar_envio_correo.sql')); ok('08 se ejecuta sin errores y muestra la solicitud', r.ok && r.salida.includes(sid.slice(0, 8)), r.error.slice(0, 200));

  sec('5) El diagnóstico detecta cada problema de seguridad (casos que DEBEN fallar)');
  const casos = [
    ['se abre una función interna a anon', `grant execute on function public._validar_ficha(jsonb, boolean) to anon`, `revoke all on function public._validar_ficha(jsonb, boolean) from anon`, /Función NO esperada ejecutable por anon: _validar_ficha/],
    ['se quita RLS de solicitudes', `alter table public.solicitudes disable row level security`, `alter table public.solicitudes enable row level security`, /RLS activo en solicitudes/],
    ['se da acceso directo de lectura a anon sobre matriculas', `grant select on public.matriculas to anon`, `revoke all on public.matriculas from anon`, /Sin acceso directo de anon a matriculas/],
    ['se crea una política permisiva', `create policy abierta on public.matriculas for select using (true)`, `drop policy abierta on public.matriculas`, /Políticas RLS en public/],
    ['se reabre el modo transición', `update public.config set modo_transicion = true where id`, `update public.config set modo_transicion = false where id`, /Modo transición cerrado/],
    ['falta el secreto del script', `update public.config set clave_script_hash = null where id`, `update public.config set clave_script_hash = extensions.crypt('${CLAVES.scr}', extensions.gen_salt('bf')) where id`, /Secreto del script definido/],
    ['quedan las claves de la plantilla sin cambiar', `update public.config set clave_hash = extensions.crypt('<<CLAVE_ENCARGADOS_PRUEBA>>', extensions.gen_salt('bf')) where id`, `update public.config set clave_hash = extensions.crypt('${CLAVES.enc}', extensions.gen_salt('bf')) where id`, /Las claves no son los textos de la plantilla/],
    ['se reinstala la función antigua que acepta la clave directa', `create function public.verificar_clave(p_clave text) returns boolean language sql as 'select true'`, `drop function public.verificar_clave(text)`, /Funciones de verificación antiguas eliminadas/]
  ];
  for (const [nombre, romper, reparar, patron] of casos) {
    await db.admin(romper); const dd = diag(); const hit = malas(dd).some(x => patron.test(x.comprobacion)); await db.admin(reparar);
    ok(`el diagnóstico lo detecta: ${nombre}`, hit, JSON.stringify(malas(dd)).slice(0, 200));
  }
  ok('tras reparar todo, el diagnóstico vuelve a estar sin fallas', malas(diag()).length === 0, JSON.stringify(malas(diag())));

  sec('6) Protecciones de 00, 05 y 09: no actúan si hay datos que no son de prueba');
  await db.admin(`insert into public.matriculas (folio, fecha_registro, tipo, datos) values (7777, 'x', 'nuevo', '{"estudiante":{"nombre":"Juan Pérez Real","rut":"1-9"},"apoderado":{}}'::jsonb)`);
  const antes = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;
  r = psql(sql('supabase/prueba/00_comprobar_que_es_el_proyecto_de_pruebas.sql')); ok('00 se DETIENE si hay una matrícula sin la marca TEST (posible proyecto real)', !r.ok && /DETENTE/.test(r.error));
  r = psql(sql('supabase/prueba/05_datos_ficticios.sql')); ok('05 se DETIENE: no inserta datos de prueba junto a datos reales', !r.ok && /DETENTE/.test(r.error));
  r = psql(sql('supabase/prueba/09_limpiar_datos_ficticios.sql')); ok('09 se DETIENE sin borrar NADA (ni siquiera lo de prueba)', !r.ok && /DETENIDO/.test(r.error) && (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n === antes, r.error.slice(0, 200));
  await db.admin(`delete from public.matriculas where folio = 7777`);

  sec('7) Limpieza (09) y retiro de credenciales (10)');
  r = psql(sql('supabase/prueba/09_limpiar_datos_ficticios.sql'));
  ok('09 borra las matrículas, pre-matrículas y solicitudes de prueba y deja todo en 0', r.ok && /^0\|0\|0$/m.test(r.salida), r.salida + r.error.slice(0, 200));
  ok('09 no borra la estructura ni las claves', (await db.rpc('iniciar_sesion', { p_clave: CLAVES.fun, p_rol: 'interna' }, { ip: '198.51.100.9' })).ok === true && malas(diag()).length === 0);
  r = psql(sql('supabase/prueba/09_limpiar_datos_ficticios.sql')); ok('09 se puede repetir', r.ok);
  r = psql(sql('supabase/prueba/10_retirar_credenciales_de_prueba.sql')); ok('10 se ejecuta', r.ok && /Claves de prueba invalidadas\|0/.test(r.salida), r.salida + r.error.slice(0, 200));
  ok('con 10 las claves de prueba YA NO sirven (funcionarios, encargados ni secreto del script)',
    (await db.rpc('iniciar_sesion', { p_clave: CLAVES.fun, p_rol: 'interna' }, { ip: '198.51.100.20' })).ok === false
    && (await db.rpc('iniciar_sesion', { p_clave: CLAVES.enc, p_rol: 'admin' }, { ip: '198.51.100.21' })).ok === false
    && (await db.rpc('reservar_envio', { p_secreto: CLAVES.scr, p_solicitud: uuid(), p_token: 'a'.repeat(64) }, { ip: '198.51.100.22' })).motivo === 'secreto');
  ok('con 10 las sesiones abiertas quedaron cerradas', (await db.rpc('validar_token', { p_token: lg.token }, { ip: '198.51.100.1' })) === null);
  ok('los archivos nunca guardaron las claves de prueba en el repositorio', !fs.readFileSync(sql('supabase/prueba/03_claves_prueba.sql.ejemplo'), 'utf8').match(/enc-a1b2|fun-b1c2|scr-c1d2/));

  await db.cerrar();
  console.log(`\nResultado: ${P} comprobaciones correctas, ${F} fallidas`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('Error inesperado:', e); process.exit(2); });
