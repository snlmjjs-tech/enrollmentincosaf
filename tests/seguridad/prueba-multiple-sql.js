// Pruebas SQL de la matrícula múltiple (supabase/migraciones/002_matricula_multiple.sql) contra un Postgres LOCAL
// con datos ficticios. No usa ningún servicio real.
// Uso: PGPORT=5499 node tests/seguridad/prueba-multiple-sql.js   (con la base preparada por prepara-postgres.sh)
const { execFileSync } = require('child_process');
const path = require('path');
const { crearRpc } = require('./rpc-local');
const { exigirBaseLocal } = require('./guardia-entorno');

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
// Ficha ficticia de un estudiante (misma forma que la página)
const fichaEst = (n, o = {}) => ({
  tipo: o.tipo || 'nuevo',
  estudiante: { nombre: `Estudiante TEST ${n}`, rut: rut(30000000 + n), fnac: '2012-03-15', direccion: 'Calle Ficticia 1', comuna: 'Comuna TEST',
    nacionalidad: 'Chilena', celular: '+56 9 0000 0000', correo: '', procedencia: (o.tipo || 'nuevo') === 'nuevo' ? 'Colegio TEST' : '',
    cursoMatricula: (o.tipo || 'nuevo') === 'antiguo' ? (o.curso || '2° Medio A') : '',
    repitencia: 'no', repCurso: '', repAnio: '', pie: o.pie || 'no', pieDiagnostico: '', pieDocumentacion: '', salud: 'no', saludDetalle: '',
    observaciones: '', ...(o.estudiante || {}) },
  apoderado: { nombre: 'Apoderado TEST', rut: rut(20000000), edad: '40', direccion: 'Calle Ficticia 1', comuna: 'Comuna TEST', nacionalidad: 'Chilena',
    celular: '+56 9 0000 0001', correo: o.correo === undefined ? 'apoderado.test@example.invalid' : o.correo, parentesco: o.parentesco || 'Madre',
    viveConEstudiante: 'si', nivelEducacional: 'Titulado de una Universidad', situacionLaboral: 'Trabaja jornada completa (todo el día)', lugarTrabajo: 'Fuera del hogar',
    ...(o.apoderado || {}) },
  suplente: null
});
const conFolio = (f, folio) => ({ ...f, folio: String(folio), fechaRegistro: '23-10-2026, 10:00:00' });
async function solicitud(tk, n, opciones = []) {   // reserva folios y arma las fichas listas para guardar
  const id = uuid(); const r = await db.rpc('reservar_folios', { p_clave: tk, p_solicitud: id, p_cantidad: n });
  return { id, folios: r.folios, fichas: r.folios.map((fo, i) => conFolio(fichaEst(100 + i + (opciones.base || 0), opciones[i] || {}), fo)) };
}

(async () => {
  const IP = '198.51.100.7';
  seccion('0) Migración 002: se aplica sobre el esquema nuevo (con datos existentes) sin perder nada');
  try { psql(path.join(RAIZ, 'supabase/schema.sql')); registrar('schema.sql (base de seguridad) se aplica', true); } catch (e) { registrar('schema.sql se aplica', false, e.stderr.toString().slice(0, 300)); process.exit(1); }
  const antes = (await db.admin('select count(*)::int n, coalesce(sum(folio),0)::int s from public.matriculas')).rows[0];
  try { psql(path.join(RAIZ, 'supabase/migraciones/002_matricula_multiple.sql')); registrar('la migración 002 se aplica sin errores', true); } catch (e) { registrar('la migración 002 se aplica', false, e.stderr.toString().slice(0, 400)); process.exit(1); }
  try { psql(path.join(RAIZ, 'supabase/migraciones/002_matricula_multiple.sql')); registrar('se puede ejecutar de nuevo (idempotente)', true); } catch (e) { registrar('idempotente', false, e.stderr.toString().slice(0, 300)); }
  const despues = (await db.admin('select count(*)::int n, coalesce(sum(folio),0)::int s from public.matriculas')).rows[0];
  ok('no se perdió ni cambió ninguna matrícula existente', antes.n === despues.n && antes.s === despues.s, JSON.stringify({ antes, despues }));
  ok('las matrículas existentes quedan sin solicitud (NULL) y siguen válidas', (await db.admin('select count(*)::int n from public.matriculas where solicitud_id is null')).rows[0].n === antes.n);
  // La migración falla de forma segura si falta la base de seguridad
  await db.admin(`update public.config set modo_transicion = false`);
  await db.admin(`update public.config set clave_script_hash = extensions.crypt('secreto-script-ficticio', extensions.gen_salt('bf')) where id`);
  await db.admin('delete from public.intentos; delete from public.sesiones');
  const interna = (await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, { ip: IP })).token;
  const admin = (await db.rpc('iniciar_sesion', { p_clave: 'clave-encargados-ficticia', p_rol: 'admin' }, { ip: IP })).token;
  const SEC = 'secreto-script-ficticio';
  const o = { ip: IP };

  seccion('1) Permisos: nada de lo nuevo es accesible directamente desde el navegador');
  for (const t of ['solicitudes']) {
    await falla(`anon NO puede leer la tabla ${t}`, db.comoAnon(`select * from public.${t}`), /permission denied|denegado/i);
  }
  for (const f of ['_max_estudiantes()', "_rut_limpio('1')", "_secreto_script_ok('x')", "_validar_solicitud('{}'::jsonb)", "_fichas_de_solicitud('{}'::jsonb)"]) {
    await falla(`anon NO puede ejecutar la función interna ${f.split('(')[0]}`, db.comoAnon(`select public.${f}`), /permission denied|denegado/i);
  }
  await falla('sin sesión no se pueden reservar folios', db.rpc('reservar_folios', { p_clave: 'no-es-token', p_solicitud: uuid(), p_cantidad: 1 }, o), /clave_incorrecta/);
  await falla('sin sesión no se puede guardar una solicitud', db.rpc('guardar_solicitud', { p_clave: 'no-es-token', p_solicitud: uuid(), p_fichas: [] }, o), /clave_incorrecta/);

  seccion('2) Reservar folios: consecutivos, idempotentes y con límites');
  const sid = uuid();
  const r1 = await db.rpc('reservar_folios', { p_clave: interna, p_solicitud: sid, p_cantidad: 3 }, o);
  ok('se reservan 3 folios distintos y crecientes', r1.folios.length === 3 && new Set(r1.folios).size === 3 && r1.folios[0] < r1.folios[1] && r1.folios[1] < r1.folios[2], JSON.stringify(r1));
  const seqAntes = (await db.admin('select last_value::int v from public.folio_2027_seq')).rows[0].v;
  const r1b = await db.rpc('reservar_folios', { p_clave: interna, p_solicitud: sid, p_cantidad: 3 }, o);
  ok('repetir la reserva devuelve LOS MISMOS folios y no consume otros', JSON.stringify(r1b.folios) === JSON.stringify(r1.folios) && r1b.repetida === true && (await db.admin('select last_value::int v from public.folio_2027_seq')).rows[0].v === seqAntes);
  await falla('cambiar la cantidad de una solicitud ya reservada se rechaza', db.rpc('reservar_folios', { p_clave: interna, p_solicitud: sid, p_cantidad: 2 }, o), /solicitud_invalida/);
  await falla('0 estudiantes se rechaza', db.rpc('reservar_folios', { p_clave: interna, p_solicitud: uuid(), p_cantidad: 0 }, o), /dato_invalido/);
  await falla('6 estudiantes (más del máximo de 5) se rechaza', db.rpc('reservar_folios', { p_clave: interna, p_solicitud: uuid(), p_cantidad: 6 }, o), /dato_invalido.*5/);

  seccion('3) Guardar una solicitud de 3 hermanos (cursos y condición distintos)');
  const S3 = await solicitud(interna, 3, [{ tipo: 'antiguo', curso: '1° Medio A' }, { tipo: 'nuevo' }, { tipo: 'antiguo', curso: '3° Medio B', parentesco: 'Padre' }]);
  S3.fichas[1].apoderado.parentesco = 'Tío(a)';       // el parentesco puede variar por alumno
  S3.fichas[2].apoderado.viveConEstudiante = 'no';
  const g = await db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: S3.id, p_fichas: S3.fichas }, o);
  ok('devuelve 3 matrículas con sus folios, en orden', g.ok && g.matriculas.length === 3 && g.matriculas.every((m, i) => m.folio === S3.folios[i] && m.orden === i + 1), JSON.stringify(g));
  const filas = (await db.admin('select * from public.matriculas where solicitud_id = $1 order by orden', [S3.id])).rows;
  ok('cada alumno tiene su PROPIA fila, folio único y el mismo identificador de solicitud', filas.length === 3 && new Set(filas.map(f => f.folio)).size === 3 && filas.every(f => f.solicitud_id === S3.id));
  ok('la condición antiguo/nuevo es independiente por alumno', filas.map(f => f.tipo).join() === 'antiguo,nuevo,antiguo');
  ok('los cursos son independientes por alumno', filas[0].datos.estudiante.cursoMatricula === '1° Medio A' && filas[2].datos.estudiante.cursoMatricula === '3° Medio B' && filas[1].datos.estudiante.procedencia === 'Colegio TEST');
  ok('el apoderado es el mismo en las 3 fichas', new Set(filas.map(f => f.datos.apoderado.rut)).size === 1);
  ok('el parentesco y «vive con» pueden variar por alumno', filas.map(f => f.datos.apoderado.parentesco).join() === 'Madre,Tío(a),Padre' && filas[2].datos.apoderado.viveConEstudiante === 'no');
  ok('el correo queda pendiente (hay correo del apoderado)', g.correo_estado === 'pendiente' && (await db.admin('select correo_estado from public.solicitudes where id=$1', [S3.id])).rows[0].correo_estado === 'pendiente');

  seccion('4) Reintentos: doble clic, recarga o error de red NO duplican matrículas ni folios');
  const g2 = await db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: S3.id, p_fichas: S3.fichas }, o);
  ok('repetir el guardado devuelve lo ya guardado (repetida) con los mismos folios', g2.ok && g2.repetida === true && JSON.stringify(g2.matriculas.map(m => m.folio)) === JSON.stringify(S3.folios));
  ok('siguen existiendo exactamente 3 filas para la solicitud', (await db.admin('select count(*)::int n from public.matriculas where solicitud_id=$1', [S3.id])).rows[0].n === 3);
  const S2 = await solicitud(interna, 2, { base: 20 });
  const paralelo = await Promise.allSettled([1, 2, 3].map(() => db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: S2.id, p_fichas: S2.fichas }, o)));
  ok('3 envíos simultáneos (doble clic) → todos terminan bien y quedan exactamente 2 matrículas', paralelo.every(p => p.status === 'fulfilled') && (await db.admin('select count(*)::int n from public.matriculas where solicitud_id=$1', [S2.id])).rows[0].n === 2, JSON.stringify(paralelo.map(p => p.status)));
  ok('solo UNO de ellos fue el que guardó (los demás fueron repeticiones)', paralelo.filter(p => p.value && p.value.repetida === false).length === 1);
  const fichasOtras = S3.fichas.map(f => ({ ...f, estudiante: { ...f.estudiante, rut: rut(39999999), nombre: 'Otro' } }));
  await falla('reusar la misma solicitud con OTROS datos se rechaza', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: S3.id, p_fichas: fichasOtras }, o), /solicitud_invalida.*otros datos/);

  seccion('5) Errores parciales: se guardan TODAS o NINGUNA');
  const E1 = await solicitud(interna, 3, { base: 40 });
  E1.fichas[2].estudiante.rut = '11.111.111-9';        // RUT inválido en el 3.er estudiante
  const antesE1 = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;
  await falla('un RUT inválido en el estudiante 3 se rechaza y nombra al estudiante', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E1.id, p_fichas: E1.fichas }, o), /Estudiante 3: el RUT del estudiante no es válido/);
  ok('no se guardó NINGUNA de las 3 (ni los estudiantes 1 y 2, que estaban bien)', (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n === antesE1);
  ok('la solicitud sigue «reservada» y se puede corregir y reintentar', (await db.admin('select estado from public.solicitudes where id=$1', [E1.id])).rows[0].estado === 'reservada');
  E1.fichas[2].estudiante.rut = rut(30000142);
  const gE1 = await db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E1.id, p_fichas: E1.fichas }, o);
  ok('corregido el dato, el reintento guarda las 3 con los MISMOS folios reservados', gE1.ok && gE1.matriculas.map(m => m.folio).join() === E1.folios.join());
  const E2 = await solicitud(interna, 2, { base: 50 }); E2.fichas[1].estudiante.nombre = 'Ana <img src=x onerror=alert(1)>';
  await falla('HTML/JavaScript en un campo se rechaza (indica el estudiante)', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E2.id, p_fichas: E2.fichas }, o), /Estudiante 2:.*caracteres no permitidos/);
  const E3 = await solicitud(interna, 2, { base: 60 }); E3.fichas[1].estudiante.rut = E3.fichas[0].estudiante.rut;
  await falla('el mismo estudiante dos veces en una solicitud se rechaza', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E3.id, p_fichas: E3.fichas }, o), /Estudiante 2: el RUT está repetido/);
  const E4 = await solicitud(interna, 2, { base: 70 }); E4.fichas[1].apoderado.rut = rut(21000000);
  await falla('apoderados distintos dentro de una solicitud se rechazan', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E4.id, p_fichas: E4.fichas }, o), /el apoderado debe ser el mismo/);
  const E5 = await solicitud(interna, 2, { base: 80 }); E5.fichas[0].folio = '999999';
  await falla('un folio inventado (no reservado) se rechaza', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E5.id, p_fichas: E5.fichas }, o), /folio_invalido.*no corresponde/);
  const E6 = await solicitud(interna, 2, { base: 90 }); E6.fichas[0].folio = String(S3.folios[0]);
  await falla('usar el folio de OTRA solicitud ya guardada se rechaza', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E6.id, p_fichas: E6.fichas }, o), /folio_invalido.*no corresponde/);
  const E7 = await solicitud(interna, 2, { base: 100 });
  await falla('cantidad de fichas distinta a la reservada se rechaza', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E7.id, p_fichas: [E7.fichas[0]] }, o), /cantidad/);
  await falla('una solicitud inexistente (sin reservar folios) se rechaza', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: uuid(), p_fichas: [E7.fichas[0]] }, o), /solicitud_invalida/);
  const E8 = await solicitud(interna, 1, { base: 110 }); E8.fichas[0].campoExtra = 'x';
  await falla('un campo desconocido en la ficha se rechaza', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E8.id, p_fichas: E8.fichas }, o), /campo no permitido/);
  const E9 = await solicitud(interna, 1, { base: 120 }); E9.fichas[0].apoderado.parentesco = 'Pariente raro';
  await falla('un parentesco fuera de la lista se rechaza', db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: E9.id, p_fichas: E9.fichas }, o), /parentesco/);

  seccion('6) Solicitud de UN estudiante (compatible con el flujo individual) y sin correo');
  const U1 = await solicitud(interna, 1, { base: 130 }); U1.fichas[0].apoderado.correo = '';
  const gU1 = await db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: U1.id, p_fichas: U1.fichas }, o);
  ok('una solicitud de 1 estudiante se guarda y, sin correo del apoderado, queda «sin_correo»', gU1.ok && gU1.matriculas.length === 1 && gU1.correo_estado === 'sin_correo');
  const dupli = await solicitud(interna, 1, { base: 130 }); // mismo RUT que el anterior, en otra solicitud
  const gD = await db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: dupli.id, p_fichas: dupli.fichas }, o);
  ok('el mismo RUT en OTRA solicitud no se bloquea, pero devuelve una advertencia con el folio existente', gD.ok && gD.advertencias.length === 1 && gD.advertencias[0].folio_existente === U1.folios[0], JSON.stringify(gD.advertencias));
  const L = await db.rpc('guardar_matricula', { p_clave: interna, p_ficha: conFolio(fichaEst(140), await db.rpc('obtener_folio', { p_clave: interna }, o)) }, o);
  ok('el guardado individual anterior (guardar_matricula) sigue funcionando', !!L);

  seccion('7) Correo: el Apps Script reserva el envío (secreto + token) y los datos salen de la base');
  const m = await db.rpc('reservar_envio', { p_secreto: 'secreto-incorrecto', p_solicitud: S3.id, p_token: interna }, { ip: '198.51.100.50' });
  ok('con un secreto incorrecto no entrega nada', m.ok === false && m.motivo === 'secreto' && !('destinatario' in m));
  ok('un token inválido se rechaza', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_token: 'f'.repeat(64) }, o)).motivo === 'sesion');
  ok('una solicitud inexistente se rechaza', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: uuid(), p_token: interna }, o)).motivo === 'no_encontrada');
  ok('una solicitud solo reservada (sin guardar) no se envía', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: E7.id, p_token: interna }, o)).motivo === 'no_guardada');
  ok('una solicitud sin correo no se envía', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: U1.id, p_token: interna }, o)).motivo === 'sin_correo');
  const rv = await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_token: interna }, o);
  ok('con secreto y token válidos entrega destinatario y los 3 estudiantes (de la base, en orden)', rv.ok && rv.destinatario === 'apoderado.test@example.invalid' && rv.estudiantes.length === 3 && rv.estudiantes.map(e => e.folio).join() === S3.folios.join() && rv.estudiantes[0].cursoMatricula === '1° Medio A' && rv.estudiantes[1].procedencia === 'Colegio TEST', JSON.stringify(rv).slice(0, 200));
  ok('el estado pasa a «enviando»', (await db.admin('select correo_estado from public.solicitudes where id=$1', [S3.id])).rows[0].correo_estado === 'enviando');
  ok('un segundo intento simultáneo se rechaza (en_proceso): evita correos duplicados', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_token: interna }, o)).motivo === 'en_proceso');
  ok('registrar un error deja la solicitud «error» (matrículas intactas)', (await db.rpc('registrar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_resultado: 'error', p_detalle: 'servicio_correo' }, o)).ok === true
      && (await db.admin('select correo_estado, correo_detalle from public.solicitudes where id=$1', [S3.id])).rows[0].correo_estado === 'error'
      && (await db.admin('select count(*)::int n from public.matriculas where solicitud_id=$1', [S3.id])).rows[0].n === 3);
  const rv2 = await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_token: admin }, o);
  ok('tras un error se puede reintentar (con sesión de funcionario o de encargados)', rv2.ok === true);
  ok('registrar «enviado» lo marca como enviado', (await db.rpc('registrar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_resultado: 'enviado', p_detalle: null }, o)).ok && (await db.admin('select correo_estado, correo_enviado is not null e from public.solicitudes where id=$1', [S3.id])).rows[0].e === true);
  ok('una solicitud ya enviada NO se vuelve a enviar (ya_enviado)', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_token: interna }, o)).motivo === 'ya_enviado');
  ok('registrar_envio sin estar «enviando» se rechaza', (await db.rpc('registrar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_resultado: 'enviado', p_detalle: null }, o)).motivo === 'estado');
  ok('registrar_envio con secreto incorrecto se rechaza', (await db.rpc('registrar_envio', { p_secreto: 'no', p_solicitud: S2.id, p_resultado: 'enviado', p_detalle: null }, { ip: '198.51.100.51' })).motivo === 'secreto');
  ok('un resultado inventado se rechaza', (await db.rpc('registrar_envio', { p_secreto: SEC, p_solicitud: S2.id, p_resultado: 'cualquiera', p_detalle: null }, o)).motivo === 'resultado');
  // límite de reintentos
  for (let i = 0; i < 6; i++) { const x = await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: S2.id, p_token: interna }, o); if (x.ok) await db.rpc('registrar_envio', { p_secreto: SEC, p_solicitud: S2.id, p_resultado: 'error', p_detalle: null }, o); }
  ok('tras 6 intentos fallidos se detiene (demasiados_reintentos): no se puede insistir sin límite', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: S2.id, p_token: interna }, o)).motivo === 'demasiados_reintentos');
  // funcionario y solicitudes antiguas
  await db.admin(`update public.solicitudes set creada = now() - interval '25 hours', correo_estado='pendiente', correo_intentos=0 where id=$1`, [E1.id]);
  ok('un funcionario no puede enviar una solicitud de hace más de 24 h…', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: E1.id, p_token: interna }, o)).motivo === 'sesion');
  ok('…pero el panel de encargados (admin) sí', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: E1.id, p_token: admin }, o)).ok === true);
  // fuerza bruta del secreto
  await db.admin('delete from public.intentos');
  for (let i = 0; i < 5; i++) await db.rpc('reservar_envio', { p_secreto: 'mal' + i, p_solicitud: S3.id, p_token: interna }, { ip: '198.51.100.99' });
  ok('tras 5 secretos incorrectos la conexión queda bloqueada, incluso con el secreto correcto', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_token: interna }, { ip: '198.51.100.99' })).motivo === 'bloqueado');
  ok('otra conexión no se ve afectada', (await db.rpc('reservar_envio', { p_secreto: SEC, p_solicitud: S3.id, p_token: interna }, { ip: '198.51.100.98' })).motivo === 'ya_enviado');
  await db.admin(`update public.config set clave_script_hash = null where id`);
  ok('sin secreto configurado en la base, nada se puede reservar (falla cerrada)', (await db.rpc('reservar_envio', { p_secreto: '', p_solicitud: S3.id, p_token: interna }, { ip: '198.51.100.97' })).motivo === 'secreto');
  await db.admin(`update public.config set clave_script_hash = extensions.crypt($1, extensions.gen_salt('bf')) where id`, [SEC]);
  await db.admin('delete from public.intentos');

  seccion('8) Panel: listar, editar y eliminar sin afectar a los hermanos');
  await falla('listar_matriculas exige sesión de encargados (la de funcionarios no sirve)', db.rpc('listar_matriculas', { p_clave: interna }, o), /clave_incorrecta/);
  const lista = await db.rpc('listar_matriculas', { p_clave: admin }, o);
  const hermanos = lista.filter(x => x._solicitud === S3.id);
  ok('cada fila trae el identificador de solicitud, el orden y la cantidad de hermanos', hermanos.length === 3 && hermanos.every(x => x._hermanos === 3) && hermanos.map(x => x._orden).join() === '1,2,3');
  ok('trae el estado del correo de la solicitud', hermanos.every(x => x._correo === 'enviado'));
  ok('las matrículas anteriores a la migración se listan igual (sin solicitud, 1 hermano)', lista.filter(x => x._solicitud === null).length >= antes.n && lista.filter(x => x._solicitud === null).every(x => x._hermanos === 1));
  ok('la lista sigue ordenada por folio y conserva los campos de siempre', lista.every((x, i) => i === 0 || Number(x.folio) >= Number(lista[i - 1].folio)) && hermanos[0].estudiante.nombre && hermanos[0].apoderado.nombre);
  const key1 = hermanos[0]._key, key2 = hermanos[1]._key;
  const fed = { ...conFolio(fichaEst(100 + 0, { tipo: 'antiguo', curso: '1° Medio A' }), S3.folios[0]) }; fed.estudiante.celular = '+56 9 9999 9999';
  await db.rpc('actualizar_matricula', { p_clave: admin, p_id: key1, p_ficha: fed }, o);
  const post = (await db.admin('select orden, datos->\'estudiante\'->>\'celular\' c from public.matriculas where solicitud_id=$1 order by orden', [S3.id])).rows;
  ok('editar a un hermano NO altera a los otros dos', post[0].c === '+56 9 9999 9999' && post[1].c === '+56 9 0000 0000' && post[2].c === '+56 9 0000 0000');
  await db.rpc('eliminar_matricula', { p_clave: admin, p_id: key2 }, o);
  ok('eliminar a un hermano deja a los otros dos y la solicitud', (await db.admin('select count(*)::int n from public.matriculas where solicitud_id=$1', [S3.id])).rows[0].n === 2 && (await db.admin('select count(*)::int n from public.solicitudes where id=$1', [S3.id])).rows[0].n === 1);
  const resto = (await db.admin('select id from public.matriculas where solicitud_id=$1', [S3.id])).rows.map(r => r.id);
  for (const id of resto) await db.rpc('eliminar_matricula', { p_clave: admin, p_id: id }, o);
  ok('al eliminar la última matrícula de la solicitud, la solicitud también se retira', (await db.admin('select count(*)::int n from public.solicitudes where id=$1', [S3.id])).rows[0].n === 0);
  const folioViejo = (await db.admin('select min(folio)::int f from public.matriculas where solicitud_id is null')).rows[0].f;
  await db.rpc('cambiar_folio_matricula', { p_clave: admin, p_id: (await db.admin('select id from public.matriculas where solicitud_id=$1 limit 1', [S2.id])).rows[0].id, p_folio: 7777 }, o);
  ok('cambiar el N° de ficha de un alumno de una solicitud funciona sin tocar a su hermano', (await db.admin('select count(*)::int n from public.matriculas where solicitud_id=$1', [S2.id])).rows[0].n === 2 && (await db.admin('select count(*)::int n from public.matriculas where folio=7777')).rows[0].n === 1);

  seccion('9) Pre-matrícula del apoderado con varios estudiantes');
  const base = { apoderado: fichaEst(1).apoderado, suplente: null, estudiantes: [{ tipo: 'nuevo', estudiante: fichaEst(201).estudiante }, { tipo: 'antiguo', estudiante: fichaEst(202, { tipo: 'antiguo', curso: '4° Medio C' }).estudiante, parentesco: 'Abuelo(a)', viveConEstudiante: 'no' }] };
  const cod = await db.rpc('crear_prematricula', { p_datos: base }, { ip: '203.0.113.21' });
  ok('se crea una pre-matrícula de 2 estudiantes y se recibe un único código', /^[A-HJ-NP-Z2-9]{6}$/.test(cod) || /^[0-9]{4}$/.test(cod), cod);
  const cargada = await db.rpc('cargar_prematricula', { p_clave: interna, p_codigo: cod }, o);
  ok('el funcionario recupera los 2 estudiantes y los datos compartidos con ese código', cargada.estudiantes.length === 2 && cargada.estudiantes[1].parentesco === 'Abuelo(a)' && cargada.apoderado.rut === base.apoderado.rut);
  const mal = JSON.parse(JSON.stringify(base)); mal.estudiantes[1].estudiante.nombre = '<script>alert(1)</script>';
  await falla('HTML en el estudiante 2 de una pre-matrícula se rechaza e indica cuál', db.rpc('crear_prematricula', { p_datos: mal }, { ip: '203.0.113.22' }), /Estudiante 2:.*caracteres no permitidos/);
  const seis = { ...base, estudiantes: Array.from({ length: 6 }, (_, i) => ({ tipo: 'nuevo', estudiante: fichaEst(300 + i).estudiante })) };
  await falla('6 estudiantes en una pre-matrícula se rechazan', db.rpc('crear_prematricula', { p_datos: seis }, { ip: '203.0.113.23' }), /hasta 5 estudiantes/);
  const raro = { ...base, estudiantes: [{ tipo: 'nuevo', estudiante: fichaEst(310).estudiante, rol: 'admin' }] };
  await falla('un campo desconocido dentro de un estudiante se rechaza', db.rpc('crear_prematricula', { p_datos: raro }, { ip: '203.0.113.24' }), /campo no permitido/);
  await falla('el campo trampa (robot) sigue funcionando', db.rpc('crear_prematricula', { p_datos: { ...base, _hp: 'x' } }, { ip: '203.0.113.25' }), /solicitud_invalida/);
  const rep = { ...base, estudiantes: [base.estudiantes[0], base.estudiantes[0]] };
  await falla('el mismo estudiante repetido en la pre-matrícula se rechaza', db.rpc('crear_prematricula', { p_datos: rep }, { ip: '203.0.113.26' }), /RUT está repetido/);
  const unaSola = await db.rpc('crear_prematricula', { p_datos: fichaEst(320) }, { ip: '203.0.113.27' });
  ok('el formato anterior (un estudiante) sigue aceptándose', !!unaSola);
  const cu = await db.rpc('cargar_prematricula', { p_clave: interna, p_codigo: unaSola }, o);
  ok('y se recupera igual que antes', cu.estudiante.nombre === 'Estudiante TEST 320' && !('estudiantes' in cu));
  const iso = await db.rpc('cargar_prematricula', { p_clave: interna, p_codigo: cod }, o);
  ok('cada código entrega solo SU solicitud (no la de otro apoderado)', iso.estudiantes[0].estudiante.nombre === 'Estudiante TEST 201' && !JSON.stringify(iso).includes('Estudiante TEST 320'));

  seccion('10) Limpieza, auditoría y compatibilidad');
  await db.admin(`insert into public.solicitudes (id, creada, cantidad, folios) values ($1, now() - interval '40 days', 1, '{99001}'), ($2, now() - interval '1 day', 1, '{99002}')`, [uuid(), uuid()]);
  const nMat = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n, nGuard = (await db.admin(`select count(*)::int n from public.solicitudes where estado='guardada'`)).rows[0].n;
  const lim = (await db.admin('select public.limpiar_vencidos(30) r')).rows[0].r;
  ok('la limpieza retira solicitudes reservadas y nunca guardadas con más de 30 días', lim.solicitudes_sin_guardar >= 1);
  ok('la limpieza NO toca matrículas ni solicitudes guardadas', (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n === nMat && (await db.admin(`select count(*)::int n from public.solicitudes where estado='guardada'`)).rows[0].n === nGuard);
  ok('la limpieza conserva las solicitudes recientes', (await db.admin(`select count(*)::int n from public.solicitudes where folios = '{99002}'`)).rows[0].n === 1);
  const aud = (await db.admin(`select detalle::text d from public.auditoria where accion in ('guardar_solicitud','reservar_folios','correo_solicitud')`)).rows.map(r => r.d).join(' ');
  ok('la auditoría registró guardados y envíos', aud.length > 0);
  ok('la auditoría NO contiene nombres, RUT ni correos', !/TEST|apoderado\.test|\d{1,2}\.\d{3}\.\d{3}/i.test(aud), aud.slice(0, 200));
  ok('el máximo de estudiantes del servidor es 5 (igual que la página)', (await db.admin('select public._max_estudiantes() n')).rows[0].n === 5);
  ok('RLS sigue activo en solicitudes y en las tablas anteriores', (await db.admin(`select bool_and(relrowsecurity) b from pg_class where relname in ('solicitudes','matriculas','prematriculas','config','sesiones','intentos','auditoria') and relnamespace='public'::regnamespace`)).rows[0].b === true);

  await db.cerrar();
  console.log(`\nResultado: ${pasadas} pruebas correctas, ${falladas} fallidas`);
  process.exit(falladas ? 1 : 0);
})().catch(e => { console.error('Error inesperado:', e); process.exit(2); });
