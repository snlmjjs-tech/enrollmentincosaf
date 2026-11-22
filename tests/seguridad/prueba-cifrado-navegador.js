// Prueba de extremo a extremo de las MATRÍCULAS CIFRADAS en un navegador (Chromium), con la página real y la CSP activa:
//   navegador → apps-script/Code.gs (entorno de Google SIMULADO) → funciones SQL REALES (Postgres LOCAL).
// Datos 100 % ficticios. No se conecta a ningún servicio real ni envía correos.
// Uso: PGPORT=5499 node tests/seguridad/prueba-cifrado-navegador.js
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const { crearRpc } = require('./rpc-local');
const { crearRpcSync } = require('./rpc-sync');
const { crearEntorno } = require('./apps-script-simulado');
const { exigirBaseLocal } = require('./guardia-entorno');
const XLSX = require('xlsx');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const RAIZ = path.resolve(__dirname, '../..');
const PUERTO = process.env.PGPORT || '5499';
exigirBaseLocal('127.0.0.1', PUERTO);
const OPTS = { host: '127.0.0.1', port: +PUERTO, user: 'postgres', database: 'postgres' };
const db = crearRpc(OPTS), sync = crearRpcSync(OPTS);
const URL_SUPABASE = 'https://mtlunrefaxsagfkphvvw.supabase.co';           // la dirección que trae la página; se atiende localmente
const C = require(path.join(__dirname, '../../js/cifrado.js'));
let conLlave = true, PUBLICA = null, ARCHIVO = null;
const CLAVE_LLAVE = 'clave-del-colegio-solo-prueba-77';
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
const servir = () => new Promise(res => { const s = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); if (u === '/js/llave-publica.js') { r.writeHead(200, { 'Content-Type': 'application/javascript' }); return r.end(conLlave ? `window.LLAVE_PUBLICA_COLEGIO = ${JSON.stringify(PUBLICA)};` : 'window.LLAVE_PUBLICA_COLEGIO = null;'); }
  const f = path.join(RAIZ, u === '/' ? 'index.html' : u);
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
const radioPill = (pg, sel) => pg.click('label.radio-pill:has(' + sel + ')');   // como una persona: sobre la etiqueta visible; Playwright espera a que deje de desplazarse
const cerrarAviso = pg => pg.evaluate(() => cerrar('ovAviso'));
const idE = (n, c) => '#' + (n === 1 ? 'e_' : `e${n}_`) + c;
const gn = (n, g) => n === 1 ? g : g + n;
async function llenarEst(pg, n, o) {
  const f = (c, v) => pg.fill(idE(n, c), v);
  await radioPill(pg, `input[name=tipo_${n}][value=${o.tipo}]`);
  await f('nombre', o.nombre); await f('rut', o.rut); await pg.press(idE(n, 'rut'), 'Tab'); await f('fnac', '2012-05-10'); await f('dir', 'Calle Ficticia 123 TEST');
  await f('comuna', 'Comuna TEST'); await f('nacionalidad', 'Chilena'); await f('cel', '+56 9 0000 0000');
  if (o.tipo === 'nuevo') { await f('procedencia', 'Colegio TEST'); if (o.curso) await pg.selectOption(idE(n, 'cursoNuevo'), o.curso); }
  else { await pg.selectOption(idE(n, 'cursoAnt'), o.curso || '2° Medio'); await f('letraAnt', o.letra || 'a'); }
  await radioPill(pg, `input[name=${gn(n, 'rep')}][value=no]`);
  await radioPill(pg, `input[name=${gn(n, 'pie')}][value=${o.pie || 'no'}]`);
  if (o.pie === 'si') { await f('pieDiag', 'Diagnóstico TEST'); await radioPill(pg, `input[name=${gn(n, 'pieDoc')}][value=si]`); }
  await radioPill(pg, `input[name=${gn(n, 'salud')}][value=no]`);
  if (n > 1 && o.parentesco) await pg.selectOption(idE(n, 'parentesco'), o.parentesco);
  if (n > 1 && o.vive) await pg.selectOption(idE(n, 'vive'), o.vive);
}
async function llenarApoderado(pg, correo = DEST) {
  await pg.fill('#a_nombre', 'Apoderado TEST'); await pg.fill('#a_rut', rut(22222222)); await pg.press('#a_rut', 'Tab'); await pg.fill('#a_edad', '40');
  await pg.fill('#a_dir', 'Calle Ficticia 123 TEST'); await pg.fill('#a_comuna', 'Comuna TEST'); await pg.fill('#a_nacionalidad', 'Chilena'); await pg.fill('#a_cel', '+56 9 0000 0001');
  await pg.fill('#a_mail', correo); await pg.selectOption('#a_parentesco', { index: 1 }); await pg.check('#consent_datos'); if (await pg.isVisible('#consent_sens_wrap')) await pg.check('#consent_sensibles');
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


const NOMBRES = ['Ana TEST', 'Beto TEST', 'Apoderado TEST', 'apoderado.test@example.invalid', 'Calle Ficticia', 'Comuna TEST', '+56 9 0000', 'Diagnóstico TEST', 'Colegio TEST'];
const conPuntos = r => r.replace(/^(\d+)(\d{3})(\d{3})-/, '$1.$2.$3-');
const sinLegible = t => NOMBRES.every(x => !t.includes(x)) && !t.includes(rut(41000001)) && !t.includes(conPuntos(rut(41000001)));
const H = [
  { nombre: 'Ana TEST Uno', rut: rut(41000001), tipo: 'antiguo', curso: '1° Medio', letra: 'a', pie: 'si' },
  { nombre: 'Beto TEST Dos', rut: rut(41000002), tipo: 'nuevo', curso: '2° Medio' }
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const abrirPanel = async (pg, key) => { await pg.click('.admin-link'); await pg.fill('#inputClave', ENC); await pg.click('#ovClave .btn-pri'); await pg.waitForTimeout(900); };
const desbloquear = async (pg, ruta, clave = CLAVE_LLAVE) => { await pg.setInputFiles('#archivoLlave', ruta); await pg.fill('#claveLlave', clave); await pg.click('#btnDesbloquear'); await pg.waitForTimeout(1500); };
const cuerpo = pg => pg.evaluate(() => document.body.innerText);
const nFilas = pg => pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr .acciones').length);

(async () => {
  for (const sql of ['supabase/schema.sql', 'supabase/migraciones/002_matricula_multiple.sql', 'supabase/migraciones/003_cifrado.sql']) execFileSync('psql', ['-h', '127.0.0.1', '-p', PUERTO, '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(RAIZ, sql)], { stdio: 'ignore' });
  await db.admin(`update public.config set modo_transicion=false, exigir_cifrado=false; update public.config set clave_script_hash = extensions.crypt('${SECRETO}', extensions.gen_salt('bf')) where id; delete from public.intentos; delete from public.sesiones`);
  await db.admin(`delete from public.matriculas; delete from public.solicitudes; delete from public.prematriculas`);
  const k = await C.crearLlaveColegio(CLAVE_LLAVE); PUBLICA = k.publica; ARCHIVO = k.archivo;
  const RUTA = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cifrado-nav-')), 'llave-del-colegio.json'); fs.writeFileSync(RUTA, JSON.stringify(ARCHIVO));
  const srv = await servir(); base = `http://127.0.0.1:${srv.address().port}`; navegador = await chromium.launch();
  gs = crearEntorno({ codigo: CODIGO, props: PROPS, sync });
  const cspMalas = [];

  try {
    sec('1) Con el cifrado ENCENDIDO: matrícula de 2 hermanos → la base solo guarda texto ilegible');
    let pg = await abrir('/index.html', { dl: true }); await entrar(pg);
    ok('el aviso de privacidad dice que los datos se guardan cifrados (la llave está configurada)', await pg.evaluate(() => !document.getElementById('privCifrado').hidden));
    await pg.click('.card-btn:nth-child(1)');
    await llenarEst(pg, 1, H[0]); await pg.click('#btnAddEst'); await llenarEst(pg, 2, H[1]); await llenarApoderado(pg);
    await enviar(pg);
    ok('con 2 estudiantes se pasa por el resumen', await pant(pg) === 'scr-resumen'); await pg.click('#btnConfirmarResumen'); await pg.waitForTimeout(1000);
    ok('se generan 12 hojas (6 por estudiante) y el consentimiento dice que las matrículas se guardan cifradas', (await hojas(pg)) === 12 && (await pg.evaluate(() => document.getElementById('printArea').innerText)).includes('se guardan cifradas'));
    estado.rpcs.length = 0; await finalizar(pg, 3500);
    ok('se usó el guardado CIFRADO y no el normal', estado.rpcs.includes('guardar_solicitud_cifrada') && !estado.rpcs.includes('guardar_solicitud') && estado.rpcs.includes('preparar_correo'), estado.rpcs.join(','));
    const sol1 = await ultimaSolicitud(); const filas1 = await filasDe(sol1.id);
    ok('se guardaron 2 matrículas cifradas con folio, tipo y orden', filas1.length === 2 && filas1.every(f => C.esCifrado(f.datos)) && filas1[0].tipo === 'antiguo' && filas1[1].tipo === 'nuevo');
    const volcado = (await db.admin('select m::text t from public.matriculas m')).rows.map(r => r.t).join('\n') + (await db.admin('select s::text t from public.solicitudes s')).rows.map(r => r.t).join('\n');
    ok('en la base NO hay ningún dato legible (ni nombres, ni RUT, ni correo, ni dirección, ni diagnóstico)', sinLegible(volcado), volcado.slice(0, 300));
    ok('el correo salió (UN correo con 2 certificados) con los datos del paquete temporal', gs.enviados.length === 1 && gs.enviados[0].attachments.length === 2 && gs.enviados[0].to === DEST && /Ana TEST Uno/.test(gs.enviados[0].body) && /Beto TEST Dos/.test(gs.enviados[0].body), JSON.stringify(gs.enviados.map(m => m.to)));
    ok('enviado el correo, el paquete temporal con nombres y correo se borró de la base', (await db.admin('select correo_estado, correo_paquete from public.solicitudes where id = $1', [sol1.id])).rows.every(r => r.correo_estado === 'enviado' && r.correo_paquete === null));
    ok('la pantalla final muestra las 2 fichas y que el correo se envió', await pant(pg) === 'scr-done' && /Fichas \d+ y \d+/.test(await pg.textContent('#folioTxt')) && /UN correo con los 2 certificados/.test(await pg.textContent('#doneMail')));
    cspMalas.push(...await pg.evaluate(() => window.__csp)); ok('sin errores de JavaScript en el flujo cifrado', pg.errores.length === 0, pg.errores.join(' | '));

    sec('2) Panel: bloqueado hasta abrir la llave; con la llave se ve todo normal');
    const pp = await abrir('/index.html', { dl: true }); await entrar(pp); await abrirPanel(pp);
    ok('al entrar al panel pide la llave y NO muestra ningún dato', await pp.isVisible('#ovLlave') && sinLegible(await cuerpo(pp)) && (await nFilas(pp)) === 0);
    await pp.fill('#claveLlave', 'esto-no-es-la-clave'); await pp.setInputFiles('#archivoLlave', RUTA); await pp.click('#btnDesbloquear'); await pp.waitForTimeout(1500);
    ok('con una clave equivocada NO se abre y se explica', /Clave incorrecta/.test(await pp.textContent('#msgLlave')) && sinLegible(await cuerpo(pp)));
    const basura = path.join(path.dirname(RUTA), 'basura.json'); fs.writeFileSync(basura, '{"hola":1}');
    await pp.setInputFiles('#archivoLlave', basura); await pp.fill('#claveLlave', CLAVE_LLAVE); await pp.click('#btnDesbloquear'); await pp.waitForTimeout(800);
    ok('un archivo que no es la llave se rechaza con un mensaje claro', /no es una llave/.test(await pp.textContent('#msgLlave')));
    await desbloquear(pp, RUTA);
    ok('con la llave y la clave correctas aparecen las 2 matrículas con sus datos', (await nFilas(pp)) === 2 && (await cuerpo(pp)).includes('Ana TEST Uno') && (await cuerpo(pp)).includes('Beto TEST Dos') && await pp.isHidden('#ovLlave'));
    ok('el panel avisa que está desbloqueado y la clave y el archivo se borraron del formulario', /Desbloqueado/.test(await pp.textContent('#avisoCifrado')) && (await pp.inputValue('#claveLlave')) === '');
    await pp.fill('#fBusqueda', 'beto'); await pp.waitForTimeout(300);
    ok('la búsqueda funciona sobre los datos descifrados (1 de 2)', (await nFilas(pp)) === 1); await pp.fill('#fBusqueda', ''); await pp.waitForTimeout(300);
    const [dx] = await Promise.all([pp.waitForEvent('download'), pp.click('#btnDescargarExcel')]);
    const rx = path.join(path.dirname(RUTA), 'matriculas.xlsx'); await dx.saveAs(rx);
    const hoja = XLSX.utils.sheet_to_json(XLSX.readFile(rx).Sheets['Matrículas 2027']);
    ok('el Excel sale LEGIBLE con los datos completos (descifrados en el navegador)', hoja.length === 2 && hoja[0]['Nombre estudiante'] === 'Ana TEST Uno' && hoja[0]['RUT estudiante'].replace(/\./g, '') === rut(41000001) && hoja[0]['Correo apoderado'] === DEST && hoja[0]['Diagnóstico PIE'] === 'Diagnóstico TEST', JSON.stringify(hoja[0]).slice(0, 200));
    await pp.click('#btnCopiarTabla'); await pp.waitForTimeout(500);
    const tsv = await pp.evaluate(() => document.getElementById('textoTabla').value);
    ok('«Copiar tabla» deja el texto para pegar en Excel (si el navegador no deja copiar, se muestra para copiarlo a mano)', tsv.startsWith('Ficha\tFecha registro') && tsv.includes('Ana TEST Uno') && tsv.split('\n').length === 3 || (await pp.isVisible('#ovAviso')));
    await pp.evaluate(() => { cerrar('ovTabla'); cerrar('ovAviso'); });
    const [dr] = await Promise.all([pp.waitForEvent('download'), pp.click('#btnRespaldoCifrado')]);
    const rr = path.join(path.dirname(RUTA), 'respaldo.json'); await dr.saveAs(rr); const respaldo = fs.readFileSync(rr, 'utf8');
    ok('el RESPALDO CIFRADO trae las 2 matrículas tal como están en la base: sin ningún dato legible', JSON.parse(respaldo).filas.length === 2 && sinLegible(respaldo));
    await pp.click('#avisoCifrado .btn-chico'); await pp.waitForTimeout(500);
    ok('«Bloquear ahora» borra los datos de la pantalla y vuelve a pedir la llave', (await nFilas(pp)) === 0 && sinLegible(await cuerpo(pp)) && await pp.isVisible('#ovLlave'));
    await pp.fill('#pegarLlave', fs.readFileSync(RUTA, 'utf8')); await pp.fill('#claveLlave', CLAVE_LLAVE); await pp.click('#btnDesbloquear'); await pp.waitForTimeout(1500);
    ok('también se puede desbloquear PEGANDO el texto de la llave (sin archivo)', (await nFilas(pp)) === 2);

    sec('3) Editar, cambiar el N° de ficha, reenviar el correo y reimprimir sobre matrículas cifradas');
    await pp.click('#tbodyAdmin tr:first-child button[title="Editar matrícula"]'); await pp.waitForTimeout(800); await cerrarAviso(pp); await pp.waitForTimeout(300);
    ok('al editar se carga la ficha descifrada y NO se vuelve a pedir el consentimiento', await pant(pp) === 'scr-form' && (await pp.inputValue('#e_nombre')) === 'Ana TEST Uno' && await pp.isHidden('#fsPrivacidad'));
    await pp.fill('#e_nombre', 'Ana TEST EDITADA'); estado.rpcs.length = 0; await pp.click('#ficha button[type=submit]'); await pp.waitForTimeout(1500);
    ok('se guarda con el guardado cifrado y la base no ve el cambio', estado.rpcs.includes('actualizar_matricula_cifrada') && !estado.rpcs.includes('actualizar_matricula') && !(await db.admin('select datos::text t from public.matriculas')).rows.some(r => /EDITADA/.test(r.t)));
    await pp.evaluate(() => cerrar('ovAviso')); await pp.waitForTimeout(300);
    ok('el panel vuelve con el nombre nuevo (descifrado) y sigue desbloqueado', (await cuerpo(pp)).includes('Ana TEST EDITADA'));
    await pp.click('#tbodyAdmin tr:first-child button[title="Cambiar N° de ficha"]'); await pp.fill('#inputFolioFicha', '57'); await pp.click('#btnGuardarFolioFicha'); await pp.waitForTimeout(1200);
    ok('cambiar el N° de ficha funciona y la ficha sigue abriéndose', (await db.admin('select count(*)::int n from public.matriculas where folio = 57')).rows[0].n === 1 && (await cuerpo(pp)).includes('Ana TEST EDITADA'));
    // una solicitud cifrada con el correo todavía sin enviar → «Reenviar» desde el panel
    const interna = (await db.rpc('iniciar_sesion', { p_clave: FUNC, p_rol: 'interna' }, { ip: '198.51.100.40' })).token;
    const sid = uuidLocal(); const rf = await db.rpc('reservar_folios', { p_clave: interna, p_solicitud: sid, p_cantidad: 1 }, { ip: '198.51.100.40' });
    const fch = { folio: String(rf.folios[0]), fechaRegistro: '23-10-2026, 10:00:00', tipo: 'nuevo', estudiante: { nombre: 'Carla TEST Tres', rut: rut(41000003), procedencia: 'Colegio TEST', cursoMatricula: '2° Medio', pie: 'no', salud: 'no' }, apoderado: { nombre: 'Apoderado TEST', rut: rut(22222222), correo: DEST, celular: '+56 9 0000 0001' }, suplente: null };
    const mid = uuidLocal(); const pq = { destinatario: DEST, apoderado: 'Apoderado TEST', estudiantes: [{ folio: fch.folio, nombre: 'Carla TEST Tres', rut: fch.estudiante.rut, cursoMatricula: '2° Medio', procedencia: 'Colegio TEST' }] };
    await db.rpc('guardar_solicitud_cifrada', { p_clave: interna, p_solicitud: sid, p_matriculas: [{ id: mid, folio: rf.folios[0], tipo: 'nuevo', fechaRegistro: fch.fechaRegistro, cifrado: await C.cifrarFicha(fch, PUBLICA, 'matricula:' + mid) }], p_paquete: pq }, { ip: '198.51.100.40' });
    await db.admin('update public.solicitudes set correo_paquete = null, correo_paquete_en = null where id = $1', [sid]);   // como si ya hubieran pasado las 24 h
    await pp.evaluate(() => cargarAdmin()); await pp.waitForTimeout(1200);
    ok('la solicitud nueva aparece con su correo «Pendiente» y el botón de reenviar', (await pp.locator('#tbodyAdmin .btn-mail').count()) === 1);
    const antesEnv = gs.enviados.length; await pp.click('#tbodyAdmin .btn-mail'); await pp.waitForTimeout(3000);
    ok('«Reenviar» deja el paquete temporal, envía el correo y lo borra otra vez', gs.enviados.length === antesEnv + 1 && gs.enviados[gs.enviados.length - 1].attachments.length === 1 && /Carla TEST Tres/.test(gs.enviados[gs.enviados.length - 1].body)
      && (await db.admin('select correo_estado, correo_paquete from public.solicitudes where id = $1', [sid])).rows.every(r => r.correo_estado === 'enviado' && r.correo_paquete === null));
    await pp.evaluate(() => cerrar('ovAviso')); await pp.waitForTimeout(300);
    await pp.evaluate(() => { window.print = () => { window.__impreso = (window.__impreso || 0) + 1; }; }); await pp.click('#tbodyAdmin tr:has-text("Ana TEST EDITADA") button[title="Imprimir ficha de matrícula"]'); await pp.waitForTimeout(400);
    ok('reimprimir una ficha cifrada arma la hoja con los datos descifrados', (await pp.evaluate(() => window.__impreso)) === 1 && (await pp.evaluate(() => document.getElementById('printArea').innerText)).includes('Ana TEST EDITADA'));

    sec('4) El panel se bloquea al salir y por inactividad');
    await pp.click('#scr-admin button[data-click="volverInicio"]'); await pp.waitForTimeout(400);
    await pp.click('.admin-link'); await pp.fill('#inputClave', ENC); await pp.click('#ovClave .btn-pri'); await pp.waitForTimeout(900);
    ok('al salir del panel y volver a entrar, vuelve a pedir la llave (no quedó abierta)', await pp.isVisible('#ovLlave') && (await nFilas(pp)) === 0);
    await pp.context().close();
    const pr = await navegador.newContext({ viewport: { width: 1100, height: 900 } }); const pc = await pr.newPage(); await pc.clock.install();
    pc.errores = []; pc.on('pageerror', e => pc.errores.push(String(e)));
    await pc.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await pc.route(`${URL_SUPABASE}/**`, async ruta => { const rq = ruta.request(); const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': '*' };
      if (rq.method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: cors }); const nombre = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(new URL(rq.url()).pathname)[1];
      try { const d = await db.rpc(nombre, rq.postDataJSON() || {}, { ip: '203.0.113.99' }); ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(d === undefined ? null : d) }); } catch (e) { ruta.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: e.message }) }); } });
    await pc.goto(base + '/index.html'); await pc.waitForTimeout(500); await entrar(pc); await abrirPanel(pc); await desbloquear(pc, RUTA);
    ok('(reloj simulado) el panel está abierto con datos', (await nFilas(pc)) >= 3);
    await pc.clock.fastForward('09:00'); const abiertoA = (await nFilas(pc)) >= 3;
    await pc.clock.fastForward('02:00'); await pc.waitForTimeout(1500);
    ok('a los 10 minutos sin usarlo se bloquea solo (y no antes) y los datos desaparecen', abiertoA && (await nFilas(pc)) === 0 && sinLegible(await cuerpo(pc)) && await pc.isVisible('#ovLlave'));
    await pr.close();

    sec('5) Convertir las matrículas que quedaron sin cifrar');
    const sid2 = uuidLocal(); const rf2 = await db.rpc('reservar_folios', { p_clave: interna, p_solicitud: sid2, p_cantidad: 1 }, { ip: '198.51.100.41' });
    await db.rpc('guardar_solicitud', { p_clave: interna, p_solicitud: sid2, p_fichas: [{ ...fch, folio: String(rf2.folios[0]), estudiante: { ...fch.estudiante, nombre: 'Dani TEST Cuatro', rut: rut(41000004) } }] }, { ip: '198.51.100.41' });
    ok('(preparación) hay una matrícula sin cifrar en la base', (await db.admin(`select count(*)::int n from public.matriculas where datos->'estudiante'->>'nombre' = 'Dani TEST Cuatro'`)).rows[0].n === 1);
    const pv = await abrir('/index.html', { dl: true }); await entrar(pv); await abrirPanel(pv); await desbloquear(pv, RUTA);
    ok('el panel avisa que hay 1 matrícula sin cifrar y ofrece cifrarla', /1 matrícula\(s\) todavía sin cifrar/.test(await pv.textContent('#avisoCifrado')) && (await cuerpo(pv)).includes('Dani TEST Cuatro'));
    await pv.click('#avisoCifrado .aviso-cifrado-alerta ~ .btn-chico'); await pv.waitForTimeout(400); await pv.click('#btnConvertir'); await pv.waitForTimeout(2500);
    ok('«Cifrar ahora» la convierte: en la base ya no se lee su nombre y el panel la sigue mostrando', (await db.admin(`select count(*)::int n from public.matriculas where datos::text like '%Dani TEST%'`)).rows[0].n === 0 && (await cuerpo(pv)).includes('Dani TEST Cuatro'));
    ok('ya no queda ninguna matrícula sin cifrar', (await db.admin(`select count(*)::int n from public.matriculas where not (datos ? 'ct')`)).rows[0].n === 0 && !/sin cifrar/.test(await pv.textContent('#avisoCifrado')));
    await pv.context().close();

    sec('6) Pre-matrícula (se guarda sin cifrar solo 2 horas) → el funcionario la carga → se guarda cifrada');
    const pa = await abrir('/index.html?apoderado'); await pa.click('.card-btn:nth-child(1)').catch(() => {});
    if (await pa.isVisible('#e_nombre') === false) await pa.evaluate(() => iniciarFicha('nuevo'));
    await llenarEst(pa, 1, { nombre: 'Eva TEST Cinco', rut: rut(41000005), tipo: 'nuevo', curso: '2° Medio' }); await llenarApoderado(pa); await enviar(pa);
    const codigo = (await db.admin('select codigo from public.prematriculas order by created_at desc limit 1')).rows[0]?.codigo;
    ok('la pre-matrícula del apoderado se guarda y entrega un código', !!codigo, await pant(pa));
    await pa.context().close();
    const pf = await abrir('/index.html', { dl: true }); await entrar(pf); await pf.evaluate(() => abrirCargarCodigo()); await pf.fill('#inputCodigo', codigo); await pf.click('#btnBuscarCodigo'); await pf.waitForTimeout(1000); await cerrarAviso(pf);
    ok('el funcionario carga los datos del apoderado sin necesitar la llave', (await pf.inputValue('#e_nombre')) === 'Eva TEST Cinco');
    await pf.click('#ficha button[type=submit]'); await pf.waitForTimeout(900);
    ok('sin marcar el consentimiento no avanza (hay que marcarlo al cargar una pre-matrícula)', await pant(pf) === 'scr-form'); await pf.check('#consent_datos'); await enviar(pf);
    estado.rpcs.length = 0; await finalizar(pf, 3000);
    ok('al finalizar se guarda CIFRADA, la pre-matrícula se consume y sale el correo', estado.rpcs.includes('guardar_solicitud_cifrada') && (await db.admin('select count(*)::int n from public.prematriculas')).rows[0].n === 0
      && (await db.admin(`select count(*)::int n from public.matriculas where datos::text like '%Eva TEST%'`)).rows[0].n === 0 && gs.enviados.length >= 3);
    await pf.context().close();

    sec('7) Seguros: una página sin la llave no puede guardar sin cifrar cuando la obligación está encendida');
    await db.admin('update public.config set exigir_cifrado = true');
    conLlave = false;
    const po = await abrir('/index.html', { dl: true }); await entrar(po); await po.click('.card-btn:nth-child(1)');
    ok('con la llave sin configurar, el aviso de privacidad NO dice «cifrados» (no promete algo que no está activo)', await po.evaluate(() => document.getElementById('privCifrado').hidden));
    await llenarEst(po, 1, { nombre: 'Fer TEST Seis', rut: rut(41000006), tipo: 'nuevo', curso: '2° Medio' }); await llenarApoderado(po); await enviar(po); await finalizar(po, 2500);
    ok('la base rechaza guardar sin cifrar y la página lo explica (no queda nada guardado)', /cifrad/i.test(await po.textContent('#avisoTexto')) && (await db.admin(`select count(*)::int n from public.matriculas where datos::text like '%Fer TEST%'`)).rows[0].n === 0, await po.textContent('#avisoTexto'));
    await po.context().close(); conLlave = true; await db.admin('update public.config set exigir_cifrado = false');
    ok('nunca hubo violaciones de la política de seguridad (CSP)', cspMalas.length === 0, cspMalas.join(','));
  } catch (e) { F++; console.log('\n✘ Error inesperado:', e.stack.split('\n').slice(0, 6).join('\n')); }
  finally { await navegador.close(); srv.close(); sync.cerrar(); await db.cerrar(); }
  console.log(`\nResultado: ${P} comprobaciones correctas, ${F} fallidas`);
  process.exit(F ? 1 : 0);
})();
