// Prueba de extremo a extremo de la PÁGINA REAL en un navegador (Chromium), con:
//  · la política de seguridad de contenido (CSP) tal como está en index.html,
//  · las librerías reales de vendor/ (supabase-js, jsPDF, XLSX, QRCode),
//  · las funciones SQL reales (supabase/schema.sql) en un Postgres local con datos ficticios.
// Las llamadas a Supabase y al script de Google se interceptan en el navegador y se atienden aquí.
// No se conecta a ningún servicio real ni usa datos reales.
//
// Uso (con la base preparada por prepara-postgres.sh):  PGPORT=5499 node tests/seguridad/prueba-navegador.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { crearRpc } = require('./rpc-local');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const RAIZ = path.resolve(__dirname, '../..');
const PUERTO_PG = +(process.env.PGPORT || 5499);
const URL_SUPABASE = 'https://mtlunrefaxsagfkphvvw.supabase.co';
const db = crearRpc({ host: '127.0.0.1', port: PUERTO_PG, user: 'postgres', database: 'postgres' });

const CLAVE_FUNCIONARIOS = 'clave-funcionarios-ficticia', CLAVE_ENCARGADOS = 'clave-encargados-ficticia';
let pasadas = 0, falladas = 0;
const ok = (n, c, d) => { if (c) { pasadas++; console.log(`  ✔ ${n}`); } else { falladas++; console.log(`  ✘ ${n}${d ? '  → ' + d : ''}`); } };
const seccion = t => console.log(`\n${t}`);

// Servidor estático mínimo (solo lectura) para servir la carpeta del proyecto
function servidorEstatico() {
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const ruta = decodeURIComponent(req.url.split('?')[0]);
      // APP_JS=<archivo>: sirve otra versión de js/app.js (por ejemplo la minificada) para probarla
      const archivo = (process.env.APP_JS && ruta === '/js/app.js') ? process.env.APP_JS : path.join(RAIZ, ruta === '/' ? 'index.html' : ruta);
      if ((!archivo.startsWith(RAIZ) && archivo !== process.env.APP_JS) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) { res.writeHead(404); return res.end('no existe'); }
      res.writeHead(200, { 'Content-Type': tipos[path.extname(archivo)] || 'application/octet-stream' });
      fs.createReadStream(archivo).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve({ s, puerto: s.address().port }));
  });
}

(async () => {
  // Base limpia con el esquema nuevo y claves ficticias
  for (const sql of ['supabase/schema.sql', 'supabase/migraciones/002_matricula_multiple.sql']) {   // la página nueva necesita las dos
    execFileSync('psql', ['-h', '127.0.0.1', '-p', String(PUERTO_PG), '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(RAIZ, sql)], { stdio: 'ignore' });
  }
  await db.admin(`update public.config set modo_transicion = false`);
  await db.admin(`delete from public.intentos; delete from public.sesiones; delete from public.auditoria`);
  const antes = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;

  const { s: servidor, puerto } = await servidorEstatico();
  const base = `http://127.0.0.1:${puerto}`;
  const navegador = await chromium.launch();

  const estado = { correos: [], violacionesCSP: [], erroresPagina: [], consultas: [], falloInterno: false };
  async function nuevaPagina(url, { descargas = false } = {}) {
    const ctx = await navegador.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: descargas });
    const pg = await ctx.newPage();
    pg.violaciones = []; pg.errores = [];
    await pg.addInitScript(() => {
      window.__xss = [];
      document.addEventListener('securitypolicyviolation', e => (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + (e.blockedURI || '')));
    });
    pg.on('pageerror', e => { pg.errores.push(String(e)); estado.erroresPagina.push(String(e)); });
    // Supabase: se atiende con las funciones SQL reales
    await pg.route(`${URL_SUPABASE}/**`, async ruta => {
      const req = ruta.request();
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': '*' };
      if (req.method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: cors });
      const m = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(new URL(req.url()).pathname);
      if (!m) return ruta.fulfill({ status: 404, headers: cors, body: '{}' });
      if (estado.falloInterno) return ruta.fulfill({ status: 500, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'relation "public.secreto_interno" does not exist', code: '42P01' }) });
      estado.consultas.push(m[1]);
      try {
        const datos = await db.rpc(m[1], req.postDataJSON() || {}, { ip: '203.0.113.99' });
        ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(datos === undefined ? null : datos) });
      } catch (e) {
        ruta.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: e.message, code: e.code || 'P0001' }) });
      }
    });
    // Script de Google (correo): se captura lo que enviaría la página
    await pg.route('https://script.google.com/**', async ruta => {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
      if (ruta.request().method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: cors });
      estado.correos.push(ruta.request().postDataJSON());
      ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) });
    });
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await pg.goto(url);
    await pg.waitForLoadState('domcontentloaded');
    await pg.waitForTimeout(500);
    return pg;
  }
  const pantalla = pg => pg.evaluate(() => document.querySelector('.screen.active')?.id);
  const entrarPersonal = async (pg, clave = CLAVE_FUNCIONARIOS) => { await pg.fill('#inputClaveInterna', clave); await pg.press('#inputClaveInterna', 'Enter'); await pg.waitForTimeout(700); };
  const entrarPanel = async (pg, clave = CLAVE_ENCARGADOS, { abrir = true } = {}) => { if (abrir) await pg.click('.admin-link'); await pg.fill('#inputClave', clave); await pg.click('#ovClave .btn-pri'); await pg.waitForTimeout(900); };

  try {
    seccion('1) Política de seguridad de contenido (CSP) y librerías');
    let pg = await nuevaPagina(base + '/index.html');
    ok('la CSP está en la página', /Content-Security-Policy/.test(await pg.content()));
    ok('no quedan manejadores en línea (onclick, onchange…) en el HTML', (await pg.evaluate(() => [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /^on/i.test(a.name))).length)) === 0);
    const libs = await pg.evaluate(() => ({ supabase: typeof window.supabase?.createClient, jspdf: typeof window.jspdf?.jsPDF, xlsx: typeof window.XLSX?.utils?.json_to_sheet, qr: typeof window.QRCode }));
    ok('las 4 librerías locales cargan (supabase-js, jsPDF, XLSX, QRCode)', libs.supabase === 'function' && libs.jspdf === 'function' && libs.xlsx === 'function' && libs.qr === 'function', JSON.stringify(libs));
    // la CSP realmente bloquea código inyectado
    const bloqueo = await pg.evaluate(async () => {
      const s = document.createElement('script'); s.textContent = 'window.__xss.push("script-inline")'; document.body.appendChild(s);
      const i = document.createElement('img'); i.src = 'x'; i.setAttribute('onerror', 'window.__xss.push("onerror-inline")'); document.body.appendChild(i);
      await new Promise(r => setTimeout(r, 500));
      return { xss: window.__xss.slice(), csp: (window.__csp || []).slice() };
    });
    ok('la CSP bloquea un <script> inyectado', !bloqueo.xss.includes('script-inline'));
    ok('la CSP bloquea un manejador onerror inyectado', !bloqueo.xss.includes('onerror-inline'));
    ok('el navegador registró las violaciones (la política está activa)', bloqueo.csp.length >= 1, JSON.stringify(bloqueo.csp));
    await pg.context().close();

    seccion('2) Entrada del personal: sesión con token y límite de intentos');
    pg = await nuevaPagina(base + '/index.html');
    ok('al abrir, pide la clave interna', (await pantalla(pg)) === 'scr-acceso');
    await entrarPersonal(pg, 'clave-equivocada');
    ok('una clave incorrecta no deja entrar y lo dice', (await pantalla(pg)) === 'scr-acceso' && /incorrecta/i.test(await pg.textContent('#accesoError')));
    await entrarPersonal(pg);
    ok('la clave correcta abre el inicio', (await pantalla(pg)) === 'scr-home');
    const guardado = await pg.evaluate(() => ({ token: sessionStorage.getItem('tokenInterno'), clave: sessionStorage.getItem('claveInterna'), local: JSON.stringify(localStorage) }));
    ok('en el navegador queda un token de 64 caracteres, NO la clave', /^[0-9a-f]{64}$/.test(guardado.token || '') && guardado.clave === null && !guardado.local.includes('ficticia'));
    ok('el token no es la clave ni la contiene', !(guardado.token || '').includes('ficticia'));
    await pg.reload(); await pg.waitForTimeout(900);
    ok('al recargar la página sigue la sesión (el servidor valida el token)', (await pantalla(pg)) === 'scr-home');
    await pg.click('#btnSalir'); await pg.waitForTimeout(600);
    ok('«Cerrar acceso» vuelve a pedir la clave y borra el token', (await pantalla(pg)) === 'scr-acceso' && (await pg.evaluate(() => sessionStorage.getItem('tokenInterno'))) === null);
    ok('«Cerrar acceso» invalida el token también en el servidor', (await db.admin(`select count(*)::int n from public.sesiones where rol='interna' and expira > now() and token_hash = encode(extensions.digest($1,'sha256'),'hex')`, [guardado.token])).rows[0].n === 0);
    await pg.context().close();
    // bloqueo tras 10 fallos (de esa conexión)
    await db.admin('delete from public.intentos');
    pg = await nuevaPagina(base + '/index.html');
    for (let i = 0; i < 11; i++) await entrarPersonal(pg, 'mala' + i);
    const msgBloqueo = await pg.textContent('#accesoError');
    ok('tras muchos intentos fallidos aparece el aviso de espera', /Demasiados intentos/.test(msgBloqueo), msgBloqueo);
    await entrarPersonal(pg);
    ok('con el bloqueo activo ni la clave correcta entra', (await pantalla(pg)) === 'scr-acceso');
    await pg.context().close();
    await db.admin('delete from public.intentos');

    seccion('3) Registrar una matrícula completa (formulario, documentos, PDF, correo)');
    pg = await nuevaPagina(base + '/index.html');
    await entrarPersonal(pg);
    await pg.click('.card-btn:nth-child(2)');
    await pg.fill('#e_rut', '2179'); await pg.press('#e_rut', 'Tab'); await pg.waitForTimeout(300);
    await pg.fill('#a_mail', 'apoderado@example.com');
    ok('el truco 2179 rellena los datos de prueba', (await pg.inputValue('#e_nombre')) === 'Prueba de Matrículas');
    await pg.click('#ficha button[type=submit]'); await pg.waitForTimeout(900);
    ok('se generan los documentos (pantalla de impresión)', (await pantalla(pg)) === 'scr-memos');
    ok('se arman 4 hojas de impresión (3 autorizaciones + ficha)', (await pg.evaluate(() => document.querySelectorAll('#printArea .print-memo').length)) === 4);
    await pg.evaluate(() => { window.print = () => {}; }); await pg.click('button:has-text("Imprimir documentos")'); await pg.waitForTimeout(700);
    await pg.click('#btnFinalizar'); await pg.waitForTimeout(1800);
    ok('la matrícula se finaliza y se muestra el comprobante', (await pantalla(pg)) === 'scr-done', await pantalla(pg));
    const guardada = (await db.admin(`select datos from public.matriculas order by created_at desc limit 1`)).rows[0]?.datos;
    ok('la matrícula quedó guardada en la base', !!guardada && guardada.estudiante.nombre === 'Prueba de Matrículas');
    ok('el correo se envió al script de Google', estado.correos.length === 1);
    const c = estado.correos[0] || {};
    ok('el envío NO lleva ningún secreto fijo ni texto libre; lleva el token de sesión', !('secreto' in c) && !('body' in c) && !('subject' in c) && /^[0-9a-f]{64}$/.test(c.token || ''));
    ok('el envío lleva el id de la solicitud y los certificados; el destinatario y los textos los pone el servidor', /^[0-9a-f-]{36}$/.test(c.solicitudId || '') && Array.isArray(c.certificados) && c.certificados.length === 1 && !('to' in c) && !('nombreApoderado' in c));
    const pdf0 = ((c.certificados || [])[0] || {}).pdfBase64;
    ok('el PDF del certificado se generó con jsPDF 4.x (empieza con %PDF)', typeof pdf0 === 'string' && pdf0.startsWith('JVBER') && pdf0.length > 2000, 'longitud ' + (pdf0 || '').length);
    ok('el PDF va comprimido: pesa mucho menos que el límite (≈120 000 de 250 000 caracteres)', typeof pdf0 === 'string' && pdf0.length < 160000, 'longitud ' + (pdf0 || '').length);
    ok('no hubo errores de JavaScript', pg.errores.length === 0, pg.errores.join(' | '));
    const csp1 = await pg.evaluate(() => window.__csp || []);
    ok('no hubo violaciones de la CSP en todo el flujo (nada legítimo quedó bloqueado)', csp1.length === 0, JSON.stringify(csp1));
    await pg.context().close();

    seccion('4) Panel de encargados: sesión de administrador, botones, Excel, impresión');
    pg = await nuevaPagina(base + '/index.html', { descargas: true });
    await entrarPersonal(pg);
    await entrarPanel(pg, CLAVE_FUNCIONARIOS);
    ok('la clave de FUNCIONARIOS no abre el panel', (await pantalla(pg)) !== 'scr-admin');
    await pg.evaluate(() => cerrar('ovAviso'));
    await entrarPanel(pg, CLAVE_ENCARGADOS, { abrir: false });   // la ventana de clave sigue abierta tras el error
    ok('la clave de encargados abre el panel', (await pantalla(pg)) === 'scr-admin');
    ok('el token de administrador queda solo en memoria (no en el almacenamiento del navegador)', (await pg.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage))).indexOf(await pg.evaluate(() => tokenAdmin)) === -1);
    const filas = await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length);
    ok('el panel lista las matrículas', filas >= 3, 'filas=' + filas);
    ok('cada fila tiene sus 4 botones', (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr:first-child .btn-del').length)) === 4);
    const d1 = pg.waitForEvent('download'); await pg.click('#btnDescargarExcel'); const dl1 = await d1;
    const f1 = await dl1.path(); const b1 = fs.readFileSync(f1);
    ok('«Descargar Excel» genera un archivo .xlsx válido', b1.slice(0, 2).toString() === 'PK' && b1.length > 2000, 'bytes=' + b1.length);
    let leerXlsx = null; try { leerXlsx = require('xlsx'); } catch (e) { /* opcional: solo para leer el contenido del archivo */ }
    if (leerXlsx) {
      const wb1 = leerXlsx.readFile(f1), mat1 = leerXlsx.utils.sheet_to_json(wb1.Sheets[wb1.SheetNames[0]], { header: 1 });
      const enc1 = mat1[0] || [];
      ok('el Excel contiene una fila por matrícula y las columnas nuevas (parentesco, nivel educacional…)', mat1.length - 1 === filas && ['Parentesco apoderado', 'Situación laboral apoderado', 'Nombre estudiante'].every(c => enc1.includes(c)), 'filas=' + (mat1.length - 1) + ' columnas=' + enc1.length);
    }
    const d2 = pg.waitForEvent('download'); await pg.click('button:has-text("Excel formato libro digital")'); const dl2 = await d2;
    ok('«Excel formato libro digital» genera un .xlsx válido', fs.readFileSync(await dl2.path()).slice(0, 2).toString() === 'PK');
    if (leerXlsx) {
      const wb2 = leerXlsx.readFile(await dl2.path()); const hoja2 = leerXlsx.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]]);
      ok('el Excel «libro digital» conserva las columnas de la plantilla (N° Matrícula, Curso, Nombre, RUN…)', hoja2.length === filas && ['N° Matrícula', 'Curso', 'Nombre', 'RUN', 'Estado'].every(c => c in hoja2[0]), Object.keys(hoja2[0] || {}).slice(0, 6).join(','));
    }
    await pg.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
    await pg.click('#tbodyAdmin tr:first-child .btn-del[title^="Imprimir"]'); await pg.waitForTimeout(300);
    ok('el botón de imprimir arma una hoja y abre la impresión', (await pg.evaluate(() => window.__printed)) === 1 && (await pg.evaluate(() => document.querySelectorAll('#printArea .print-memo').length)) === 1);
    await pg.click('#tbodyAdmin tr:first-child .btn-del[title^="Editar"]'); await pg.waitForTimeout(500); await pg.evaluate(() => cerrar('ovAviso'));
    ok('el botón de editar carga la ficha en el formulario', (await pantalla(pg)) === 'scr-form' && (await pg.inputValue('#e_nombre')) !== '');
    await pg.evaluate(() => mostrar('scr-admin'));
    await pg.click('#tbodyAdmin tr:first-child .btn-del[title^="Cambiar"]'); await pg.waitForTimeout(300);
    ok('el botón # abre el cambio de N° de ficha', await pg.evaluate(() => document.getElementById('ovFolioFicha').classList.contains('show')));
    await pg.evaluate(() => cerrar('ovFolioFicha'));
    await pg.click('button:has-text("Contador de folio")'); await pg.waitForTimeout(500);
    ok('el contador de folio muestra el próximo número', /^\d+$/.test(await pg.inputValue('#inputSiguienteFolio')));
    await pg.evaluate(() => cerrar('ovContadorFolio'));
    ok('el panel no produjo errores de JavaScript ni violaciones de la CSP', pg.errores.length === 0 && ((await pg.evaluate(() => window.__csp || [])).length === 0), pg.errores.join('|'));
    ok('quedó registrada la actividad del panel en la auditoría', (await db.admin(`select count(*)::int n from public.auditoria where accion = 'listar_matriculas'`)).rows[0].n >= 1);
    await pg.context().close();

    seccion('5) Código malicioso: se muestra como TEXTO y no se ejecuta');
    const carga = n => `<img src=x onerror="window.__xss.push('${n}')">`;
    const cargaJs = n => `x');window.__xss.push('${n}');//`;
    // datos "heredados" o manipulados directamente en la base (saltándose la validación nueva)
    await db.admin(`delete from public.prematriculas where codigo = 'XSS777'`);
    await db.admin(`insert into public.prematriculas (codigo, creada, datos) values ('XSS777','x', $1::jsonb)`, [JSON.stringify({ tipo: 'nuevo',
      estudiante: { nombre: carga('prematricula-nombre'), rut: '11.111.111-1', fnac: '2012-03-15', direccion: carga('prematricula-direccion'), comuna: 'San Fernando', nacionalidad: 'Chilena', celular: '1', procedencia: carga('prematricula-procedencia'), repitencia: 'no', pie: 'no', salud: 'no', observaciones: carga('prematricula-obs') },
      apoderado: { nombre: carga('prematricula-apoderado'), rut: '12.345.678-5', edad: '40', direccion: 'x', comuna: 'y', nacionalidad: 'Chilena', celular: '1', parentesco: 'Madre', viveConEstudiante: 'si' }, suplente: null })]);
    const n0 = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;
    await db.admin(`insert into public.matriculas (folio, fecha_registro, tipo, datos) values (9001,'x','nuevo', $1::jsonb), (9002,'x','nuevo', $2::jsonb)`, [
      JSON.stringify({ folio: '9001', fechaRegistro: 'x', tipo: 'nuevo', estudiante: { nombre: carga('panel-nombre'), rut: carga('panel-rut'), procedencia: carga('panel-procedencia'), cursoMatricula: carga('panel-curso') }, apoderado: { nombre: carga('panel-apoderado'), celular: carga('panel-celular') }, suplente: null }),
      JSON.stringify({ folio: '9002', fechaRegistro: 'x', tipo: 'antiguo', estudiante: { nombre: cargaJs('panel-onclick'), rut: '1-9', cursoMatricula: carga('panel-curso2') }, apoderado: { nombre: 'Ap' }, suplente: null })]);
    pg = await nuevaPagina(base + '/index.html', { descargas: true });
    await entrarPersonal(pg);
    // a) el funcionario carga la pre-matrícula y genera los documentos
    await pg.evaluate(() => abrirCargarCodigo()); await pg.fill('#inputCodigo', 'xss-777'); await pg.click('#btnBuscarCodigo'); await pg.waitForTimeout(900);
    await pg.evaluate(() => cerrar('ovAviso'));
    ok('el nombre con HTML queda como texto dentro del campo del formulario', (await pg.inputValue('#e_nombre')).includes('<img'));
    await pg.click('#ficha button[type=submit]'); await pg.waitForTimeout(1000);
    ok('1.ª capa: el formulario rechaza los símbolos < y > ANTES de generar documentos y lo explica', (await pantalla(pg)) === 'scr-form' && /los símbolos < y > no están permitidos/.test(await pg.textContent('#bannerDetalle')));
    // 2.ª capa: aunque datos hostiles llegaran a la pantalla de documentos (saltándose el formulario), se muestran como texto
    await pg.evaluate(() => { const sol = recolectarSolicitud(); fichasActuales = fichasDeSolicitud(sol).map(f => ({ folio: '1', fechaRegistro: 'x', ...f })); fichaActual = fichasActuales[0]; renderMemos(); });
    const memos = await pg.evaluate(() => ({ pantalla: document.getElementById('memosPantalla').textContent, imprimir: document.getElementById('printArea').textContent, imgs: document.querySelectorAll('#memosPantalla img[src="x"], #printArea img[src="x"]').length }));
    ok('en los documentos y la ficha el HTML se ve como texto literal', memos.pantalla.includes('<img src=x onerror=') && memos.imprimir.includes('<img src=x onerror='));
    ok('no se creó ningún elemento <img> a partir de los datos', memos.imgs === 0);
    ok('ningún código se ejecutó al generar los documentos', (await pg.evaluate(() => window.__xss)).length === 0, JSON.stringify(await pg.evaluate(() => window.__xss)));
    // b) el encargado abre el panel con matrículas manipuladas
    await pg.evaluate(() => volverInicio());
    await entrarPanel(pg);
    const panel = await pg.evaluate(() => ({ texto: document.getElementById('tbodyAdmin').textContent, imgs: document.querySelectorAll('#tbodyAdmin img').length, opciones: [...document.querySelectorAll('#fCurso option')].map(o => o.textContent).join('|') }));
    ok('en el panel el HTML de las celdas se ve como texto', panel.texto.includes('<img src=x onerror=') && panel.imgs === 0);
    ok('en el filtro de cursos el HTML también es texto', panel.opciones.includes('<img'));
    ok('ningún código se ejecutó al abrir el panel', (await pg.evaluate(() => window.__xss)).length === 0, JSON.stringify(await pg.evaluate(() => window.__xss)));
    // c) botones de la fila con un nombre que intenta inyectar JavaScript
    const fila9002 = await pg.evaluate(() => [...document.querySelectorAll('#tbodyAdmin tr')].findIndex(t => t.textContent.includes('panel-onclick')) + 1);
    await pg.click(`#tbodyAdmin tr:nth-child(${fila9002}) .btn-del[title^="Eliminar"]`); await pg.waitForTimeout(400);
    ok('el nombre malicioso aparece como texto en la confirmación de borrado', (await pg.textContent('#nombreEliminar')).includes("window.__xss.push('panel-onclick')"));
    ok('el botón de eliminar con un nombre malicioso no ejecuta código', (await pg.evaluate(() => window.__xss)).length === 0);
    await pg.evaluate(() => cerrar('ovEliminar'));
    await pg.click(`#tbodyAdmin tr:nth-child(${fila9002}) .btn-del[title^="Imprimir"]`); await pg.waitForTimeout(300);
    await pg.evaluate(() => (window.print = () => {}));
    ok('imprimir una ficha con datos maliciosos tampoco ejecuta código', (await pg.evaluate(() => window.__xss)).length === 0);
    // d) mensajes del servidor con HTML
    await pg.evaluate(() => aviso('Prueba', '<img src=x onerror="window.__xss.push(\'aviso\')">'));
    ok('aviso() trata el texto como texto (no como HTML)', (await pg.evaluate(() => window.__xss)).length === 0 && (await pg.textContent('#avisoTexto')).includes('<img'));
    ok('sin errores de JavaScript durante las pruebas de inyección', pg.errores.length === 0, pg.errores.join('|'));
    await pg.context().close();
    await db.admin(`delete from public.matriculas where folio in (9001, 9002); delete from public.prematriculas where codigo = 'XSS777'`);
    ok('las matrículas de prueba maliciosas se retiraron y no se tocó nada más', (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n === n0);

    seccion('6) Formulario público del apoderado (?apoderado)');
    pg = await nuevaPagina(base + '/index.html?apoderado');
    ok('el apoderado entra directo, sin pedir clave', (await pantalla(pg)) === 'scr-home');
    ok('no ve el botón de cargar pre-matrícula ni el panel', await pg.evaluate(() => getComputedStyle(document.querySelector('.pre-row')).display === 'none' && getComputedStyle(document.querySelector('.admin-link')).display === 'none'));
    ok('el campo trampa no se ve ni se puede enfocar', await pg.evaluate(() => { const r = document.querySelector('.trampa').getBoundingClientRect(); return r.right < 0 || r.width <= 1; }));
    await pg.click('.card-btn:nth-child(1)');
    await pg.fill('#e_rut', '2179'); await pg.press('#e_rut', 'Tab'); await pg.waitForTimeout(300);
    await pg.click('#ficha button[type=submit]'); await pg.waitForTimeout(1000);
    const codigoPantalla = (await pg.textContent('#codigoGrande')).trim();
    ok('el apoderado recibe un código de 6 caracteres con la forma XXX-XXX', /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/.test(codigoPantalla), codigoPantalla);
    ok('se muestra el aviso importante junto al código', /SOLO LA PRE-MATR/.test(await pg.textContent('#scr-codigo .aviso-importante')));
    ok('el campo trampa viajó vacío', (await db.admin(`select count(*)::int n from public.prematriculas where datos ? '_hp'`)).rows[0].n === 0);
    await pg.context().close();
    // un robot que llena el campo trampa
    pg = await nuevaPagina(base + '/index.html?apoderado');
    await pg.click('.card-btn:nth-child(1)'); await pg.fill('#e_rut', '2179'); await pg.press('#e_rut', 'Tab');
    await pg.evaluate(() => { document.getElementById('sitio_web').value = 'http://spam.example'; });
    const antesPre = (await db.admin('select count(*)::int n from public.prematriculas')).rows[0].n;
    await pg.click('#ficha button[type=submit]'); await pg.waitForTimeout(900);
    ok('si se llena el campo trampa (robot), la pre-matrícula no se guarda', (await db.admin('select count(*)::int n from public.prematriculas')).rows[0].n === antesPre && (await pantalla(pg)) !== 'scr-codigo');
    await pg.context().close();
    // un apoderado que escribe HTML en un campo
    pg = await nuevaPagina(base + '/index.html?apoderado');
    await pg.click('.card-btn:nth-child(1)'); await pg.fill('#e_rut', '2179'); await pg.press('#e_rut', 'Tab');
    await pg.fill('#e_nombre', 'Ana <b>Pérez</b>'); await pg.click('#ficha button[type=submit]'); await pg.waitForTimeout(900);
    const detalle = await pg.textContent('#bannerDetalle');
    ok('1.ª capa: un campo con < o > se rechaza en el formulario con un mensaje claro (y no se guarda)', /Estudiante 1.*los símbolos < y > no están permitidos/.test(detalle) && (await pantalla(pg)) !== 'scr-codigo' && (await db.admin('select count(*)::int n from public.prematriculas')).rows[0].n === antesPre, detalle);
    // 2.ª capa: el servidor también lo rechaza si alguien se salta el formulario
    const errServidor = await pg.evaluate(async () => { try { await rpc('crear_prematricula', { p_datos: { ...recolectarDatos(), _hp: '' } }); return 'aceptado'; } catch (e) { return e.message; } });
    ok('2.ª capa: el servidor rechaza el campo con < o > (aunque se salte el formulario) con un mensaje claro', /caracteres no permitidos/.test(errServidor), errServidor);
    ok('el mensaje no muestra detalles internos de la base', !/function|public\.|constraint|ERROR/i.test(errServidor + detalle));
    await pg.context().close();

    seccion('7) El funcionario carga la pre-matrícula del apoderado con el código nuevo');
    const ultimoCodigo = (await db.admin(`select codigo from public.prematriculas where length(codigo)=6 order by created_at desc limit 1`)).rows[0].codigo;
    pg = await nuevaPagina(base + '/index.html');
    await entrarPersonal(pg);
    await pg.evaluate(() => abrirCargarCodigo()); await pg.fill('#inputCodigo', ultimoCodigo.slice(0, 3).toLowerCase() + ' ' + ultimoCodigo.slice(3).toLowerCase());
    await pg.click('#btnBuscarCodigo'); await pg.waitForTimeout(900); await pg.evaluate(() => cerrar('ovAviso'));
    ok('escribiendo el código en minúsculas y con espacio, carga los datos', (await pantalla(pg)) === 'scr-form' && (await pg.inputValue('#e_nombre')) === 'Prueba de Matrículas');
    await pg.evaluate(() => abrirCargarCodigo()); await pg.fill('#inputCodigo', '7777'); await pg.click('#btnBuscarCodigo'); await pg.waitForTimeout(700);
    ok('un código inexistente avisa claramente (sin error técnico)', /no existe|No existe/.test(await pg.textContent('#avisoTexto')));
    await pg.context().close();

    seccion('8) Errores del servidor y código QR');
    pg = await nuevaPagina(base + '/index.html');
    await entrarPersonal(pg);
    estado.falloInterno = true;
    await pg.click('.card-btn:nth-child(1)'); await pg.fill('#e_rut', '2179'); await pg.press('#e_rut', 'Tab'); await pg.click('#ficha button[type=submit]'); await pg.waitForTimeout(900);
    const errTexto = await pg.textContent('#avisoTexto');
    ok('un error interno del servidor NO muestra nombres de tablas ni detalles técnicos', !/relation|secreto_interno|public\./.test(errTexto) && /problema/i.test(errTexto), errTexto);
    estado.falloInterno = false;
    await pg.evaluate(() => { cerrar('ovAviso'); volverInicio(); }); await pg.click('button:has-text("Código QR para apoderados")'); await pg.waitForTimeout(600);
    ok('el código QR se dibuja (librería QRCode con la CSP activa)', (await pg.evaluate(() => document.querySelectorAll('#qrBox canvas, #qrBox img').length)) >= 1);
    ok('el enlace del QR es el del modo apoderado', (await pg.textContent('#qrUrl')).endsWith('?apoderado'));
    await pg.context().close();

    const despues = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;
    console.log(`\n(matrículas ficticias: antes ${antes}, después ${despues})`);
  } catch (e) {
    falladas++; console.log('\n✘ Error inesperado en la prueba:', e.message.split('\n')[0]); if (estado.erroresPagina.length) console.log('  Errores de JavaScript en la página:', estado.erroresPagina.slice(0, 3).join(' | '));
  } finally {
    await navegador.close(); servidor.close(); await db.cerrar();
  }
  console.log(`\nResultado: ${pasadas} comprobaciones correctas, ${falladas} fallidas`);
  process.exit(falladas ? 1 : 0);
})();
