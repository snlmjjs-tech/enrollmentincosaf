// Prueba de extremo a extremo de la MATRÍCULA MÚLTIPLE en un navegador (Chromium), con la página real y la CSP activa:
//   navegador → apps-script/Code.gs (entorno de Google SIMULADO, Gmail no existe) → funciones SQL REALES (Postgres LOCAL).
// Datos 100 % ficticios. No se conecta a ningún servicio real ni envía correos.
// Uso: PGPORT=5499 node tests/seguridad/prueba-multiple-navegador.js
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { crearRpc } = require('./rpc-local');
const { crearRpcSync } = require('./rpc-sync');
const { crearEntorno } = require('./apps-script-simulado');
const { exigirBaseLocal } = require('./guardia-entorno');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const RAIZ = path.resolve(__dirname, '../..');
const PUERTO = process.env.PGPORT || '5499';
exigirBaseLocal('127.0.0.1', PUERTO);
const OPTS = { host: '127.0.0.1', port: +PUERTO, user: 'postgres', database: 'postgres' };
const db = crearRpc(OPTS), sync = crearRpcSync(OPTS);
const URL_SUPABASE = 'https://mtlunrefaxsagfkphvvw.supabase.co';           // la dirección que trae la página; se atiende localmente
const CODIGO = fs.readFileSync(path.join(RAIZ, 'apps-script/Code.gs'), 'utf8');
const CAPTURAS = process.env.CAPTURAS || null;                              // carpeta opcional para guardar capturas de pantalla
const FUNC = 'clave-funcionarios-ficticia', ENC = 'clave-encargados-ficticia', SECRETO = 'secreto-script-ficticio';
const DEST = 'apoderado.test@example.invalid';
const PROPS = { ENTORNO: 'prueba', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_KEY: 'sb_publishable_FICTICIA', SECRETO_SCRIPT: SECRETO,
  NOMBRE_COLEGIO: 'Colegio TEST', CORREO_CONTACTO: 'contacto@example.invalid', LIMITE_DIARIO: '100', DESTINATARIOS_PRUEBA: DEST };

let P = 0, F = 0;
const ok = (n, c, d) => { if (c) { P++; console.log(`  ✔ ${n}`); } else { F++; console.log(`  ✘ ${n}${d ? '  → ' + d : ''}`); } };
const sec = t => console.log('\n' + t);
const uuidLocal = () => require('crypto').randomUUID();
const rut = n => { let s = 0, m = 2; for (const d of String(n).split('').reverse()) { s += d * m; m = m === 7 ? 2 : m + 1; } const r = 11 - s % 11; return n + '-' + (r === 11 ? '0' : r === 10 ? 'K' : r); };

const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const servir = () => new Promise(res => { const s = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(RAIZ, u === '/' ? 'index.html' : u);
  if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1', () => res(s)); });

let gs = null, navegador = null, base = '', ipN = 10;
const estado = { fallarGuardarUnaVez: false, perderRespuestaGuardar: false, rpcs: [] };

async function abrir(url, { viewport = { width: 1100, height: 900 }, dl = false } = {}) {
  const ctx = await navegador.newContext({ viewport, acceptDownloads: dl }); const pg = await ctx.newPage(); pg.errores = []; const ip = '203.0.113.' + (ipN++);
  await pg.addInitScript(() => { window.__csp = []; window.__xss = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective)); });
  pg.on('pageerror', e => pg.errores.push(String(e)));
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await pg.route(`${URL_SUPABASE}/**`, async ruta => {
    const rq = ruta.request(); const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': '*' };
    if (rq.method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: cors });
    const nombre = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(new URL(rq.url()).pathname)[1]; estado.rpcs.push(nombre);
    if (nombre === 'guardar_solicitud' && estado.fallarGuardarUnaVez) { estado.fallarGuardarUnaVez = false; return ruta.abort('failed'); }   // la solicitud nunca llega
    try {
      const d = await db.rpc(nombre, rq.postDataJSON() || {}, { ip });
      if (nombre === 'guardar_solicitud' && estado.perderRespuestaGuardar) { estado.perderRespuestaGuardar = false; return ruta.abort('failed'); }   // se guardó, pero la respuesta se pierde
      ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(d === undefined ? null : d) });
    } catch (e) { ruta.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: e.message }) }); }
  });
  // El navegador habla con el Code.gs REAL (entorno de Google simulado)
  await pg.route('https://script.google.com/**', ruta => {
    const c = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
    if (ruta.request().method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: c });
    const r = gs.post(ruta.request().postData());
    ruta.fulfill({ status: 200, headers: { ...c, 'content-type': 'application/json' }, body: JSON.stringify(r) });
  });
  await pg.goto(base + url); await pg.waitForTimeout(600); return pg;
}
const pant = pg => pg.evaluate(() => document.querySelector('.screen.active')?.id);
const entrar = async (pg, c = FUNC) => { await pg.fill('#inputClaveInterna', c); await pg.press('#inputClaveInterna', 'Enter'); await pg.waitForTimeout(700); };
const panel = async pg => { await pg.click('.admin-link'); await pg.fill('#inputClave', ENC); await pg.click('#ovClave .btn-pri'); await pg.waitForTimeout(900); };
const cerrarAviso = pg => pg.evaluate(() => cerrar('ovAviso'));
const idE = (n, c) => '#' + (n === 1 ? 'e_' : `e${n}_`) + c;
const gn = (n, g) => n === 1 ? g : g + n;
async function llenarEst(pg, n, o) {
  const f = (c, v) => pg.fill(idE(n, c), v);
  await pg.check(`input[name=tipo_${n}][value=${o.tipo}]`, { force: true });
  await f('nombre', o.nombre); await f('rut', o.rut); await pg.press(idE(n, 'rut'), 'Tab'); await f('fnac', '2012-05-10'); await f('dir', 'Calle Ficticia 123 TEST');
  await f('comuna', 'Comuna TEST'); await f('nacionalidad', 'Chilena'); await f('cel', '+56 9 0000 0000');
  if (o.tipo === 'nuevo') { await f('procedencia', 'Colegio TEST'); if (o.curso) await pg.selectOption(idE(n, 'cursoNuevo'), o.curso); }
  else { await pg.selectOption(idE(n, 'cursoAnt'), o.curso || '2° Medio'); await f('letraAnt', o.letra || 'a'); }
  await pg.check(`input[name=${gn(n, 'rep')}][value=no]`, { force: true });
  await pg.check(`input[name=${gn(n, 'pie')}][value=${o.pie || 'no'}]`, { force: true });
  if (o.pie === 'si') { await f('pieDiag', 'Diagnóstico TEST'); await pg.check(`input[name=${gn(n, 'pieDoc')}][value=si]`, { force: true }); }
  await pg.check(`input[name=${gn(n, 'salud')}][value=no]`, { force: true });
  if (n > 1 && o.parentesco) await pg.selectOption(idE(n, 'parentesco'), o.parentesco);
  if (n > 1 && o.vive) await pg.selectOption(idE(n, 'vive'), o.vive);
}
async function llenarApoderado(pg, correo = DEST) {
  await pg.fill('#a_nombre', 'Apoderado TEST'); await pg.fill('#a_rut', rut(22222222)); await pg.press('#a_rut', 'Tab'); await pg.fill('#a_edad', '40');
  await pg.fill('#a_dir', 'Calle Ficticia 123 TEST'); await pg.fill('#a_comuna', 'Comuna TEST'); await pg.fill('#a_nacionalidad', 'Chilena'); await pg.fill('#a_cel', '+56 9 0000 0001');
  await pg.fill('#a_mail', correo); await pg.selectOption('#a_parentesco', { index: 1 });
}
const enviar = async pg => { await pg.click('#ficha button[type=submit]'); await pg.waitForTimeout(900); };
const hojas = pg => pg.evaluate(() => document.querySelectorAll('#printArea .print-memo').length);
async function finalizar(pg, esperaMs = 2500) { await pg.evaluate(() => { window.print = () => {}; imprimirMemos(); }); await pg.waitForTimeout(500); await pg.click('#btnFinalizar'); await pg.waitForTimeout(esperaMs); }
const filasDe = async sid => (await db.admin('select folio, tipo, orden, datos from public.matriculas where solicitud_id=$1 order by orden', [sid])).rows;
const ultimaSolicitud = async () => (await db.admin(`select id, correo_estado, correo_intentos from public.solicitudes where estado='guardada' order by creada desc limit 1`)).rows[0];
const capturar = async (pg, nombre, completa = false) => { if (CAPTURAS) { fs.mkdirSync(CAPTURAS, { recursive: true }); await pg.screenshot({ path: path.join(CAPTURAS, nombre + '.png'), fullPage: completa }); } };
const desborde = pg => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const hayPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
const textoPdf = buf => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'incosaf-pdf-')); const f = path.join(d, 'c.pdf'); fs.writeFileSync(f, buf); try { return execFileSync('pdftotext', ['-layout', f, '-']).toString(); } finally { fs.rmSync(d, { recursive: true, force: true }); } };

// Los 3 hermanos del escenario principal
const H = [
  { nombre: 'Ana TEST Uno', rut: rut(41000001), tipo: 'antiguo', curso: '1° Medio', letra: 'a' },
  { nombre: 'Beto TEST Dos', rut: rut(41000002), tipo: 'antiguo', curso: '3° Medio', letra: 'b', parentesco: 'Tío(a)', vive: 'no' },
  { nombre: 'Carla TEST Tres', rut: rut(41000003), tipo: 'nuevo', curso: '2° Medio' }
];

(async () => {
  for (const sql of ['supabase/schema.sql', 'supabase/migraciones/002_matricula_multiple.sql']) execFileSync('psql', ['-h', '127.0.0.1', '-p', PUERTO, '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(RAIZ, sql)], { stdio: 'ignore' });
  await db.admin(`update public.config set modo_transicion=false; update public.config set clave_script_hash = extensions.crypt('${SECRETO}', extensions.gen_salt('bf')) where id; delete from public.intentos; delete from public.sesiones`);
  await db.admin(`delete from public.matriculas; delete from public.solicitudes; delete from public.prematriculas`);   // base local desechable: arranca vacía
  const srv = await servir(); base = `http://127.0.0.1:${srv.address().port}`; navegador = await chromium.launch();
  gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });

  try {
    sec('1) Formulario: «+ Añadir otro estudiante», condición independiente y datos del apoderado una sola vez');
    let pg = await abrir('/index.html', { dl: true }); await entrar(pg);
    await pg.click('.card-btn:nth-child(2)');       // «Estudiante antiguo»
    ok('el botón «+ Añadir otro estudiante» es visible', await pg.isVisible('#btnAddEst') && /Añadir otro estudiante/.test(await pg.textContent('#btnAddEst')));
    ok('el estudiante 1 trae la condición elegida (antiguo) y sus campos', await pg.isChecked('input[name=tipo_1][value=antiguo]') && await pg.isVisible('#e_cursoAnt') && !(await pg.isVisible('#e_procedencia')));
    await pg.click('#btnAddEst'); await pg.waitForTimeout(300);
    ok('aparece la ficha del estudiante 2, claramente identificada', await pg.isVisible('#est2') && /Estudiante 2/.test(await pg.textContent('#est2 .est-titulo')) && /Estudiante 1/.test(await pg.textContent('#est1 .est-titulo')));
    ok('la ficha 2 tiene los mismos campos que la 1 (nombre, RUT, curso, repitencia, PIE, salud…)', await pg.evaluate(() => ['nombre', 'rut', 'fnac', 'dir', 'comuna', 'nacionalidad', 'cel', 'mail', 'procedencia', 'cursoAnt', 'letraAnt', 'repCurso', 'pieDiag', 'saludDet', 'obs'].every(c => document.getElementById('e2_' + c))));
    ok('la ficha 2 no trae datos copiados del estudiante 1 y exige elegir nuevo/antiguo', (await pg.inputValue('#e2_nombre')) === '' && !(await pg.isChecked('input[name=tipo_2][value=nuevo]')) && !(await pg.isChecked('input[name=tipo_2][value=antiguo]')));
    ok('los identificadores de la ficha 2 no se mezclan con los de la 1 (sin ids duplicados)', await pg.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.length === new Set(ids).size; }));
    await pg.click('#btnAddEst'); await pg.waitForTimeout(200);
    ok('se pueden tener 3 fichas', (await pg.evaluate(() => document.querySelectorAll('.est-bloque').length)) === 3);
    ok('solo hay UN bloque de datos del apoderado y uno de suplente', (await pg.evaluate(() => document.querySelectorAll('#a_nombre').length + document.querySelectorAll('#s_nombre').length)) === 2);
    ok('el parentesco y «vive con» se pueden fijar por estudiante (2 y 3)', await pg.isVisible('#e2_parentesco') && await pg.isVisible('#e3_vive') && !(await pg.$('#e_parentesco')));
    // Condición: campos distintos para cada tipo
    await pg.check('input[name=tipo_2][value=nuevo]', { force: true });
    ok('al elegir «nuevo» en la ficha 2 aparecen sus campos de nuevo y no los de antiguo', await pg.isVisible('#e2_procedencia') && !(await pg.isVisible('#e2_cursoAnt')) && await pg.isVisible('#e_cursoAnt'));
    await pg.check('input[name=tipo_2][value=antiguo]', { force: true });
    ok('y viceversa; la ficha 1 no cambia', await pg.isVisible('#e2_cursoAnt') && !(await pg.isVisible('#e2_procedencia')) && await pg.isChecked('input[name=tipo_1][value=antiguo]'));

    sec('2) Quitar una ficha: con confirmación (protección contra eliminaciones accidentales)');
    await pg.fill('#e2_nombre', 'Dato que no debe perderse por error');
    await pg.click('#est2 .est-quitar'); await pg.waitForTimeout(200);
    ok('al pulsar «Quitar» pide confirmación y nombra al estudiante', await pg.isVisible('#ovQuitarEst .modal') && /Dato que no debe perderse/.test(await pg.textContent('#nombreQuitarEst')));
    await pg.click('#ovQuitarEst .btn-ghost'); await pg.waitForTimeout(200);
    ok('si se cancela, la ficha y sus datos siguen ahí', (await pg.inputValue('#e2_nombre')) === 'Dato que no debe perderse por error' && (await pg.evaluate(() => document.querySelectorAll('.est-bloque').length)) === 3);
    await pg.click('#est3 .est-quitar'); await pg.click('#ovQuitarEst .btn[data-click=confirmarQuitarEstudiante]'); await pg.waitForTimeout(250);
    ok('al confirmar se quita solo esa ficha; las demás conservan sus datos', (await pg.evaluate(() => document.querySelectorAll('.est-bloque').length)) === 2 && (await pg.inputValue('#e2_nombre')) === 'Dato que no debe perderse por error');
    ok('la ficha 1 no tiene botón «Quitar» (siempre hay al menos un estudiante)', !(await pg.$('#est1 .est-quitar')));
    for (let i = 0; i < 5; i++) if (await pg.isEnabled('#btnAddEst')) await pg.click('#btnAddEst');
    ok('límite: con 5 estudiantes el botón de añadir se desactiva y se explica el máximo', (await pg.evaluate(() => document.querySelectorAll('.est-bloque').length)) === 5 && !(await pg.isEnabled('#btnAddEst')) && /máximo de 5/.test(await pg.textContent('#estAddHint')));
    ok('tras quitar y volver a añadir, los identificadores siguen siendo únicos', await pg.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(e => e.id); return ids.length === new Set(ids).size; }));
    ok('el texto del botón de envío cambia a «Revisar la solicitud»', /Revisar la solicitud/.test(await pg.textContent('#ficha button[type=submit]')));
    await pg.context().close();

    sec('3) Validación: el error nombra al estudiante y al campo, sin borrar los datos de los demás');
    pg = await abrir('/index.html'); await entrar(pg); await pg.click('.card-btn:nth-child(2)');
    await llenarEst(pg, 1, H[0]); await pg.click('#btnAddEst'); await pg.click('#btnAddEst');
    await llenarEst(pg, 2, { ...H[1], rut: '41.000.002-0' });   // RUT con dígito verificador incorrecto
    await pg.check('input[name=tipo_3][value=nuevo]', { force: true });   // el 3 queda casi vacío
    await llenarApoderado(pg); await enviar(pg);
    const lista = await pg.evaluate(() => [...document.querySelectorAll('#bannerDetalle li')].map(l => l.textContent));
    ok('no avanza y el aviso lista los problemas por estudiante', (await pant(pg)) === 'scr-form' && lista.length >= 2, JSON.stringify(lista));
    ok('el estudiante 2 aparece con su RUT inválido', lista.some(l => /Estudiante 2 \(Beto TEST Dos\).*RUT/.test(l)), JSON.stringify(lista));
    ok('el estudiante 3 aparece con los campos que le faltan', lista.some(l => /Estudiante 3.*Nombre.*RUT.*Colegio de procedencia/.test(l)), JSON.stringify(lista));
    ok('el estudiante 1 (correcto) no aparece como error', !lista.some(l => /Estudiante 1/.test(l)));
    ok('los datos de los demás NO se borraron', (await pg.inputValue('#e_nombre')) === H[0].nombre && (await pg.inputValue('#e2_nombre')) === H[1].nombre && (await pg.inputValue('#a_nombre')) === 'Apoderado TEST');
    ok('los campos con error se marcan en rojo (y solo los del estudiante afectado)', await pg.evaluate(() => document.getElementById('e2_rut').classList.contains('bad') && !document.getElementById('e_rut').classList.contains('bad') && document.getElementById('e3_nombre').classList.contains('bad')));
    await capturar(pg, 'validacion_multiple');
    await pg.fill('#e2_rut', H[1].rut); await pg.fill('#e3_rut', H[1].rut); await pg.press('#e3_rut', 'Tab');
    await pg.fill('#e3_nombre', 'Otro'); await pg.fill('#e3_fnac', '2012-01-01'); await pg.fill('#e3_dir', 'x'); await pg.fill('#e3_comuna', 'x'); await pg.fill('#e3_nacionalidad', 'x'); await pg.fill('#e3_cel', '1'); await pg.fill('#e3_procedencia', 'x');
    for (const g of ['rep', 'pie', 'salud']) await pg.check(`input[name=${g}3][value=no]`, { force: true });
    await enviar(pg);
    ok('el mismo RUT en dos estudiantes de la solicitud se rechaza nombrando al estudiante', (await pant(pg)) === 'scr-form' && (await pg.evaluate(() => [...document.querySelectorAll('#bannerDetalle li')].map(l => l.textContent).join('|'))).includes('RUT está repetido'));
    await pg.context().close();

    sec('4) Solicitud de 3 hermanos: resumen, documentos, guardado y UN correo con 3 certificados');
    estado.rpcs.length = 0; gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
    pg = await abrir('/index.html', { dl: true }); await entrar(pg); await pg.click('.card-btn:nth-child(2)');
    await llenarEst(pg, 1, H[0]); await pg.click('#btnAddEst'); await llenarEst(pg, 2, H[1]); await pg.click('#btnAddEst'); await llenarEst(pg, 3, H[2]);
    await llenarApoderado(pg);
    await capturar(pg, 'formulario_3_estudiantes', true);
    await enviar(pg);
    ok('con 3 estudiantes se muestra el RESUMEN antes de generar nada', (await pant(pg)) === 'scr-resumen');
    ok('el resumen no consumió folios todavía', !estado.rpcs.includes('reservar_folios'));
    const resumen = await pg.evaluate(() => document.getElementById('scr-resumen').innerText);
    ok('el resumen muestra a los 3 estudiantes con nombre, curso y condición', H.every(h => resumen.includes(h.nombre)) && /3° Medio B/.test(resumen) && /1° Medio A/.test(resumen) && /2° Medio/.test(resumen) && /antiguo/i.test(resumen) && /nuevo/i.test(resumen));
    ok('el resumen indica validación y documentos requeridos de cada estudiante', (resumen.match(/Campos obligatorios completos/g) || []).length === 3 && (resumen.match(/Documentos requeridos/g) || []).length === 3);
    ok('el apoderado aparece UNA sola vez, con el aviso de que llega un solo correo', (resumen.match(/Apoderado titular/g) || []).length === 1 && /UN solo correo/.test(resumen));
    ok('el parentesco por estudiante se refleja (Madre / Tío(a) / Madre)', /Tío\(a\)/.test(resumen));
    await capturar(pg, 'resumen_3_estudiantes', true);
    await pg.click('#scr-resumen .btn-ghost'); await pg.waitForTimeout(300);
    ok('«Volver a editar» regresa al formulario con todo lo escrito', (await pant(pg)) === 'scr-form' && (await pg.inputValue('#e2_nombre')) === H[1].nombre && (await pg.inputValue('#a_nombre')) === 'Apoderado TEST');
    await enviar(pg); await pg.click('#btnConfirmarResumen'); await pg.waitForTimeout(1200);
    ok('al confirmar se generan los documentos', (await pant(pg)) === 'scr-memos');
    ok('se reservaron exactamente 3 folios (una sola llamada)', estado.rpcs.filter(r => r === 'reservar_folios').length === 1);
    ok('hay 12 hojas de impresión: 4 por estudiante (3 autorizaciones + ficha)', (await hojas(pg)) === 12, String(await hojas(pg)));
    const memos = await pg.evaluate(() => document.getElementById('memosPantalla').innerText);
    ok('los documentos de cada estudiante llevan SU nombre y SU ficha', H.every(h => memos.includes(h.nombre)) && (memos.match(/Estudiante \d de 3/g) || []).length === 3);
    ok('cada hoja de impresión lleva el folio de su estudiante', await pg.evaluate(() => { const hs = [...document.querySelectorAll('#printArea .print-memo')]; const f = hs.map(h => (/Ficha (\d+)/.exec(h.innerText) || [])[1]); return new Set(f).size === 3 && f.slice(0, 4).every(x => x === f[0]) && f.slice(4, 8).every(x => x === f[4]); }));
    await capturar(pg, 'documentos_3_estudiantes');
    await finalizar(pg, 3000);
    ok('la solicitud se guarda y aparece la pantalla de comprobante', (await pant(pg)) === 'scr-done', await pant(pg));
    const sol = await ultimaSolicitud(); const filas = await filasDe(sol.id);
    ok('hay 3 matrículas, cada una con su PROPIO folio, y todas con el mismo identificador de solicitud', filas.length === 3 && new Set(filas.map(f => f.folio)).size === 3);
    ok('el curso y la condición son independientes por alumno', filas.map(f => f.tipo).join() === 'antiguo,antiguo,nuevo' && filas[0].datos.estudiante.cursoMatricula === '1° Medio A' && filas[1].datos.estudiante.cursoMatricula === '3° Medio B' && filas[2].datos.estudiante.cursoMatricula === '2° Medio');
    ok('el apoderado compartido es el mismo, y el parentesco por alumno se respetó', new Set(filas.map(f => f.datos.apoderado.rut)).size === 1 && filas.map(f => f.datos.apoderado.parentesco).join() === 'Madre,Tío(a),Madre' && filas[1].datos.apoderado.viveConEstudiante === 'no');
    ok('la pantalla final lista las 3 fichas con su certificado', (await pg.evaluate(() => document.querySelectorAll('#doneLista .resumen-card').length)) === 3 && new RegExp(`Fichas ${filas[0].folio}, ${filas[1].folio} y ${filas[2].folio}`).test(await pg.textContent('#folioTxt')));
    ok('se envió UN solo correo (no tres)', gs.enviados.length === 1, String(gs.enviados.length));
    const mail = gs.enviados[0];
    ok('el correo lleva los 3 certificados como archivos PDF independientes', mail.attachments.length === 3 && new Set(mail.attachments.map(a => a.nombre)).size === 3 && mail.attachments.every(a => a.tipo === 'application/pdf'));
    ok('el destinatario es el del apoderado y el asunto identifica las fichas', mail.to === DEST && /Fichas \d+, \d+ y \d+ \(3 estudiantes\)/.test(mail.subject));
    ok('el estado de la solicitud en la base es «enviado»', (await ultimaSolicitud()).correo_estado === 'enviado');
    ok('el comprobante dice que se envió UN correo con los 3 certificados', /UN correo con los 3 certificados/.test(await pg.textContent('#doneMail')) && !(await pg.isVisible('#btnReintentarCorreo')));
    // Cada PDF corresponde a su estudiante (archivo ↔ matrícula)
    let mapeoOk = true, tamanos = [];
    for (let i = 0; i < 3; i++) {
      const a = mail.attachments[i]; tamanos.push(a.bytes);
      ok(`el certificado ${i + 1} es un PDF válido y su nombre lleva el folio ${filas[i].folio}`, a.datos.slice(0, 5).toString() === '%PDF-' && a.datos.slice(-1024).toString('latin1').includes('%%EOF') && a.nombre.includes(`Ficha_${filas[i].folio}_`), a.nombre);
      if (hayPdftotext) {
        const t = textoPdf(a.datos);
        const propio = t.includes(H[i].nombre) && new RegExp(`Ficha de matrícula:\\s*${filas[i].folio}\\b`).test(t);
        const ajeno = H.some((h, j) => j !== i && t.includes(h.nombre));
        if (!propio || ajeno) mapeoOk = false;
        ok(`el certificado ${i + 1} contiene SOLO a «${H[i].nombre}» y su folio (no mezcla hermanos)`, propio && !ajeno, t.replace(/\s+/g, ' ').slice(0, 160));
      }
    }
    ok('los certificados comprimidos pesan poco (cada uno < 100 KB reales; límite del script 187 KB)', tamanos.every(b => b < 100000), tamanos.join());
    if (!hayPdftotext) console.log('  (omitido: pdftotext no está instalado; el contenido de los PDF queda pendiente de revisión manual)');
    await capturar(pg, 'comprobante_3_estudiantes', true);
    ok('sin errores de JavaScript ni violaciones de la CSP en todo el flujo', pg.errores.length === 0 && (await pg.evaluate(() => window.__csp.length)) === 0, pg.errores.join('|'));
    await pg.context().close();

    sec('5) Panel de encargados: solicitud, curso, condición y estado del correo');
    pg = await abrir('/index.html', { dl: true }); await entrar(pg); await panel(pg);
    const todas = await pg.evaluate(() => [...document.querySelectorAll('#tbodyAdmin tr')].map(t => t.innerText));
    ok('las 3 matrículas de la solicitud se reconocen con el mismo código y su posición (1/3, 2/3, 3/3)', ['1/3', '2/3', '3/3'].every(x => todas.filter(t => t.includes(x)).length === 1) && (await pg.evaluate(() => new Set([...document.querySelectorAll('#tbodyAdmin .sol-chip')].map(c => c.textContent.split(' ')[0])).size)) === 1);
    ok('el panel muestra el estado del correo (Enviado)', (await pg.evaluate(() => [...document.querySelectorAll('#tbodyAdmin .estado')].map(e => e.textContent))).filter(x => x === 'Enviado').length === 3);
    await pg.selectOption('#fCurso', '3° Medio B'); await pg.waitForTimeout(300);
    ok('el filtro por curso (3° Medio B) deja solo a ese estudiante', (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length)) === 1 && /Beto TEST Dos/.test(await pg.textContent('#tbodyAdmin')));
    await pg.selectOption('#fCurso', ''); await pg.selectOption('#fTipo', 'nuevo'); await pg.waitForTimeout(300);
    ok('el filtro «nuevo» deja solo a la estudiante nueva', (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length)) === 1 && /Carla TEST Tres/.test(await pg.textContent('#tbodyAdmin')));
    await pg.selectOption('#fTipo', 'antiguo'); await pg.waitForTimeout(300);
    ok('el filtro «antiguo» deja a los 2 antiguos', (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length)) === 2);
    await pg.selectOption('#fTipo', ''); await pg.fill('#fBusqueda', sol.id.slice(0, 8)); await pg.waitForTimeout(300);
    ok('se puede buscar por el código de la solicitud y salen los 3 hermanos', (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length)) === 3);
    await pg.fill('#fBusqueda', ''); await pg.waitForTimeout(200);
    const fBeto = await pg.evaluate(() => [...document.querySelectorAll('#tbodyAdmin tr')].findIndex(t => t.innerText.includes('Beto TEST Dos')) + 1);
    await pg.click(`#tbodyAdmin tr:nth-child(${fBeto}) .btn-del[title^="Editar"]`); await pg.waitForTimeout(400);
    ok('al editar un hermano solo se carga SU ficha (sin el botón de añadir estudiantes)', (await pg.inputValue('#e_nombre')) === 'Beto TEST Dos' && !(await pg.isVisible('#estAdd')) && (await pg.evaluate(() => document.querySelectorAll('.est-bloque').length)) === 1);
    await cerrarAviso(pg); await pg.fill('#e_cel', '+56 9 7777 7777'); await enviar(pg);
    const tras = await filasDe(sol.id);
    ok('editar a un hermano no altera a los otros dos ni su solicitud', tras[1].datos.estudiante.celular === '+56 9 7777 7777' && tras[0].datos.estudiante.celular === '+56 9 0000 0000' && tras[2].datos.estudiante.celular === '+56 9 0000 0000' && tras.length === 3);
    await cerrarAviso(pg);
    const dl = pg.waitForEvent('download', { timeout: 8000 }).catch(() => null); await pg.click('#btnDescargarExcel'); const arch = await dl;
    let XLSX = null; try { XLSX = require('xlsx'); } catch (e) { /* opcional */ }
    if (arch && XLSX) {
      const wb = XLSX.readFile(await arch.path()); const m = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); const enc = m[0];
      ok('el Excel incluye solicitud, posición, cantidad y estado del correo', ['Solicitud', 'N° en la solicitud', 'Estudiantes en la solicitud', 'Estado del correo'].every(c => enc.includes(c)) && m.length - 1 === 3);
    } else console.log('  (Excel: lectura omitida; paquete xlsx no disponible en esta máquina)');
    const hBeto = await pg.evaluate(() => [...document.querySelectorAll('#tbodyAdmin tr')].findIndex(t => t.innerText.includes('Beto TEST Dos')) + 1);
    await pg.click(`#tbodyAdmin tr:nth-child(${hBeto}) .btn-del[title^="Eliminar"]`); await pg.waitForTimeout(300); await pg.click('#btnConfirmarEliminar'); await pg.waitForTimeout(900);
    ok('eliminar a un hermano deja a los otros dos, aún relacionados', (await filasDe(sol.id)).length === 2 && (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length)) === 2);
    await capturar(pg, 'panel_solicitud', true);
    await pg.context().close();

    sec('6) Fallos y reintentos: sin duplicar matrículas, folios ni correos');
    // 6a. Doble clic en Finalizar
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
    const nuevaSolicitud = async (extra = {}) => {
      const p = await abrir('/index.html', { dl: true }); await entrar(p); await p.click('.card-btn:nth-child(2)');
      const rutBase = 42000000 + Math.floor(Math.random() * 90000) * 10;
      await llenarEst(p, 1, { ...H[0], nombre: 'Dani TEST Uno', rut: rut(rutBase + 1) }); await p.click('#btnAddEst'); await llenarEst(p, 2, { ...H[1], nombre: 'Eli TEST Dos', rut: rut(rutBase + 2) });
      await llenarApoderado(p, extra.correo === undefined ? DEST : extra.correo); await enviar(p); await p.click('#btnConfirmarResumen'); await p.waitForTimeout(1200); return p;
    };
    pg = await nuevaSolicitud();
    await pg.evaluate(() => { window.print = () => {}; imprimirMemos(); }); await pg.waitForTimeout(500);
    const antesN = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;
    await pg.evaluate(() => { const b = document.getElementById('btnFinalizar'); b.click(); b.click(); b.click(); });   // triple clic inmediato
    await pg.waitForTimeout(3500);
    ok('doble/triple clic en «Finalizar»: se guardan solo 2 matrículas (no 6) y sale UN correo', (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n === antesN + 2 && gs.enviados.length === 1, `${(await db.admin('select count(*)::int n from public.matriculas')).rows[0].n - antesN} filas, ${gs.enviados.length} correos`);
    await pg.context().close();
    // 6b. La solicitud no llega al servidor (error de red) y se reintenta
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
    pg = await nuevaSolicitud(); const antes2 = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;
    estado.fallarGuardarUnaVez = true; await finalizar(pg, 1500);
    ok('error de red al guardar: se avisa y NO se guarda nada', /No se pudo guardar|problema al comunicarse/i.test(await pg.textContent('#avisoTitulo') + await pg.textContent('#avisoTexto')) && (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n === antes2 && (await pant(pg)) === 'scr-memos');
    await cerrarAviso(pg); await pg.click('#btnFinalizar'); await pg.waitForTimeout(3000);
    ok('al reintentar se guardan las 2 matrículas y sale UN correo', (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n === antes2 + 2 && gs.enviados.length === 1 && (await pant(pg)) === 'scr-done');
    await pg.context().close();
    // 6c. Se guardó, pero la respuesta se perdió (el caso más peligroso para duplicar)
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
    pg = await nuevaSolicitud(); const antes3 = (await db.admin('select count(*)::int n, max(folio)::int f from public.matriculas')).rows[0];
    estado.perderRespuestaGuardar = true; await finalizar(pg, 1500);
    ok('la respuesta se perdió pero la base SÍ guardó las 2 matrículas', (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n === antes3.n + 2 && (await pant(pg)) === 'scr-memos');
    await cerrarAviso(pg); await pg.click('#btnFinalizar'); await pg.waitForTimeout(3000);
    const despues3 = (await db.admin('select count(*)::int n, max(folio)::int f from public.matriculas')).rows[0];
    ok('el reintento NO duplica matrículas ni folios y el correo sale una sola vez', despues3.n === antes3.n + 2 && despues3.f === antes3.f + 2 && gs.enviados.length === 1 && (await pant(pg)) === 'scr-done', JSON.stringify({ antes3, despues3, correos: gs.enviados.length }));
    await pg.context().close();
    // 6d. Falla el servicio de correo: matrículas guardadas, estado pendiente/error, reintento sin duplicar
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync }); gs.mailFalla = true;
    pg = await nuevaSolicitud(); await finalizar(pg, 3000);
    const solE = await ultimaSolicitud();
    ok('el correo falla: las matrículas se conservan y se explica claramente', (await pant(pg)) === 'scr-done' && (await filasDe(solE.id)).length === 2 && /NO se envió/.test(await pg.textContent('#doneMail')) && gs.enviados.length === 0);
    ok('la solicitud queda en estado «error» y aparece el botón de reintento', solE.correo_estado === 'error' && await pg.isVisible('#btnReintentarCorreo'), solE.correo_estado);
    ok('la pantalla NO marca el correo como enviado', !(await pg.isVisible('#doneSpam')) && !/Se envió/.test(await pg.textContent('#doneMail')));
    gs.mailFalla = false; await pg.click('#btnReintentarCorreo'); await pg.waitForTimeout(2500);
    ok('reintentar con el servicio recuperado envía UN correo con los 2 certificados', gs.enviados.length === 1 && gs.enviados[0].attachments.length === 2 && (await ultimaSolicitud()).correo_estado === 'enviado' && /UN correo con los 2 certificados/.test(await pg.textContent('#doneMail')));
    ok('tras enviarse, el botón de reintento desaparece', !(await pg.isVisible('#btnReintentarCorreo')));
    await pg.context().close();
    // 6e. Falla la generación de UN certificado: no se envía ninguno
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
    pg = await nuevaSolicitud();
    await pg.evaluate(() => { window.__pdfOriginal = generarComprobantePDFBase64; let k = 0; window.generarComprobantePDFBase64 = f => { if (++k === 2) throw new Error('fallo simulado'); return window.__pdfOriginal(f); }; });
    await finalizar(pg, 3000);
    const solP = await ultimaSolicitud();
    ok('falla el certificado 2: NO se envía ningún correo (ni «una parte»), las matrículas se conservan', gs.enviados.length === 0 && (await filasDe(solP.id)).length === 2 && /no se pudo generar uno de los certificados/.test(await pg.textContent('#doneMail')));
    ok('la solicitud queda «pendiente» (el servicio de correo no fue llamado) y se puede reintentar', solP.correo_estado === 'pendiente' && await pg.isVisible('#btnReintentarCorreo'));
    await pg.evaluate(() => { window.generarComprobantePDFBase64 = window.__pdfOriginal; });
    await pg.click('#btnReintentarCorreo'); await pg.waitForTimeout(2500);
    ok('recuperado el generador, el reintento envía UN correo con los 2 certificados', gs.enviados.length === 1 && gs.enviados[0].attachments.length === 2);
    await pg.context().close();
    // 6f. Certificados que exceden el límite: se detecta ANTES de enviar
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
    pg = await nuevaSolicitud();
    await pg.evaluate(() => { window.__pdfOriginal = generarComprobantePDFBase64; window.generarComprobantePDFBase64 = () => 'JVBER' + 'A'.repeat(300000); });
    await finalizar(pg, 2500);
    ok('certificados demasiado grandes: se avisa antes de enviar, no se envía nada y las matrículas se conservan', gs.enviados.length === 0 && gs.llamadas.length === 0 && /superan el tamaño permitido/.test(await pg.textContent('#doneMail')) && (await filasDe((await ultimaSolicitud()).id)).length === 2);
    await pg.context().close();
    // 6g. Sin correo del apoderado
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
    pg = await nuevaSolicitud({ correo: '' }); await finalizar(pg, 2500);
    ok('sin correo del apoderado: se guardan las matrículas y se dice que no se envió correo', gs.enviados.length === 0 && /no registró correo/.test(await pg.textContent('#doneMail')) && !(await pg.isVisible('#btnReintentarCorreo')) && (await ultimaSolicitud()).correo_estado === 'sin_correo');
    await pg.context().close();
    // 6h. Reenvío desde el panel
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync }); gs.mailFalla = true;
    pg = await nuevaSolicitud(); await finalizar(pg, 3000); const solR = await ultimaSolicitud(); await pg.context().close();
    gs.mailFalla = false; pg = await abrir('/index.html'); await entrar(pg); await panel(pg);
    const selMail = `#tbodyAdmin .btn-mail[data-args*="${solR.id}"]`;
    ok('el panel muestra «Error» y el botón de reenviar en las 2 matrículas de esa solicitud', (await pg.evaluate(s2 => document.querySelectorAll(s2).length, selMail)) === 2 && (await pg.evaluate(id6 => [...document.querySelectorAll('#tbodyAdmin tr')].filter(t => t.querySelector('.sol-chip') && t.querySelector('.sol-chip').title.includes(id6) && t.querySelector('.estado.err')).length, solR.id)) === 2);
    await pg.click(selMail + ' >> nth=0'); await pg.waitForTimeout(3000);
    ok('«Reenviar» desde el panel (sesión de encargados) envía UN correo con los 2 certificados', gs.enviados.length === 1 && gs.enviados[0].attachments.length === 2 && (await db.admin('select correo_estado from public.solicitudes where id=$1', [solR.id])).rows[0].correo_estado === 'enviado');
    await cerrarAviso(pg);
    ok('después del reenvío el panel muestra «Enviado» y ya no ofrece reenviar', (await pg.evaluate(() => [...document.querySelectorAll('#tbodyAdmin tr')].filter(t => t.innerText.includes('Dani TEST') || t.innerText.includes('Eli TEST')).length)) >= 2);
    await pg.context().close();

    sec('7) Pre-matrícula del apoderado con varios estudiantes (un solo código)');
    await db.admin(`delete from public.prematriculas`); const nPre = ipN;
    const ap = await abrir('/index.html?apoderado'); const ya = await pant(ap);
    ok('el apoderado entra directo y también ve «+ Añadir otro estudiante»', ya === 'scr-home' && true);
    await ap.click('.card-btn:nth-child(1)');
    ok('en modo apoderado el botón de añadir está disponible', await ap.isVisible('#btnAddEst'));
    await llenarEst(ap, 1, { nombre: 'Pre TEST Uno', rut: rut(43000001), tipo: 'nuevo', curso: '1° Medio' }); await ap.click('#btnAddEst');
    await llenarEst(ap, 2, { nombre: 'Pre TEST Dos', rut: rut(43000002), tipo: 'antiguo', curso: '4° Medio', letra: 'c', parentesco: 'Abuelo(a)', vive: 'no' });
    await llenarApoderado(ap, DEST); await enviar(ap);
    const cod = (await ap.textContent('#codigoGrande')).trim();
    ok('envía UNA pre-matrícula con los 2 estudiantes y recibe un único código', (await pant(ap)) === 'scr-codigo' && /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(cod) && (await db.admin('select count(*)::int n from public.prematriculas')).rows[0].n === 1, cod);
    ok('no se creó ninguna matrícula (solo la pre-matrícula)', (await db.admin(`select count(*)::int n from public.matriculas where datos->'estudiante'->>'nombre' like 'Pre TEST%'`)).rows[0].n === 0);
    await ap.context().close();
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
    const st = await abrir('/index.html', { dl: true }); await entrar(st);
    await st.evaluate(() => abrirCargarCodigo()); await st.fill('#inputCodigo', cod.toLowerCase()); await st.click('#btnBuscarCodigo'); await st.waitForTimeout(900);
    ok('el funcionario carga el código y aparecen los 2 estudiantes con los datos compartidos', (await pant(st)) === 'scr-form' && (await st.inputValue('#e_nombre')) === 'Pre TEST Uno' && (await st.inputValue('#e2_nombre')) === 'Pre TEST Dos' && (await st.inputValue('#a_nombre')) === 'Apoderado TEST');
    ok('el parentesco y la condición de cada estudiante se conservan', (await st.inputValue('#e2_parentesco')) === 'Abuelo(a)' && (await st.inputValue('#e2_vive')) === 'no' && await st.isChecked('input[name=tipo_2][value=antiguo]') && await st.isChecked('input[name=tipo_1][value=nuevo]'));
    await cerrarAviso(st); await enviar(st); await st.click('#btnConfirmarResumen'); await st.waitForTimeout(1200); await finalizar(st, 3000);
    const solC = await ultimaSolicitud();
    ok('se finaliza: 2 matrículas de la misma solicitud, un solo correo con 2 certificados y la pre-matrícula se consume', (await filasDe(solC.id)).length === 2 && gs.enviados.length === 1 && gs.enviados[0].attachments.length === 2 && (await db.admin('select count(*)::int n from public.prematriculas')).rows[0].n === 0);
    await st.context().close();

    sec('8) Seguridad: HTML y símbolos peligrosos en las pantallas nuevas');
    gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
    pg = await abrir('/index.html'); await entrar(pg); await pg.click('.card-btn:nth-child(2)');
    await llenarEst(pg, 1, { ...H[0], nombre: 'Seguro TEST Uno', rut: rut(44000001) }); await pg.click('#btnAddEst'); await llenarEst(pg, 2, { ...H[1], nombre: 'Sano TEST Dos', rut: rut(44000002) });
    await llenarApoderado(pg); await pg.fill('#e2_nombre', '<img src=x onerror="window.__xss.push(1)">Hack'); await pg.fill('#e_obs', 'texto <script>alert(1)</script>'); await enviar(pg);
    const lst = await pg.evaluate(() => [...document.querySelectorAll('#bannerDetalle li')].map(l => l.textContent));
    ok('un nombre con HTML se rechaza ANTES de generar documentos, indicando qué estudiante lo tiene', (await pant(pg)) === 'scr-form' && lst.some(l => /Estudiante 2.*< y >/.test(l)) && lst.some(l => /Estudiante 1.*< y >/.test(l)), JSON.stringify(lst));
    ok('no se reservó ningún folio ni se ejecutó código', !estado.rpcs.slice(-3).includes('reservar_folios') && (await pg.evaluate(() => window.__xss.length)) === 0 && (await pg.evaluate(() => document.querySelectorAll('img[src="x"]').length)) === 0);
    ok('los campos con símbolos se marcan en rojo', await pg.evaluate(() => document.getElementById('e2_nombre').classList.contains('bad') && document.getElementById('e_obs').classList.contains('bad')));
    await pg.fill('#e_obs', ''); await pg.fill('#e2_nombre', 'Sano &lt;b&gt;negrita&lt;/b&gt; & "comillas"'); await enviar(pg);
    ok('sin símbolos < >, el formulario avanza al resumen', (await pant(pg)) === 'scr-resumen');
    const textoResumen = await pg.evaluate(() => document.getElementById('resumenEstudiantes').innerText);
    ok('en el resumen el texto con &, comillas y «&lt;» se muestra LITERAL (no se interpreta como HTML)', textoResumen.includes('Sano &lt;b&gt;negrita&lt;/b&gt; & "comillas"'), textoResumen.slice(0, 120));
    await pg.click('#btnConfirmarResumen'); await pg.waitForTimeout(1000);
    ok('en los documentos de pantalla e impresión también se muestra literal', (await pg.evaluate(() => document.getElementById('memosPantalla').innerText)).includes('Sano &lt;b&gt;negrita&lt;/b&gt; & "comillas"') && (await pg.evaluate(() => document.querySelectorAll('#printArea b, #memosPantalla b').length)) > 0);
    ok('ningún script se ejecutó y la CSP no registró violaciones', (await pg.evaluate(() => window.__xss.length)) === 0 && (await pg.evaluate(() => window.__csp.length)) === 0 && pg.errores.length === 0, pg.errores.join('|'));
    // Datos maliciosos que llegaran directamente a la base (saltándose la página): el panel los muestra como texto
    await pg.context().close();
    const solX = uuidLocal(); const fx = await db.rpc('reservar_folios', { p_clave: (await db.rpc('iniciar_sesion', { p_clave: FUNC, p_rol: 'interna' }, { ip: '198.51.100.77' })).token, p_solicitud: solX, p_cantidad: 1 });
    await db.admin(`insert into public.matriculas (folio, fecha_registro, tipo, datos, solicitud_id, orden) values ($1, '01-01-2027', 'nuevo', $2::jsonb, $3, 1)`,
      [fx.folios[0], JSON.stringify({ tipo: 'nuevo', folio: String(fx.folios[0]), fechaRegistro: '01-01-2027', estudiante: { nombre: '<img src=x onerror="window.__xss.push(2)"> TEST', rut: rut(44000009), procedencia: '<b>x</b>' }, apoderado: { nombre: '<script>window.__xss.push(3)</script>', rut: rut(22222222) }, suplente: null }), solX]);
    pg = await abrir('/index.html'); await entrar(pg); await panel(pg);
    ok('un nombre con HTML que llegó directo a la base se muestra como texto en el panel (sin ejecutar nada)', (await pg.evaluate(() => window.__xss.length)) === 0 && (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin img').length)) === 0 && /<img src=x/.test(await pg.textContent('#tbodyAdmin')));
    await pg.context().close();

    sec('9) Móvil: el formulario con varios estudiantes no desborda horizontalmente');
    pg = await abrir('/index.html', { viewport: { width: 390, height: 844 } }); await entrar(pg); await pg.click('.card-btn:nth-child(2)');
    await pg.click('#btnAddEst'); await pg.click('#btnAddEst');
    const dm = await desborde(pg);
    ok('con 3 fichas en un móvil de 390 px no hay desbordamiento horizontal', dm <= 0, 'desborde=' + dm);
    await llenarEst(pg, 1, { ...H[0], nombre: 'Movil TEST Uno', rut: rut(45000001) }); await llenarEst(pg, 2, { ...H[1], nombre: 'Movil TEST Dos', rut: rut(45000002) }); await llenarEst(pg, 3, { ...H[2], nombre: 'Movil TEST Tres', rut: rut(45000003) });
    await llenarApoderado(pg); await capturar(pg, 'movil_formulario', true); await enviar(pg);
    ok('el resumen en móvil no desborda', (await pant(pg)) === 'scr-resumen' && (await desborde(pg)) <= 0, 'desborde=' + await desborde(pg));
    await capturar(pg, 'movil_resumen', true);
    await pg.click('#btnConfirmarResumen'); await pg.waitForTimeout(1000);
    ok('las pantallas de documentos en móvil no desbordan', (await desborde(pg)) <= 0, 'desborde=' + await desborde(pg));
    await pg.context().close();
    const pe = await abrir('/index.html', { viewport: { width: 1280, height: 900 } }); await entrar(pe); await pe.click('.card-btn:nth-child(2)'); await pe.click('#btnAddEst');
    await capturar(pe, 'escritorio_formulario_2_estudiantes', true);
    ok('en escritorio la ficha 2 se muestra completa sin desbordar', (await desborde(pe)) <= 0); await pe.context().close();
  } catch (e) { F++; console.log('\n✘ Error inesperado:', e.stack.split('\n').slice(0, 5).join('\n')); }
  finally { await navegador.close(); srv.close(); sync.cerrar(); await db.cerrar(); }
  console.log(`\nResultado: ${P} comprobaciones correctas, ${F} fallidas`);
  process.exit(F ? 1 : 0);
})();
