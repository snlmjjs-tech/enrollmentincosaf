// Prueba FUNCIONAL de la matrícula individual (el flujo de siempre) con datos ficticios «TEST», en un navegador (Chromium) con
// la página real, el Code.gs real (Google simulado) y las funciones SQL reales (Postgres LOCAL). No usa servicios reales.
// Es la regresión de la «prueba funcional completa» anterior: matrícula, validación, folio, panel, edición, eliminación, Excel,
// impresión, pre-matrícula, aislamiento entre solicitudes y (si se entrega una copia de `main`) comparación visual con la versión publicada.
// Uso: PGPORT=5499 node tests/seguridad/prueba-funcional.js
//   Opcional para la comparación visual: PAGINA_ACTUAL=<carpeta con la copia de main> LIBS_ANTIGUAS=<carpeta con las librerías de main>
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { crearRpc } = require('./rpc-local');
const { crearRpcSync } = require('./rpc-sync');
const { crearEntorno } = require('./apps-script-simulado');
const { exigirBaseLocal } = require('./guardia-entorno');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
let XLSX = null; try { XLSX = require('xlsx'); } catch (e) { /* opcional */ }

const RAIZ = path.resolve(__dirname, '../..');
const PUERTO = process.env.PGPORT || '5499';
exigirBaseLocal('127.0.0.1', PUERTO);
const OPTS = { host: '127.0.0.1', port: +PUERTO, user: 'postgres', database: 'postgres' };
const db = crearRpc(OPTS), sync = crearRpcSync(OPTS);
const CAPTURAS = process.env.CAPTURAS || null, ACTUAL = process.env.PAGINA_ACTUAL || '', LIBS = process.env.LIBS_ANTIGUAS || '';
const FUNC = 'clave-funcionarios-ficticia', ENC = 'clave-encargados-ficticia', SECRETO = 'secreto-script-ficticio', DEST = 'apoderado.test@example.invalid';
const SUPA = 'https://mtlunrefaxsagfkphvvw.supabase.co';
const CODIGO = fs.readFileSync(path.join(RAIZ, 'apps-script/Code.gs'), 'utf8');
const PROPS = { ENTORNO: 'prueba', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_KEY: 'sb_publishable_FICTICIA', SECRETO_SCRIPT: SECRETO, NOMBRE_COLEGIO: 'Colegio TEST', LIMITE_DIARIO: '100', DESTINATARIOS_PRUEBA: DEST };
let P = 0, F = 0; const ok = (n, c, d) => { if (c) { P++; console.log(`  ✔ ${n}`); } else { F++; console.log(`  ✘ ${n}${d ? '  → ' + d : ''}`); } };
const sec = t => console.log('\n' + t);
const rut = n => { let s = 0, m = 2; for (const d of String(n).split('').reverse()) { s += d * m; m = m === 7 ? 2 : m + 1; } const r = 11 - s % 11; return n + '-' + (r === 11 ? '0' : r === 10 ? 'K' : r); };
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const servir = raiz => new Promise(r => { const s = http.createServer((q, res) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(raiz, u === '/' ? 'index.html' : u); if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(res); }).listen(0, '127.0.0.1', () => r(s)); });

let gs, navegador, ipN = 100;
async function abrir(base, url, { viewport = { width: 1100, height: 900 }, antigua = false, dl = false } = {}) {
  const ctx = await navegador.newContext({ viewport, acceptDownloads: dl }); const pg = await ctx.newPage(); pg.errores = []; const ip = '203.0.113.' + (ipN++);
  await pg.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective)); });
  pg.on('pageerror', e => pg.errores.push(String(e)));
  if (antigua) for (const [re, fl] of [[/cdn\.jsdelivr\.net.*supabase/, 'supabase.js'], [/cdnjs.*xlsx/, 'xlsx.full.min.js'], [/cdnjs.*qrcode/, 'qrcode.js'], [/cdnjs.*jspdf/, 'jspdf.umd.min.js']]) await pg.route(re, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(LIBS, fl)) }));
  await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await pg.route(`${SUPA}/**`, async ruta => {
    const rq = ruta.request(); const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': '*' };
    if (rq.method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: cors });
    const m = /\/rpc\/([a-z_]+)$/.exec(new URL(rq.url()).pathname);
    try { const d = await db.rpc(m[1], rq.postDataJSON() || {}, { ip }); ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(d === undefined ? null : d) }); }
    catch (e) { ruta.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: e.message }) }); }
  });
  await pg.route('https://script.google.com/**', ruta => { const c = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }; if (ruta.request().method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: c });
    ruta.fulfill({ status: 200, headers: { ...c, 'content-type': 'application/json' }, body: JSON.stringify(antigua ? { ok: true } : gs.post(ruta.request().postData())) }); });
  await pg.goto(base + url); await pg.waitForTimeout(700); return pg;
}
const pant = pg => pg.evaluate(() => document.querySelector('.screen.active')?.id);
const entrar = async (pg, c = FUNC) => { await pg.fill('#inputClaveInterna', c); await pg.press('#inputClaveInterna', 'Enter'); await pg.waitForTimeout(800); };
const panel = async pg => { await pg.click('.admin-link'); await pg.fill('#inputClave', ENC); await pg.click('#ovClave .btn-pri'); await pg.waitForTimeout(900); };
const radio = (pg, n, v) => pg.check(`input[name=${n}][value=${v}]`, { force: true });
async function llenar(pg, o) {
  const set = (id, v) => pg.fill('#' + id, v);
  await set('e_nombre', o.nombre); await set('e_rut', o.rut); await pg.press('#e_rut', 'Tab'); await set('e_fnac', '2012-05-10'); await set('e_dir', 'Calle Ficticia 123 TEST'); await set('e_comuna', 'Comuna TEST'); await set('e_nacionalidad', 'Chilena'); await set('e_cel', '+56 9 0000 0000'); await set('e_mail', o.mailE || '');
  if (o.tipo === 'nuevo') await set('e_procedencia', 'Colegio TEST'); else { await pg.selectOption('#e_cursoAnt', { index: 1 }); await set('e_letraAnt', 'a'); }
  await radio(pg, 'rep', 'no'); await radio(pg, 'pie', o.pie || 'no'); if (o.pie === 'si') { await set('e_pieDiag', 'Diagnóstico TEST'); await radio(pg, 'pieDoc', 'si'); }
  await radio(pg, 'salud', o.salud || 'no'); if (o.salud === 'si') await set('e_saludDet', 'Detalle salud TEST');
  await set('a_nombre', o.apo || 'Apoderado TEST'); await set('a_rut', o.rutA); await pg.press('#a_rut', 'Tab'); await set('a_edad', '40'); await set('a_dir', 'Calle Ficticia 123 TEST'); await set('a_comuna', 'Comuna TEST'); await set('a_nacionalidad', 'Chilena'); await set('a_cel', '+56 9 0000 0001'); await set('a_mail', o.mailA === undefined ? '' : o.mailA);
  await pg.selectOption('#a_parentesco', { index: 1 }); await pg.selectOption('#a_nivel', { index: 1 }); await pg.selectOption('#a_laboral', { index: 1 });
  if (o.sup) { await radio(pg, 'sup', 'si'); await set('s_nombre', 'Suplente TEST'); await set('s_rut', o.rutS); await pg.press('#s_rut', 'Tab'); await set('s_edad', '35'); await set('s_dir', 'Calle Ficticia 9 TEST'); await set('s_comuna', 'Comuna TEST'); await set('s_nacionalidad', 'Chilena'); await set('s_cel', '+56 9 0000 0002'); await pg.selectOption('#s_parentesco', { index: 1 }); }
}
const enviar = async pg => { await pg.click('#ficha button[type=submit]'); await pg.waitForTimeout(1000); };
async function finalizar(pg) { await pg.evaluate(() => { window.print = () => {}; imprimirMemos(); }); await pg.waitForTimeout(700); await pg.click('#btnFinalizar'); await pg.waitForTimeout(2500); }
const cerrarAviso = pg => pg.evaluate(() => cerrar('ovAviso'));
const desborde = pg => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const hayPdftotext = (() => { try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch (e) { return false; } })();
const textoPdf = buf => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'incosaf-pdf-')); const f = path.join(d, 'c.pdf'); fs.writeFileSync(f, buf); try { return execFileSync('pdftotext', ['-layout', f, '-']).toString(); } finally { fs.rmSync(d, { recursive: true, force: true }); } };

(async () => {
  for (const sql of ['supabase/schema.sql', 'supabase/migraciones/002_matricula_multiple.sql']) execFileSync('psql', ['-h', '127.0.0.1', '-p', PUERTO, '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(RAIZ, sql)], { stdio: 'ignore' });
  await db.admin(`update public.config set modo_transicion=false; update public.config set clave_script_hash = extensions.crypt('${SECRETO}', extensions.gen_salt('bf')) where id; delete from public.intentos; delete from public.sesiones; delete from public.matriculas; delete from public.solicitudes; delete from public.prematriculas`);
  navegador = await chromium.launch(); const sRama = await servir(RAIZ), base = `http://127.0.0.1:${sRama.address().port}`;
  gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
  try {
    sec('1) Matrícula individual con datos ficticios TEST (el flujo de siempre)');
    const R1 = rut(11111111), R2 = rut(22222222), R3 = rut(33333333);
    let pg = await abrir(base, '/index.html', { dl: true }); await entrar(pg);
    ok('ingreso del personal con la clave de funcionarios', (await pant(pg)) === 'scr-home');
    await pg.click('.card-btn:nth-child(1)');
    ok('«Estudiante nuevo» abre el formulario con la condición ya elegida', (await pant(pg)) === 'scr-form' && await pg.isChecked('input[name=tipo_1][value=nuevo]'));
    ok('con un solo estudiante el botón dice «Generar documentos de matrícula»', /Generar documentos de matrícula/.test(await pg.textContent('#ficha button[type=submit]')));
    await enviar(pg);
    ok('formulario vacío: no avanza y muestra el aviso con los campos pendientes', (await pant(pg)) === 'scr-form' && await pg.evaluate(() => document.getElementById('bannerErr').classList.contains('show')) && (await pg.evaluate(() => document.querySelectorAll('#bannerDetalle li').length)) >= 2);
    ok('los campos obligatorios vacíos se marcan en rojo', (await pg.evaluate(() => document.querySelectorAll('#ficha .bad').length)) >= 8);
    await llenar(pg, { tipo: 'nuevo', nombre: 'Estudiante TEST Uno', rut: '11111111-9', rutA: R2, mailA: DEST, sup: true, rutS: R3, pie: 'si', salud: 'si' });
    await enviar(pg);
    ok('un RUT inválido (dígito verificador incorrecto) se rechaza', (await pant(pg)) === 'scr-form' && await pg.evaluate(() => document.getElementById('e_rut').classList.contains('bad')));
    await pg.fill('#e_rut', R1); await pg.press('#e_rut', 'Tab'); await enviar(pg);
    ok('con todo completo y un RUT válido, genera los documentos (sin pantalla de resumen: es un solo estudiante)', (await pant(pg)) === 'scr-memos', await pant(pg));
    const txtPrint = await pg.evaluate(() => document.getElementById('printArea').innerText + document.getElementById('memosPantalla').innerText);
    ok('los documentos contienen los datos TEST ingresados (estudiante, apoderado y suplente)', /Estudiante TEST Uno/.test(txtPrint) && /Apoderado TEST/.test(txtPrint) && /Suplente TEST/.test(txtPrint));
    ok('hay 4 hojas de impresión (3 autorizaciones + ficha)', (await pg.evaluate(() => document.querySelectorAll('#printArea .print-memo').length)) === 4);
    await finalizar(pg);
    ok('finaliza: pantalla de comprobante con «Ficha N»', (await pant(pg)) === 'scr-done' && /Ficha \d+/.test(await pg.textContent('#folioTxt')));
    const folioVisto = (await pg.textContent('#folioTxt')).replace(/\D/g, '');
    const fila = (await db.admin(`select * from public.matriculas where datos->'estudiante'->>'nombre'='Estudiante TEST Uno'`)).rows;
    ok('quedó guardada exactamente 1 matrícula TEST, con el folio mostrado y asociada a una solicitud', fila.length === 1 && String(fila[0].folio) === folioVisto && !!fila[0].solicitud_id);
    ok('se guardaron suplente, PIE y salud', fila[0].datos.suplente && fila[0].datos.estudiante.pie === 'si' && fila[0].datos.estudiante.salud === 'si');
    ok('el correo se envió una vez (simulado) con UN certificado a la dirección .invalid de prueba', gs.enviados.length === 1 && gs.enviados[0].to === DEST && gs.enviados[0].attachments.length === 1);
    if (hayPdftotext) { const t = textoPdf(gs.enviados[0].attachments[0].datos); ok('el PDF adjunto es válido y contiene el nombre TEST y el folio', /Estudiante TEST Uno/.test(t) && t.includes(folioVisto)); }
    await pg.evaluate(() => volverInicio()); await pg.click('.card-btn:nth-child(2)');
    await llenar(pg, { tipo: 'antiguo', nombre: 'Estudiante TEST Dos', rut: rut(44444444), rutA: R2, mailA: '' });
    await enviar(pg); const pAnt = await pant(pg); await finalizar(pg);
    const folio2 = (await db.admin(`select folio from public.matriculas where datos->'estudiante'->>'nombre'='Estudiante TEST Dos'`)).rows[0]?.folio;
    ok('estudiante ANTIGUO sin correo: se guarda, NO se envía correo y el folio es consecutivo', pAnt === 'scr-memos' && gs.enviados.length === 1 && +folio2 === +folioVisto + 1, `${folioVisto} → ${folio2}`);
    ok('sin errores de JavaScript ni violaciones de la CSP en el flujo', pg.errores.length === 0 && (await pg.evaluate(() => window.__csp.length)) === 0, pg.errores.join('|'));
    await pg.context().close();

    sec('2) Panel de encargados: ver, buscar, editar, folio, Excel, imprimir y eliminar (solo registros TEST)');
    pg = await abrir(base, '/index.html', { dl: true }); await entrar(pg); await panel(pg);
    ok('el panel abre y lista las 2 matrículas TEST', (await pant(pg)) === 'scr-admin' && (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length)) === 2);
    await pg.fill('#fBusqueda', 'Uno'); await pg.waitForTimeout(300);
    ok('el buscador filtra', (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length)) === 1);
    await pg.fill('#fBusqueda', ''); await pg.selectOption('#fTipo', 'nuevo'); await pg.waitForTimeout(300);
    ok('el filtro por tipo funciona', (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length)) === 1);
    await pg.selectOption('#fTipo', ''); await pg.waitForTimeout(300);
    const fUno = await pg.evaluate(() => [...document.querySelectorAll('#tbodyAdmin tr')].findIndex(t => t.innerText.includes('TEST Uno')) + 1);
    await pg.click(`#tbodyAdmin tr:nth-child(${fUno}) .btn-del[title^="Editar"]`); await pg.waitForTimeout(500);
    ok('«Editar» carga los datos en el formulario (sin opción de añadir estudiantes)', (await pg.inputValue('#e_nombre')) === 'Estudiante TEST Uno' && (await pant(pg)) === 'scr-form' && !(await pg.isVisible('#estAdd')));
    await cerrarAviso(pg); await pg.fill('#e_cel', '+56 9 1111 1111'); await enviar(pg);
    const tras = (await db.admin(`select folio, datos from public.matriculas where datos->'estudiante'->>'nombre'='Estudiante TEST Uno'`)).rows;
    ok('la edición se guardó, sin duplicar y conservando el folio', tras.length === 1 && tras[0].datos.estudiante.celular === '+56 9 1111 1111' && String(tras[0].folio) === folioVisto);
    ok('la otra matrícula TEST no cambió', (await db.admin(`select datos->'estudiante'->>'celular' c from public.matriculas where datos->'estudiante'->>'nombre'='Estudiante TEST Dos'`)).rows[0].c === '+56 9 0000 0000');
    ok('tras guardar la edición se vuelve al panel', (await pant(pg)) === 'scr-admin', await pant(pg));
    await cerrarAviso(pg);
    const d1 = pg.waitForEvent('download', { timeout: 8000 }).catch(() => null); await pg.click('#btnDescargarExcel'); const dl1 = await d1;
    ok('«Descargar Excel» entrega un archivo .xlsx', !!dl1 && /\.xlsx$/.test(dl1.suggestedFilename()));
    if (dl1 && XLSX) { const wb = XLSX.readFile(await dl1.path()); const m = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }); const enc = m[0] || [];
      ok('el Excel contiene las 2 matrículas con sus datos, incl. el celular editado, y las columnas de siempre', m.length - 1 === 2 && ['Nombre estudiante', 'Parentesco apoderado', 'Situación laboral apoderado'].every(c => enc.includes(c)) && JSON.stringify(m).includes('1111'));
      const d2 = pg.waitForEvent('download', { timeout: 8000 }).catch(() => null); await pg.click('[data-click=descargarExcelLibro]'); const dl2 = await d2;
      const wb2 = dl2 ? XLSX.readFile(await dl2.path()) : null; const enc2 = wb2 ? (XLSX.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1 })[0] || []) : [];
      ok('el Excel «libro digital» conserva las columnas de la plantilla del colegio', ['N° Matrícula', 'Curso', 'Nombre', 'RUN', 'Estado'].every(c => enc2.includes(c)), enc2.slice(0, 6).join()); }
    await pg.evaluate(() => { window.__imp = 0; window.print = () => { window.__imp++; }; });
    await pg.click('#tbodyAdmin tr:nth-child(1) .btn-del[title^="Imprimir"]'); await pg.waitForTimeout(800);
    ok('«Imprimir ficha» arma la hoja y llama a imprimir', (await pg.evaluate(() => window.__imp)) >= 1 && /TEST/.test(await pg.evaluate(() => document.getElementById('printArea').innerText)));
    await pg.click('#tbodyAdmin tr:nth-child(1) .btn-del[title^="Cambiar"]'); await pg.waitForTimeout(400);
    ok('«Cambiar N° de ficha» abre el cuadro', await pg.evaluate(() => document.getElementById('ovFolioFicha').classList.contains('show')));
    await pg.fill('#inputFolioFicha', '777'); await pg.click('#btnGuardarFolioFicha'); await pg.waitForTimeout(900);
    ok('el N° de ficha cambia a 777 y el panel se actualiza', (await db.admin(`select count(*)::int n from public.matriculas where folio=777`)).rows[0].n === 1 && /777/.test(await pg.textContent('#tbodyAdmin')));
    await pg.click('#tbodyAdmin tr:nth-child(1) .btn-del[title^="Cambiar"]'); await pg.fill('#inputFolioFicha', '0'); await pg.click('#btnGuardarFolioFicha'); await pg.waitForTimeout(500);
    ok('un N° de ficha inválido (0) se rechaza con un mensaje', /Número inválido/.test(await pg.textContent('#avisoTitulo'))); await cerrarAviso(pg); await pg.evaluate(() => cerrar('ovFolioFicha'));
    const fDos = await pg.evaluate(() => [...document.querySelectorAll('#tbodyAdmin tr')].findIndex(t => t.innerText.includes('TEST Dos')) + 1);
    await pg.click(`#tbodyAdmin tr:nth-child(${fDos}) .btn-del[title^="Eliminar"]`); await pg.waitForTimeout(400);
    ok('el cuadro de confirmación nombra al estudiante TEST', /TEST Dos/.test(await pg.textContent('#nombreEliminar')));
    await pg.click('#btnConfirmarEliminar'); await pg.waitForTimeout(900);
    const quedan = (await db.admin(`select datos->'estudiante'->>'nombre' n from public.matriculas order by 1`)).rows.map(r => r.n);
    ok('se eliminó SOLO «TEST Dos»; «TEST Uno» sigue', quedan.length === 1 && quedan[0] === 'Estudiante TEST Uno', JSON.stringify(quedan));
    ok('el panel no produjo errores', pg.errores.length === 0, pg.errores.join('|'));
    await pg.context().close();

    sec('3) Pre-matrícula de un apoderado (un hijo) y acceso por código');
    await db.admin(`delete from public.prematriculas`);
    const ap = await abrir(base, '/index.html?apoderado');
    ok('el apoderado entra directo sin clave', (await pant(ap)) === 'scr-home');
    await ap.click('.card-btn:nth-child(1)'); await enviar(ap);
    ok('formulario vacío: se bloquea con avisos', (await pant(ap)) === 'scr-form' && await ap.evaluate(() => document.getElementById('bannerErr').classList.contains('show')));
    await llenar(ap, { tipo: 'nuevo', nombre: 'Prematricula TEST Alfa', rut: rut(55555555), rutA: R2, mailA: 'apo.alfa@example.invalid' }); await enviar(ap);
    const codA = (await ap.textContent('#codigoGrande')).trim();
    ok('recibe un código con formato XXX-XXX', (await pant(ap)) === 'scr-codigo' && /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(codA), codA);
    const ap2 = await abrir(base, '/index.html?apoderado'); await ap2.click('.card-btn:nth-child(1)'); await llenar(ap2, { tipo: 'nuevo', nombre: 'Prematricula TEST Beta', rut: rut(66666666), rutA: R3, mailA: 'apo.beta@example.invalid' }); await enviar(ap2);
    const codB = (await ap2.textContent('#codigoGrande')).trim();
    ok('una segunda solicitud obtiene un código distinto', codA !== codB);
    ok('en la base hay 2 pre-matrículas y ninguna matrícula nueva', (await db.admin(`select count(*)::int p from public.prematriculas where datos->'estudiante'->>'nombre' like 'Prematricula TEST%'`)).rows[0].p === 2);
    const st = await abrir(base, '/index.html'); await entrar(st);
    await st.evaluate(() => abrirCargarCodigo()); await st.fill('#inputCodigo', codA.toLowerCase().replace('-', ' ')); await st.click('#btnBuscarCodigo'); await st.waitForTimeout(900);
    ok('el funcionario carga ALFA con su código y ve SOLO sus datos', (await st.inputValue('#e_nombre')) === 'Prematricula TEST Alfa' && (await st.inputValue('#a_mail')) === 'apo.alfa@example.invalid');
    ok('no aparecen datos de BETA', !(await st.evaluate(() => document.body.innerText + [...document.querySelectorAll('input')].map(i => i.value).join(' '))).includes('Beta'));
    await cerrarAviso(st); await enviar(st); await finalizar(st);
    ok('al finalizar, la pre-matrícula ALFA se consume y la BETA no se altera', (await db.admin(`select count(*)::int n from public.prematriculas where datos->'estudiante'->>'nombre'='Prematricula TEST Alfa'`)).rows[0].n === 0 && (await db.admin(`select count(*)::int n from public.prematriculas where datos->'estudiante'->>'nombre'='Prematricula TEST Beta'`)).rows[0].n === 1);
    await st.evaluate(() => volverInicio()); await st.evaluate(() => abrirCargarCodigo()); await st.fill('#inputCodigo', codA); await st.click('#btnBuscarCodigo'); await st.waitForTimeout(800);
    ok('reusar el código ALFA ya no entrega datos', (await pant(st)) !== 'scr-form' || (await st.inputValue('#e_nombre')) === '');
    ok('sin sesión de funcionario NO se puede leer una pre-matrícula aunque se conozca el código', await db.rpc('cargar_prematricula', { p_clave: 'no-es-un-token', p_codigo: codB }).then(() => false, () => true));
    ok('el rol público no puede listar las tablas de pre-matrículas ni de matrículas', await db.comoAnon('select * from public.prematriculas').then(() => false, () => true) && await db.comoAnon('select * from public.matriculas').then(() => false, () => true));
    const adivina = await st.evaluate(async () => { const r = []; for (const c of ['AAAAAA', 'ZZZ999']) { try { r.push(await rpc('cargar_prematricula', { p_clave: tokenInterno, p_codigo: c })); } catch (e) { r.push('error'); } } return r; });
    ok('códigos adivinados al azar no devuelven datos', adivina.every(x => x === null || x === 'error'), JSON.stringify(adivina));
    await ap.context().close(); await ap2.context().close(); await st.context().close();

    sec('4) Móvil y escritorio de la versión nueva (sin desbordes horizontales)');
    for (const [nombre, vp] of [['escritorio', { width: 1280, height: 900 }], ['móvil', { width: 390, height: 844 }]]) {
      const p = await abrir(base, '/index.html', { viewport: vp }); const ds = [await desborde(p)];
      await entrar(p); ds.push(await desborde(p)); await p.click('.card-btn:nth-child(1)'); ds.push(await desborde(p)); await p.evaluate(() => volverInicio()); await panel(p); ds.push(await desborde(p));
      ok(`${nombre}: acceso, inicio, formulario y panel sin desbordamiento horizontal`, ds.every(x => x <= 0) && (await pant(p)) === 'scr-admin', ds.join());
      if (CAPTURAS) { fs.mkdirSync(CAPTURAS, { recursive: true }); await p.screenshot({ path: path.join(CAPTURAS, `funcional_panel_${nombre === 'móvil' ? 'movil' : nombre}.png`), fullPage: true }); }
      await p.context().close();
    }
    const q = await abrir(base, '/index.html', { viewport: { width: 390, height: 844 } }); await entrar(q); await q.evaluate(() => mostrarQR()); await q.waitForTimeout(600);
    ok('el código QR se dibuja y apunta al modo apoderado', (await q.evaluate(() => document.querySelectorAll('#qrBox canvas, #qrBox img').length)) >= 1 && /\?apoderado/.test(await q.textContent('#qrUrl'))); await q.context().close();

    if (ACTUAL && LIBS) {
      sec('5) Comparación con la versión publicada hoy (main): el panel y los formularios abren en ambas y sin errores');
      const sMain = await servir(ACTUAL), baseMain = `http://127.0.0.1:${sMain.address().port}`;
      await db.admin(`update public.config set modo_transicion=true`);
      for (const [nombre, vp] of [['escritorio', { width: 1280, height: 900 }], ['móvil', { width: 390, height: 844 }]]) {
        const res = {};
        for (const [ver, b, antigua] of [['main', baseMain, true], ['rama', base, false]]) {
          const p = await abrir(b, '/index.html', { viewport: vp, antigua }); const d = [await desborde(p)];
          await entrar(p); d.push(await desborde(p)); await p.click('.card-btn:nth-child(1)'); await p.waitForTimeout(300); d.push(await desborde(p)); await p.evaluate(() => volverInicio()); await panel(p); d.push(await desborde(p));
          res[ver] = { d, panel: (await pant(p)) === 'scr-admin', err: p.errores.length }; await p.context().close();
        }
        ok(`${nombre}: la rama no desborda más que main y el panel abre en ambas sin errores`, res.rama.d.every((x, i) => x <= Math.max(res.main.d[i], 0) + 1) && res.main.panel && res.rama.panel && res.rama.err === 0 && res.main.err === 0, JSON.stringify(res));
      }
      sMain.close();
    } else console.log('\n(Comparación visual con main omitida: define PAGINA_ACTUAL y LIBS_ANTIGUAS para ejecutarla)');
  } catch (e) { F++; console.log('\n✘ Error inesperado:', e.stack.split('\n').slice(0, 5).join('\n')); }
  finally { await navegador.close(); sRama.close(); sync.cerrar(); await db.cerrar(); }
  console.log(`\nResultado: ${P} comprobaciones correctas, ${F} fallidas`);
  process.exit(F ? 1 : 0);
})();
