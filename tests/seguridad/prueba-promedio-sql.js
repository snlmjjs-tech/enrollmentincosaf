// Prueba de la migración 004 (promedio de egreso de 8° básico) contra un Postgres LOCAL con datos ficticios.
// Simula producción ANTES de la migración (la función de validación sin el campo), aplica la migración y comprueba que:
//   · antes: el servidor rechaza el campo; después: lo acepta solo si es una nota de 1,0 a 7,0;
//   · no se pierde ni cambia nada existente y se puede repetir.
// Uso: PGPORT=5499 node tests/seguridad/prueba-promedio-sql.js   (con la base preparada por prepara-postgres.sh)
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
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
const rut = n => { let s = 0, m = 2; for (const d of String(n).split('').reverse()) { s += d * m; m = m === 7 ? 2 : m + 1; } const r = 11 - s % 11; return n + '-' + (r === 11 ? '0' : r === 10 ? 'K' : r); };
const prem = (n, promedio) => ({ tipo: 'nuevo',
  estudiante: { nombre: `Estudiante TEST ${n}`, rut: rut(30000000 + n), fnac: '2012-03-15', direccion: 'Calle Ficticia 1', comuna: 'Comuna TEST', nacionalidad: 'Chilena', celular: '+56 9 0000 0000', correo: '',
    procedencia: 'Colegio TEST', cursoMatricula: '1° Medio', repitencia: 'no', repCurso: '', repAnio: '', pie: 'no', pieDiagnostico: '', pieDocumentacion: '', salud: 'no', saludDetalle: '', observaciones: '',
    ...(promedio === undefined ? {} : { promedio8: promedio }) },
  apoderado: { nombre: 'Apoderado TEST', rut: rut(20000000), edad: '40', direccion: 'Calle Ficticia 1', comuna: 'Comuna TEST', nacionalidad: 'Chilena', celular: '+56 9 0000 0001', correo: 'apoderado.test@example.invalid',
    parentesco: 'Madre', viveConEstudiante: 'si', nivelEducacional: 'Titulado de una Universidad', situacionLaboral: 'Trabaja jornada completa (todo el día)', lugarTrabajo: 'Fuera del hogar' }, suplente: null });
let ipN = 20; const crear = (p) => db.rpc('crear_prematricula', { p_datos: p }, { ip: '203.0.113.' + (ipN++) });

(async () => {
  seccion('0) Producción ANTES de la migración 004: base de seguridad + 002 + 003, con la validación sin el campo');
  // Se arma una copia del esquema SIN lo agregado por 004 (así se prueba la migración sobre el estado real anterior)
  let esq = fs.readFileSync(path.join(RAIZ, 'supabase/schema.sql'), 'utf8');
  const sinCampo = esq.replace("'procedencia','promedio8',", "'procedencia',").replace(/\n  -- Promedio de egreso de 8° básico \(opcional\)[\s\S]*?\n  end if;\n  perform public\._validar_seccion\('apoderado'/, "\n  perform public._validar_seccion('apoderado'");
  if (sinCampo === esq || sinCampo.includes('promedio8')) { registrar('(preparación) se pudo armar el esquema anterior', false, 'el esquema actual no tiene la forma esperada'); process.exit(1); }
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prom8-')), 'schema_anterior.sql'); fs.writeFileSync(tmp, sinCampo);
  for (const f of [tmp, path.join(RAIZ, 'supabase/migraciones/002_matricula_multiple.sql'), path.join(RAIZ, 'supabase/migraciones/003_cifrado.sql')]) { try { psql(f); registrar(`${path.basename(f)} se aplica`, true); } catch (e) { registrar(`${path.basename(f)} se aplica`, false, e.stderr.toString().slice(0, 300)); process.exit(1); } }
  const antes = (await db.admin('select count(*)::int n, coalesce(sum(folio),0)::int s, md5(coalesce(string_agg(datos::text, \'\' order by folio), \'\')) h from public.matriculas')).rows[0];
  await falla('antes de la migración el servidor rechaza el campo nuevo («campo no permitido»)', crear(prem(1, '5,8')), /campo no permitido/);
  ok('antes de la migración una ficha sin el campo se acepta (nada cambió)', typeof (await crear(prem(2))) === 'string');

  seccion('1) Se aplica la migración 004 (y se puede repetir)');
  try { psql(path.join(RAIZ, 'supabase/migraciones/004_promedio_egreso_8vo.sql')); registrar('la migración 004 se aplica sin errores', true); } catch (e) { registrar('la migración 004 se aplica', false, e.stderr.toString().slice(0, 400)); process.exit(1); }
  try { psql(path.join(RAIZ, 'supabase/migraciones/004_promedio_egreso_8vo.sql')); registrar('se puede ejecutar de nuevo (idempotente)', true); } catch (e) { registrar('idempotente', false, e.stderr.toString().slice(0, 300)); }
  const despues = (await db.admin('select count(*)::int n, coalesce(sum(folio),0)::int s, md5(coalesce(string_agg(datos::text, \'\' order by folio), \'\')) h from public.matriculas')).rows[0];
  ok('no se perdió ni cambió ninguna matrícula existente', JSON.stringify(antes) === JSON.stringify(despues), JSON.stringify({ antes, despues }));
  await falla('la función interna de validación sigue sin ser accesible desde el navegador', db.comoAnon("select public._validar_ficha('{}'::jsonb, false)"), /permission denied|denegado/i);

  seccion('2) Después: el promedio se acepta solo si es una nota de 1,0 a 7,0');
  for (const v of ['5,8', '7', '7,0', '1', '1,0', '6,75', '4,05', '']) ok(`se acepta «${v === '' ? '(vacío)' : v}»`, typeof (await crear(prem(3, v))) === 'string');
  ok('sin el campo (ficha antigua o estudiante antiguo) se sigue aceptando', typeof (await crear(prem(4))) === 'string');
  for (const v of ['7,5', '7,01', '8', '9', '0', '0,9', '5,888', '5.8', 'abc', '-1', '1e1', '5,', ',5', '5 ,8', '10']) await falla(`se rechaza «${v}»`, crear(prem(5, v)), /promedio de egreso de 8° debe ser una nota de 1,0 a 7,0/);
  await falla('un promedio que no es texto (número) se rechaza', crear(prem(6, 5.8)), /debe ser texto|dato_invalido/i);
  await falla('un promedio con símbolos < > se rechaza', crear(prem(7, '<5>')), /no permitidos|promedio de egreso|dato_invalido/i);

  seccion('3) El promedio viaja con la matrícula: se guarda, se lista y se puede editar');
  await db.admin(`update public.config set modo_transicion = false, exigir_cifrado = false`);
  await db.admin(`update public.config set clave_interna_hash = extensions.crypt('clave-funcionarios-ficticia', extensions.gen_salt('bf')), clave_hash = extensions.crypt('clave-encargados-ficticia', extensions.gen_salt('bf')) where id`);
  await db.admin('delete from public.intentos; delete from public.sesiones');
  const o = { ip: '198.51.100.9' };
  const interna = (await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, o)).token;
  const admin = (await db.rpc('iniciar_sesion', { p_clave: 'clave-encargados-ficticia', p_rol: 'admin' }, o)).token;
  const sid = require('crypto').randomUUID(); const rf = await db.rpc('reservar_folios', { p_clave: interna, p_solicitud: sid, p_cantidad: 1 }, o);
  const ficha = { ...prem(50, '6,2'), folio: String(rf.folios[0]), fechaRegistro: '23-10-2026, 10:00:00' };
  await db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: sid, p_fichas: [ficha] }, o);
  const lista = await db.rpc('listar_matriculas', { p_clave: admin }, o); const fila = lista.find(f => f.estudiante && f.estudiante.nombre === 'Estudiante TEST 50');
  ok('guardar_solicitud guarda el promedio y listar_matriculas lo devuelve', fila && fila.estudiante.promedio8 === '6,2');
  await db.rpc('actualizar_matricula', { p_clave: admin, p_id: fila._key, p_ficha: { ...ficha, estudiante: { ...ficha.estudiante, promedio8: '6,9' } } }, o);
  ok('actualizar_matricula permite corregir el promedio', (await db.admin('select datos->\'estudiante\'->>\'promedio8\' p from public.matriculas where id = $1', [fila._key])).rows[0].p === '6,9');
  await falla('guardar una matrícula con un promedio inválido se rechaza', db.rpc('actualizar_matricula', { p_clave: admin, p_id: fila._key, p_ficha: { ...ficha, estudiante: { ...ficha.estudiante, promedio8: '7,5' } } }, o), /promedio de egreso de 8°/);

  console.log(`\nResultado: ${pasadas} pruebas correctas, ${falladas} fallidas`);
  await db.cerrar();
  process.exit(falladas ? 1 : 0);
})().catch(e => { console.log('✘ Error inesperado: ' + (e && e.stack || e)); process.exit(1); });
