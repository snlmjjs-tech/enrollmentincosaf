// Pruebas SQL de las matrículas cifradas (supabase/migraciones/003_cifrado.sql) contra un Postgres LOCAL con datos ficticios.
// Las fichas se cifran con el módulo real (js/cifrado.js) y se comprueba el ciclo completo: guardar → la base no ve nada legible → descifrar.
// Uso: PGPORT=5499 node tests/seguridad/prueba-cifrado-sql.js   (con la base preparada por prepara-postgres.sh)
const { execFileSync } = require('child_process');
const path = require('path');
const { crearRpc } = require('./rpc-local');
const { exigirBaseLocal } = require('./guardia-entorno');
const C = require('../../js/cifrado.js');

const RAIZ = path.resolve(__dirname, '../..');
const PUERTO = process.env.PGPORT || '5499';
exigirBaseLocal('127.0.0.1', PUERTO);
const db = crearRpc({ host: '127.0.0.1', port: +PUERTO, user: 'postgres', database: 'postgres' });
const psql = archivo => execFileSync('psql', ['-h', '127.0.0.1', '-p', PUERTO, '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', archivo], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

let pasadas = 0, falladas = 0;
const registrar = (n, bien, d) => { if (bien) { pasadas++; console.log(`  ✔ ${n}`); } else { falladas++; console.log(`  ✘ ${n}${d ? '  → ' + d : ''}`); } };
const ok = (n, c, d) => registrar(n, !!c, d);
async function falla(nombre, promesa, patron) {
  try { const r = await promesa; registrar(nombre, false, 'no falló; devolvió ' + JSON.stringify(r)); }
  catch (e) { registrar(nombre, patron.test(e.message), 'mensaje: ' + e.message); }
}
const seccion = t => console.log(`\n${t}`);
const uuid = () => require('crypto').randomUUID();
const rut = n => { let s = 0, m = 2; for (const d of String(n).split('').reverse()) { s += d * m; m = m === 7 ? 2 : m + 1; } const r = 11 - s % 11; return n + '-' + (r === 11 ? '0' : r === 10 ? 'K' : r); };

const fichaEst = (n, o = {}) => ({
  tipo: o.tipo || 'nuevo',
  estudiante: { nombre: `Estudiante TEST ${n}`, rut: rut(30000000 + n), fnac: '2012-03-15', direccion: 'Calle Ficticia 1', comuna: 'Comuna TEST',
    nacionalidad: 'Chilena', celular: '+56 9 0000 0000', correo: '', procedencia: (o.tipo || 'nuevo') === 'nuevo' ? 'Colegio TEST' : '',
    cursoMatricula: (o.tipo || 'nuevo') === 'antiguo' ? '2° Medio A' : '', repitencia: 'no', repCurso: '', repAnio: '', pie: o.pie || 'no',
    pieDiagnostico: o.pie === 'si' ? 'Diagnóstico ficticio de prueba' : '', pieDocumentacion: '', salud: 'no', saludDetalle: '', observaciones: '' },
  apoderado: { nombre: 'Apoderado TEST', rut: rut(20000000), edad: '40', direccion: 'Calle Ficticia 1', comuna: 'Comuna TEST', nacionalidad: 'Chilena',
    celular: '+56 9 0000 0001', correo: o.correo === undefined ? 'apoderado.test@example.invalid' : o.correo, parentesco: 'Madre',
    viveConEstudiante: 'si', nivelEducacional: 'Titulado de una Universidad', situacionLaboral: 'Trabaja jornada completa (todo el día)', lugarTrabajo: 'Fuera del hogar' },
  suplente: null
});
const conFolio = (f, folio) => ({ ...f, folio: String(folio), fechaRegistro: '23-10-2026, 10:00:00' });
const NOMBRES = ['Estudiante TEST', 'Apoderado TEST', 'apoderado.test@example.invalid', 'Diagnóstico ficticio', 'Calle Ficticia', 'Comuna TEST', '+56 9 0000'];
const paqueteDe = fichas => ({ destinatario: fichas[0].apoderado.correo, apoderado: fichas[0].apoderado.nombre,
  estudiantes: fichas.map(f => ({ folio: f.folio, nombre: f.estudiante.nombre, rut: f.estudiante.rut, cursoMatricula: f.estudiante.cursoMatricula, procedencia: f.estudiante.procedencia })) });

(async () => {
  const IP = '198.51.100.9', o = { ip: IP }, CLAVE = 'clave-del-colegio-solo-prueba-77';
  const { archivo, publica } = await C.crearLlaveColegio(CLAVE);
  const llave = await C.abrirLlave(archivo, CLAVE);

  seccion('0) Migración 003: se aplica sobre 002 (con datos existentes) sin perder nada, y se puede repetir');
  for (const f of ['supabase/schema.sql', 'supabase/migraciones/002_matricula_multiple.sql']) { try { psql(path.join(RAIZ, f)); registrar(`${f} se aplica`, true); } catch (e) { registrar(`${f} se aplica`, false, e.stderr.toString().slice(0, 300)); process.exit(1); } }
  const antes = (await db.admin('select count(*)::int n, coalesce(sum(folio),0)::int s, md5(string_agg(datos::text, \'\' order by folio)) h from public.matriculas')).rows[0];
  try { psql(path.join(RAIZ, 'supabase/migraciones/003_cifrado.sql')); registrar('la migración 003 se aplica sin errores', true); } catch (e) { registrar('la migración 003 se aplica', false, e.stderr.toString().slice(0, 400)); process.exit(1); }
  try { psql(path.join(RAIZ, 'supabase/migraciones/003_cifrado.sql')); registrar('se puede ejecutar de nuevo (idempotente)', true); } catch (e) { registrar('idempotente', false, e.stderr.toString().slice(0, 300)); }
  const despues = (await db.admin('select count(*)::int n, coalesce(sum(folio),0)::int s, md5(string_agg(datos::text, \'\' order by folio)) h from public.matriculas')).rows[0];
  ok('no se perdió ni cambió ninguna matrícula existente', antes.n === despues.n && antes.s === despues.s && antes.h === despues.h, JSON.stringify({ antes, despues }));
  const cfg = (await db.admin('select exigir_cifrado, prematricula_horas from public.config')).rows[0];
  ok('por defecto: exigir_cifrado APAGADO y pre-matrícula de 2 horas', cfg.exigir_cifrado === false && cfg.prematricula_horas === 2, JSON.stringify(cfg));
  await falla('prematricula_horas no acepta 0 ni 100', db.admin('update public.config set prematricula_horas = 100'), /check|restricci/i);
  await db.admin(`update public.config set modo_transicion = false`);
  await db.admin(`update public.config set clave_script_hash = extensions.crypt('secreto-script-ficticio', extensions.gen_salt('bf')) where id`);
  await db.admin('delete from public.intentos; delete from public.sesiones');
  const interna = (await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, o)).token;
  const admin = (await db.rpc('iniciar_sesion', { p_clave: 'clave-encargados-ficticia', p_rol: 'admin' }, o)).token;
  const SEC = 'secreto-script-ficticio';

  async function solicitudCifrada(tk, n, opciones = {}) {
    const id = uuid(); const r = await db.rpc('reservar_folios', { p_clave: tk, p_solicitud: id, p_cantidad: n }, o);
    const base = opciones.base || 0;
    const fichas = r.folios.map((fo, i) => conFolio(fichaEst(base + i + 1, (opciones.ficha && opciones.ficha[i]) || {}), fo));
    const filas = [];
    for (let i = 0; i < n; i++) {
      const mid = uuid();
      filas.push({ id: mid, folio: r.folios[i], tipo: fichas[i].tipo, fechaRegistro: fichas[i].fechaRegistro, cifrado: await C.cifrarFicha(fichas[i], publica, 'matricula:' + mid) });
    }
    return { id, folios: r.folios, fichas, filas, paquete: paqueteDe(fichas) };
  }
  const guardar = (s, tk = interna, paquete) => db.rpc('guardar_solicitud_cifrada', { p_clave: tk, p_solicitud: s.id, p_matriculas: s.filas, p_paquete: paquete === undefined ? s.paquete : paquete }, o);

  seccion('1) Compatibilidad: con la migración aplicada, la forma actual de guardar sigue funcionando igual');
  const sPlano = uuid(); const rp = await db.rpc('reservar_folios', { p_clave: interna, p_solicitud: sPlano, p_cantidad: 1 }, o);
  const gp = await db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: sPlano, p_fichas: [conFolio(fichaEst(900), rp.folios[0])] }, o);
  ok('guardar_solicitud (sin cifrar) sigue funcionando', gp.ok === true && gp.matriculas.length === 1);
  const filasAdmin = await db.rpc('listar_matriculas', { p_clave: admin }, o);
  const plana = filasAdmin.find(f => f.estudiante && f.estudiante.nombre === 'Estudiante TEST 900');
  ok('listar_matriculas devuelve las matrículas sin cifrar con la misma forma de siempre', plana && plana._key && plana.folio && plana.apoderado && !plana._cifrado);
  const rv = await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: sPlano, p_token: interna }, o);
  ok('reservar_envio de una matrícula sin cifrar sigue entregando los datos desde la base', rv.ok === true && rv.destinatario === 'apoderado.test@example.invalid' && rv.estudiantes[0].nombre === 'Estudiante TEST 900');
  await db.rpc('registrar_envio', { p_secreto: SEC, p_solicitud: sPlano, p_resultado: 'enviado', p_detalle: null }, o);

  seccion('2) Guardar cifrado: la base solo ve texto ilegible');
  await falla('sin sesión no se puede guardar una solicitud cifrada', db.rpc('guardar_solicitud_cifrada', { p_clave: 'no-es-token', p_solicitud: uuid(), p_matriculas: [], p_paquete: null }, o), /clave_incorrecta/);
  const s1 = await solicitudCifrada(interna, 2, { base: 10, ficha: [{ pie: 'si' }, { tipo: 'antiguo' }] });
  const g1 = await guardar(s1);
  ok('se guardan 2 matrículas cifradas en una sola operación', g1.ok === true && g1.repetida === false && g1.matriculas.length === 2 && g1.correo_estado === 'pendiente', JSON.stringify(g1));
  const volcado = (await db.admin(`select m::text t from public.matriculas m where m.solicitud_id = $1`, [s1.id])).rows.map(r => r.t).join('\n');
  ok('en la tabla de matrículas NO aparece ningún dato legible (nombres, RUT, correo, diagnóstico, dirección, teléfono)', NOMBRES.every(x => !volcado.includes(x)) && !volcado.includes(s1.fichas[0].estudiante.rut), volcado.slice(0, 300));
  const m1 = (await db.admin(`select folio, tipo, fecha_registro, orden, datos from public.matriculas where solicitud_id = $1 order by orden`, [s1.id])).rows;
  ok('quedan visibles solo el folio, el tipo y la fecha; el resto es el paquete cifrado', m1.length === 2 && m1[0].folio === s1.folios[0] && m1[1].tipo === 'antiguo' && C.esCifrado(m1[0].datos) && Object.keys(m1[0].datos).sort().join() === 'alg,ck,ct,iv,kid,v');
  const aud = (await db.admin(`select detalle::text t from public.auditoria where accion = 'guardar_solicitud' order by id desc limit 1`)).rows[0].t;
  ok('la auditoría registra la operación sin datos personales', /cifrada/.test(aud) && NOMBRES.every(x => !aud.includes(x)));
  const g1b = await guardar(s1);
  ok('reintentar con los MISMOS identificadores devuelve lo guardado, sin duplicar', g1b.ok && g1b.repetida === true && (await db.admin('select count(*)::int n from public.matriculas where solicitud_id = $1', [s1.id])).rows[0].n === 2);
  await falla('reintentar con otros identificadores se rechaza (otra solicitud con los mismos folios)', db.rpc('guardar_solicitud_cifrada', { p_clave: interna, p_solicitud: s1.id, p_matriculas: s1.filas.map(f => ({ ...f, id: uuid() })), p_paquete: s1.paquete }, o), /ya fue registrada con otros datos/);
  const s2 = await solicitudCifrada(interna, 1, { base: 20 });
  await falla('un folio distinto al reservado se rechaza', db.rpc('guardar_solicitud_cifrada', { p_clave: interna, p_solicitud: s2.id, p_matriculas: [{ ...s2.filas[0], folio: s2.folios[0] + 50 }], p_paquete: null }, o), /folio_invalido/);
  await falla('un campo extra en la matrícula se rechaza', db.rpc('guardar_solicitud_cifrada', { p_clave: interna, p_solicitud: s2.id, p_matriculas: [{ ...s2.filas[0], extra: 'x' }], p_paquete: null }, o), /campo no permitido/);
  await falla('un identificador que no es uuid se rechaza', db.rpc('guardar_solicitud_cifrada', { p_clave: interna, p_solicitud: s2.id, p_matriculas: [{ ...s2.filas[0], id: 'hola' }], p_paquete: null }, o), /identificador no válido/);
  await falla('una ficha SIN cifrar (texto plano) dentro del campo cifrado se rechaza', db.rpc('guardar_solicitud_cifrada', { p_clave: interna, p_solicitud: s2.id, p_matriculas: [{ ...s2.filas[0], cifrado: s2.fichas[0] }], p_paquete: null }, o), /formato correcto|no permitido/);
  await falla('un paquete cifrado con un campo extra se rechaza', db.rpc('guardar_solicitud_cifrada', { p_clave: interna, p_solicitud: s2.id, p_matriculas: [{ ...s2.filas[0], cifrado: { ...s2.filas[0].cifrado, nombre: 'Juan' } }], p_paquete: null }, o), /campo no permitido/);
  await falla('un paquete cifrado con la llave envuelta corta se rechaza', db.rpc('guardar_solicitud_cifrada', { p_clave: interna, p_solicitud: s2.id, p_matriculas: [{ ...s2.filas[0], cifrado: { ...s2.filas[0].cifrado, ck: 'AAAA' } }], p_paquete: null }, o), /formato correcto/);
  await falla('una cantidad distinta a la reservada se rechaza', db.rpc('guardar_solicitud_cifrada', { p_clave: interna, p_solicitud: s2.id, p_matriculas: [s2.filas[0], s2.filas[0]], p_paquete: null }, o), /cantidad/);
  await falla('el paquete de correo con otro folio se rechaza', guardar(s2, interna, { ...s2.paquete, estudiantes: [{ ...s2.paquete.estudiantes[0], folio: '999999' }] }), /folio/);
  await falla('el paquete de correo con un correo inválido se rechaza', guardar(s2, interna, { ...s2.paquete, destinatario: 'no-es-un-correo' }), /correo/);
  await falla('el paquete de correo con símbolos < > se rechaza', guardar(s2, interna, { ...s2.paquete, apoderado: '<script>' }), /nombre del apoderado/);
  await falla('el paquete de correo con un campo extra se rechaza', guardar(s2, interna, { ...s2.paquete, otro: 1 }), /campo no permitido/);
  ok('tras los rechazos la solicitud sigue sin guardar (todo o nada)', (await db.admin('select estado from public.solicitudes where id = $1', [s2.id])).rows[0].estado === 'reservada' && (await db.admin('select count(*)::int n from public.matriculas where solicitud_id = $1', [s2.id])).rows[0].n === 0);
  const g2 = await guardar(s2, interna, null);
  ok('sin paquete de correo la solicitud queda «sin_correo» y no guarda ningún dato temporal', g2.ok && g2.correo_estado === 'sin_correo' && (await db.admin('select correo_paquete from public.solicitudes where id = $1', [s2.id])).rows[0].correo_paquete === null);

  seccion('3) Correo: el paquete temporal permite enviar y se borra al enviarse');
  const pq = (await db.admin('select correo_paquete p, correo_paquete_en e from public.solicitudes where id = $1', [s1.id])).rows[0];
  ok('mientras el correo está pendiente, el paquete temporal existe (con fecha)', pq.p && pq.p.destinatario === 'apoderado.test@example.invalid' && pq.e);
  const rev = await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: s1.id, p_token: interna }, o);
  ok('reservar_envio entrega destinatario, apoderado y estudiantes (con folio y orden de la base)', rev.ok === true && rev.destinatario === 'apoderado.test@example.invalid' && rev.apoderado === 'Apoderado TEST'
    && rev.estudiantes.length === 2 && rev.estudiantes[0].folio === s1.folios[0] && rev.estudiantes[1].orden === 2 && rev.estudiantes[1].tipo === 'antiguo' && rev.estudiantes[0].nombre === 'Estudiante TEST 11', JSON.stringify(rev));
  const rev2 = await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: s1.id, p_token: interna }, o);
  ok('un segundo envío mientras el primero está en curso se rechaza («en_proceso»)', rev2.ok === false && rev2.motivo === 'en_proceso');
  await db.rpc('registrar_envio', { p_secreto: SEC, p_solicitud: s1.id, p_resultado: 'enviado', p_detalle: null }, o);
  const dsp = (await db.admin('select correo_estado, correo_paquete p, correo_paquete_en e from public.solicitudes where id = $1', [s1.id])).rows[0];
  ok('enviado el correo, el paquete con nombres y correo se BORRA de la base', dsp.correo_estado === 'enviado' && dsp.p === null && dsp.e === null);
  const rev3 = await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: s1.id, p_token: interna }, o);
  ok('no se puede enviar dos veces («ya_enviado»)', rev3.ok === false && rev3.motivo === 'ya_enviado');
  const s3 = await solicitudCifrada(interna, 1, { base: 30 }); await guardar(s3);
  await db.admin('update public.solicitudes set correo_paquete = null where id = $1', [s3.id]);
  const rev4 = await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: s3.id, p_token: interna }, o);
  ok('una solicitud cifrada SIN paquete no entrega datos (motivo «sin_paquete») y no cambia su estado', rev4.ok === false && rev4.motivo === 'sin_paquete' && (await db.admin('select correo_estado from public.solicitudes where id = $1', [s3.id])).rows[0].correo_estado === 'pendiente');
  await falla('preparar_correo exige sesión', db.rpc('preparar_correo', { p_clave: 'no-es-token', p_solicitud: s3.id, p_paquete: s3.paquete }, o), /clave_incorrecta/);
  const pc = await db.rpc('preparar_correo', { p_clave: interna, p_solicitud: s3.id, p_paquete: s3.paquete }, o);
  ok('el funcionario puede volver a dejar el paquete (solicitud reciente) y el envío funciona', pc.ok === true && (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: s3.id, p_token: interna }, o)).ok === true);
  await db.rpc('registrar_envio', { p_secreto: SEC, p_solicitud: s3.id, p_resultado: 'error', p_detalle: 'servicio_correo' }, o);
  ok('si el envío falla, el paquete se conserva para reintentar', (await db.admin('select correo_paquete p from public.solicitudes where id = $1', [s3.id])).rows[0].p !== null);
  await falla('preparar_correo con otro folio se rechaza', db.rpc('preparar_correo', { p_clave: interna, p_solicitud: s3.id, p_paquete: { ...s3.paquete, estudiantes: [{ ...s3.paquete.estudiantes[0], folio: '5' }] } }, o), /folio/);
  await falla('preparar_correo con un correo inválido se rechaza', db.rpc('preparar_correo', { p_clave: interna, p_solicitud: s3.id, p_paquete: { ...s3.paquete, destinatario: 'x@y' } }, o), /correo/);
  await db.admin(`update public.solicitudes set creada = now() - interval '30 hours' where id = $1`, [s3.id]);
  await falla('el funcionario NO puede preparar el correo de una solicitud de hace más de 24 h', db.rpc('preparar_correo', { p_clave: interna, p_solicitud: s3.id, p_paquete: s3.paquete }, o), /clave_incorrecta/);
  ok('el panel (admin) sí puede, también para solicitudes antiguas', (await db.rpc('preparar_correo', { p_clave: admin, p_solicitud: s3.id, p_paquete: s3.paquete }, o)).ok === true);
  const yaEnv = await db.rpc('preparar_correo', { p_clave: admin, p_solicitud: s1.id, p_paquete: s1.paquete }, o);
  ok('preparar el correo de una solicitud ya enviada no hace nada («ya_enviado»)', yaEnv.ya_enviado === true && (await db.admin('select correo_paquete p from public.solicitudes where id = $1', [s1.id])).rows[0].p === null);

  seccion('4) El panel recibe lo cifrado y lo descifra con la llave del colegio');
  await falla('el funcionario (rol interna) NO puede listar las matrículas', db.rpc('listar_matriculas', { p_clave: interna }, o), /clave_incorrecta/);
  const lista = await db.rpc('listar_matriculas', { p_clave: admin }, o);
  const cif = lista.filter(f => f._cifrado);
  ok('las matrículas cifradas llegan con el paquete y los pocos datos no personales (folio, fecha, tipo, solicitud, correo)', cif.length >= 4 && cif.every(f => f._key && f.folio && f.fechaRegistro && f.tipo && !f.estudiante && !f.apoderado));
  const fila1 = lista.find(f => f._key === g1.matriculas[0].id);
  ok('la fila trae la solicitud, el número de hermanos y el estado del correo', fila1._solicitud === s1.id && fila1._hermanos === 2 && fila1._correo === 'enviado');
  const abierta = await C.descifrarFicha(fila1._cifrado, llave, 'matricula:' + fila1._key);
  ok('con la llave del colegio se recupera EXACTAMENTE la ficha original', JSON.stringify(abierta) === JSON.stringify(s1.fichas[0]));
  await falla('el mismo paquete presentado con el contexto de otra matrícula no se abre', C.descifrarFicha(fila1._cifrado, llave, 'matricula:' + uuid()), /no_se_puede_abrir/);

  seccion('5) Editar, cambiar el folio y eliminar sobre matrículas cifradas');
  const nuevaFicha = { ...s1.fichas[0], estudiante: { ...s1.fichas[0].estudiante, nombre: 'Estudiante TEST EDITADO' } };
  const nuevoCif = await C.cifrarFicha(nuevaFicha, publica, 'matricula:' + fila1._key);
  await falla('el funcionario NO puede actualizar una matrícula', db.rpc('actualizar_matricula_cifrada', { p_clave: interna, p_id: fila1._key, p_tipo: 'nuevo', p_fecha: 'x', p_cifrado: nuevoCif }, o), /clave_incorrecta/);
  await falla('un cifrado mal formado no se acepta al actualizar', db.rpc('actualizar_matricula_cifrada', { p_clave: admin, p_id: fila1._key, p_tipo: 'nuevo', p_fecha: 'x', p_cifrado: { v: 1 } }, o), /formato correcto|no permitido/);
  await falla('actualizar una matrícula que no existe falla', db.rpc('actualizar_matricula_cifrada', { p_clave: admin, p_id: uuid(), p_tipo: 'nuevo', p_fecha: 'x', p_cifrado: nuevoCif }, o), /matricula_no_encontrada/);
  await db.rpc('actualizar_matricula_cifrada', { p_clave: admin, p_id: fila1._key, p_tipo: 'nuevo', p_fecha: fila1.fechaRegistro, p_cifrado: nuevoCif }, o);
  const relist = (await db.rpc('listar_matriculas', { p_clave: admin }, o)).find(f => f._key === fila1._key);
  ok('tras editar, la ficha descifrada trae el cambio y la base sigue sin ver el nombre', (await C.descifrarFicha(relist._cifrado, llave, 'matricula:' + fila1._key)).estudiante.nombre === 'Estudiante TEST EDITADO'
    && !(await db.admin('select datos::text t from public.matriculas where id = $1', [fila1._key])).rows[0].t.includes('EDITADO'));
  const folioNuevo = 5000 + Math.floor(Math.random() * 1000);
  await db.rpc('cambiar_folio_matricula', { p_clave: admin, p_id: fila1._key, p_folio: folioNuevo }, o);
  const trasFolio = (await db.admin('select folio, datos from public.matriculas where id = $1', [fila1._key])).rows[0];
  ok('cambiar el folio actualiza la columna sin tocar lo cifrado, y la ficha sigue abriendo', trasFolio.folio === folioNuevo && !('folio' in trasFolio.datos) && (await C.descifrarFicha(trasFolio.datos, llave, 'matricula:' + fila1._key)).estudiante.nombre === 'Estudiante TEST EDITADO');
  await db.rpc('eliminar_matricula', { p_clave: admin, p_id: g2.matriculas[0].id }, o);
  ok('eliminar una matrícula cifrada funciona igual que antes', (await db.admin('select count(*)::int n from public.matriculas where id = $1', [g2.matriculas[0].id])).rows[0].n === 0);

  seccion('6) Convertir las matrículas antiguas (sin cifrar) a cifradas');
  const vieja = (await db.admin(`select id, datos from public.matriculas where datos->'estudiante'->>'nombre' = 'Estudiante Ficticio Uno'`)).rows[0];
  const cifVieja = await C.cifrarFicha(vieja.datos, publica, 'matricula:' + vieja.id);
  await falla('el funcionario NO puede convertir', db.rpc('convertir_matricula', { p_clave: interna, p_id: vieja.id, p_cifrado: cifVieja }, o), /clave_incorrecta/);
  await falla('convertir una matrícula que no existe falla', db.rpc('convertir_matricula', { p_clave: admin, p_id: uuid(), p_cifrado: cifVieja }, o), /matricula_no_encontrada/);
  ok('el panel convierte una matrícula sin cifrar (devuelve true)', (await db.rpc('convertir_matricula', { p_clave: admin, p_id: vieja.id, p_cifrado: cifVieja }, o)) === true);
  const trasConv = (await db.admin('select datos from public.matriculas where id = $1', [vieja.id])).rows[0].datos;
  ok('queda cifrada, ya no se lee el nombre y al descifrar es idéntica a la original', C.esCifrado(trasConv) && !JSON.stringify(trasConv).includes('Ficticio') && JSON.stringify(await C.descifrarFicha(trasConv, llave, 'matricula:' + vieja.id)) === JSON.stringify(vieja.datos));
  const otroCif = await C.cifrarFicha({ estudiante: { nombre: 'OTRO' } }, publica, 'matricula:' + vieja.id);
  ok('volver a convertir una ya cifrada NO la pisa (devuelve false)', (await db.rpc('convertir_matricula', { p_clave: admin, p_id: vieja.id, p_cifrado: otroCif }, o)) === false && (await db.admin('select datos from public.matriculas where id = $1', [vieja.id])).rows[0].datos.ct === trasConv.ct);

  seccion('7) Exigir cifrado: la base rechaza guardar fichas sin cifrar (seguro contra páginas antiguas)');
  await db.admin('update public.config set exigir_cifrado = true');
  const s4 = uuid(); const r4 = await db.rpc('reservar_folios', { p_clave: interna, p_solicitud: s4, p_cantidad: 1 }, o);
  await falla('guardar_solicitud SIN cifrar se rechaza con un mensaje claro', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: s4, p_fichas: [conFolio(fichaEst(41), r4.folios[0])] }, o), /cifrado_obligatorio/);
  await falla('actualizar_matricula SIN cifrar se rechaza', db.rpc('actualizar_matricula', { p_clave: admin, p_id: fila1._key, p_ficha: conFolio(fichaEst(42), 1) }, o), /cifrado_obligatorio/);
  await falla('ni siquiera un cambio directo en la base a texto plano se acepta', db.admin(`update public.matriculas set datos = '{"estudiante":{"nombre":"x"}}'::jsonb where id = $1`, [fila1._key]), /cifrado_obligatorio/);
  await falla('guardar_matricula (forma antigua) SIN cifrar se rechaza', db.rpc('guardar_matricula', { p_clave: interna, p_ficha: conFolio(fichaEst(43), 99999) }, o), /cifrado_obligatorio|folio_invalido/);
  const sx = await solicitudCifrada(interna, 1, { base: 50 });
  ok('guardar cifrado sigue funcionando con la obligación encendida', (await guardar(sx)).ok === true);
  const idSx = (await db.admin('select id from public.matriculas where solicitud_id = $1', [sx.id])).rows[0].id, folioSx = 7000 + Math.floor(Math.random() * 900);
  await db.rpc('cambiar_folio_matricula', { p_clave: admin, p_id: idSx, p_folio: folioSx }, o);
  ok('cambiar el folio de una matrícula cifrada sigue funcionando', (await db.admin('select folio from public.matriculas where id = $1', [idSx])).rows[0].folio === folioSx);
  await db.admin('update public.config set exigir_cifrado = false');

  seccion('8) Pre-matrícula de pocas horas');
  await db.admin(`delete from public.prematriculas`);
  const cod = await db.rpc('crear_prematricula', { p_datos: { tipo: 'nuevo', estudiante: fichaEst(60).estudiante, apoderado: fichaEst(60).apoderado, suplente: null } }, { ip: '203.0.113.60' });
  ok('se crea una pre-matrícula y el funcionario la puede cargar', (await db.rpc('cargar_prematricula', { p_clave: interna, p_codigo: cod }, o)).estudiante.nombre === 'Estudiante TEST 60');
  await db.admin(`update public.prematriculas set created_at = now() - interval '90 minutes' where codigo = $1`, [cod]);
  ok('a los 90 minutos (menos de 2 h) todavía se puede cargar', (await db.rpc('cargar_prematricula', { p_clave: interna, p_codigo: cod }, o)) !== null);
  await db.admin(`update public.prematriculas set created_at = now() - interval '121 minutes' where codigo = $1`, [cod]);
  ok('pasadas las 2 horas el código deja de funcionar, aunque todavía no se haya borrado', (await db.rpc('cargar_prematricula', { p_clave: interna, p_codigo: cod }, o)) === null && (await db.admin('select count(*)::int n from public.prematriculas where codigo = $1', [cod])).rows[0].n === 1);
  await db.rpc('crear_prematricula', { p_datos: { tipo: 'nuevo', estudiante: fichaEst(61).estudiante, apoderado: fichaEst(61).apoderado, suplente: null } }, { ip: '203.0.113.61' });
  ok('al crear otra pre-matrícula se borran las vencidas (respaldo de la tarea programada)', (await db.admin('select count(*)::int n from public.prematriculas where codigo = $1', [cod])).rows[0].n === 0);
  await db.admin(`update public.config set prematricula_horas = 1`);
  const cod2 = await db.rpc('crear_prematricula', { p_datos: { tipo: 'nuevo', estudiante: fichaEst(62).estudiante, apoderado: fichaEst(62).apoderado, suplente: null } }, { ip: '203.0.113.62' });
  await db.admin(`update public.prematriculas set created_at = now() - interval '61 minutes' where codigo = $1`, [cod2]);
  ok('la duración se puede cambiar (1 hora)', (await db.rpc('cargar_prematricula', { p_clave: interna, p_codigo: cod2 }, o)) === null);
  await db.admin(`update public.config set prematricula_horas = 2`);

  seccion('9) Limpieza automática cada 15 minutos');
  const cod3 = await db.rpc('crear_prematricula', { p_datos: { tipo: 'nuevo', estudiante: fichaEst(63).estudiante, apoderado: fichaEst(63).apoderado, suplente: null } }, { ip: '203.0.113.63' });
  await db.admin(`update public.prematriculas set created_at = now() - interval '3 hours' where codigo = $1`, [cod3]);
  const s5 = await solicitudCifrada(interna, 1, { base: 70 }); await guardar(s5);
  await db.admin(`update public.solicitudes set correo_paquete_en = now() - interval '25 hours' where id = $1`, [s5.id]);
  const s6 = await solicitudCifrada(interna, 1, { base: 80 }); await guardar(s6);
  const lim = await db.admin('select public.limpiar_vencidos_horas() r');
  ok('borra las pre-matrículas vencidas y los paquetes de correo de más de 24 h', lim.rows[0].r.prematriculas >= 1 && lim.rows[0].r.paquetes_correo >= 1, JSON.stringify(lim.rows[0].r));
  ok('el paquete de una solicitud reciente NO se borra', (await db.admin('select correo_paquete p from public.solicitudes where id = $1', [s6.id])).rows[0].p !== null);
  ok('la limpieza deja constancia en la auditoría sin datos personales', (await db.admin(`select detalle::text t from public.auditoria where accion = 'limpieza_automatica' order by id desc limit 1`)).rows[0].t.includes('paquetes_correo_borrados'));
  await falla('anon NO puede ejecutar la limpieza', db.comoAnon('select public.limpiar_vencidos_horas()'), /permission denied|denegado/i);

  seccion('10) Permisos: nada interno es accesible desde el navegador');
  for (const f of ['_exigir_cifrado()', '_horas_prematricula()', "_es_cifrado('{}'::jsonb)", "_validar_cifrado('{}'::jsonb)", "_validar_paquete_correo('{}'::jsonb, '{}'::int[])"]) {
    await falla(`anon NO puede ejecutar la función interna ${f.split('(')[0]}`, db.comoAnon(`select public.${f}`), /permission denied|denegado/i);
  }
  await falla('anon NO puede leer las matrículas cifradas', db.comoAnon('select * from public.matriculas'), /permission denied|denegado/i);
  await falla('anon NO puede leer el paquete temporal del correo', db.comoAnon('select correo_paquete from public.solicitudes'), /permission denied|denegado/i);
  await falla('anon NO puede leer la configuración (exigir_cifrado)', db.comoAnon('select exigir_cifrado from public.config'), /permission denied|denegado/i);

  console.log(`\nResultado: ${pasadas} pruebas correctas, ${falladas} fallidas`);
  await db.cerrar();
  process.exit(falladas ? 1 : 0);
})().catch(e => { console.log('✘ Error inesperado: ' + (e && e.stack || e)); process.exit(1); });
