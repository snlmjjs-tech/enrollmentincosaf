// Comprueba que la página que está publicada HOY (la versión de la rama main) sigue funcionando
// después de ejecutar el esquema SQL nuevo en modo de transición. Sirve para decidir cuándo es seguro
// ejecutar el SQL: antes de publicar la página nueva.
//
// Uso:  PGPORT=5499 PAGINA_ACTUAL=<carpeta con la versión de main> LIBS_ANTIGUAS=<carpeta> node tests/seguridad/prueba-pagina-actual.js
//   PAGINA_ACTUAL: copia de la versión publicada (git archive origin/main | tar -x -C <carpeta>)
//   LIBS_ANTIGUAS: carpeta con supabase.js, jspdf.umd.min.js, xlsx.full.min.js y qrcode.js de las versiones antiguas
const http = require('http'), fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');
const { crearRpc } = require('./rpc-local');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const RAIZ = path.resolve(__dirname, '../..');
const ACTUAL = process.env.PAGINA_ACTUAL, LIBS = process.env.LIBS_ANTIGUAS, PUERTO_PG = +(process.env.PGPORT || 5499);
const db = crearRpc({ host: '127.0.0.1', port: PUERTO_PG, user: 'postgres', database: 'postgres' });
let pasadas = 0, falladas = 0;
const ok = (n, c, d) => { if (c) { pasadas++; console.log(`  ✔ ${n}`); } else { falladas++; console.log(`  ✘ ${n}${d ? '  → ' + d : ''}`); } };

(async () => {
  // La base ya tiene el esquema nuevo Y la migración de matrícula múltiple; la página publicada hoy debe seguir funcionando
  for (const sql of ['supabase/schema.sql', 'supabase/migraciones/002_matricula_multiple.sql']) {
    execFileSync('psql', ['-h', '127.0.0.1', '-p', String(PUERTO_PG), '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', path.join(RAIZ, sql)], { stdio: 'ignore' });
  }
  const modo = (await db.admin('select modo_transicion from public.config where id')).rows[0].modo_transicion;
  ok('el esquema nuevo está en modo de transición (como queda al actualizar producción)', modo === true);
  const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
  const srv = http.createServer((q, r) => { const ru = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ACTUAL, ru === '/' ? 'index.html' : ru);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(r); }).listen(0, '127.0.0.1');
  await new Promise(r => srv.on('listening', r)); const base = `http://127.0.0.1:${srv.address().port}`;
  const nav = await chromium.launch(); const correos = [];
  async function pagina(url) {
    const pg = await (await nav.newContext({ viewport: { width: 1100, height: 900 } })).newPage(); pg.errores = [];
    pg.on('pageerror', e => pg.errores.push(String(e)));
    await pg.route(/cdn\.jsdelivr\.net.*supabase/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(LIBS, 'supabase.js')) }));
    await pg.route(/cdnjs.*xlsx/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(LIBS, 'xlsx.full.min.js')) }));
    await pg.route(/cdnjs.*qrcode/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(LIBS, 'qrcode.js')) }));
    await pg.route(/cdnjs.*jspdf/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(LIBS, 'jspdf.umd.min.js')) }));
    await pg.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    await pg.route('https://mtlunrefaxsagfkphvvw.supabase.co/**', async ruta => {
      const req = ruta.request(); const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (req.method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: cors });
      const m = /\/rpc\/([a-z_]+)$/.exec(new URL(req.url()).pathname);
      try { const d = await db.rpc(m[1], req.postDataJSON() || {}, { ip: '203.0.113.7' }); ruta.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(d === undefined ? null : d) }); }
      catch (e) { ruta.fulfill({ status: 400, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: e.message }) }); }
    });
    await pg.route('https://script.google.com/**', ruta => { const c = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }; if (ruta.request().method() === 'OPTIONS') return ruta.fulfill({ status: 204, headers: c }); correos.push(ruta.request().postDataJSON()); ruta.fulfill({ status: 200, headers: { ...c, 'content-type': 'application/json' }, body: '{"ok":true}' }); });
    await pg.goto(url); await pg.waitForTimeout(800); return pg;
  };
  const pant = pg => pg.evaluate(() => document.querySelector('.screen.active')?.id);
  try {
    console.log('\nLa página PUBLICADA HOY, con el esquema nuevo en modo de transición:');
    let pg = await pagina(base + '/index.html');
    ok('la página actual abre', !!(await pant(pg)));
    const antes = (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n;
    await pg.fill('#inputClaveInterna', 'clave-funcionarios-ficticia').catch(() => {});
    await pg.press('#inputClaveInterna', 'Enter').catch(() => {}); await pg.waitForTimeout(700);
    ok('entra con la clave de funcionarios', (await pant(pg)) === 'scr-home', await pant(pg));
    await pg.click('.card-btn:nth-child(1)'); await pg.fill('#e_rut', '2179'); await pg.press('#e_rut', 'Tab'); await pg.fill('#a_mail', 'a@example.com');
    await pg.click('#ficha button[type=submit]'); await pg.waitForTimeout(900);
    ok('obtiene el folio y genera los documentos', (await pant(pg)) === 'scr-memos');
    await pg.evaluate(() => { window.print = () => {}; imprimirMemos(); }); await pg.waitForTimeout(700); await pg.click('#btnFinalizar'); await pg.waitForTimeout(1800);
    ok('guarda la matrícula', (await pant(pg)) === 'scr-done' && (await db.admin('select count(*)::int n from public.matriculas')).rows[0].n === antes + 1);
    ok('envía el correo con el formato que espera el script de Google actual', correos.length === 1 && 'secreto' in correos[0] && correos[0].body && correos[0].subject);
    await pg.evaluate(() => volverInicio()); await pg.click('.admin-link'); await pg.fill('#inputClave', 'clave-encargados-ficticia'); await pg.click('#ovClave .btn-pri'); await pg.waitForTimeout(900);
    ok('abre el panel con la clave de encargados y lista las matrículas', (await pant(pg)) === 'scr-admin' && (await pg.evaluate(() => document.querySelectorAll('#tbodyAdmin tr').length)) >= 1);
    await pg.click('#tbodyAdmin tr:first-child .btn-del[title^="Editar"]'); await pg.waitForTimeout(500);
    ok('el panel permite editar una matrícula', (await pant(pg)) === 'scr-form');
    ok('sin errores de JavaScript', pg.errores.length === 0, pg.errores.join('|'));
    // apoderado
    const ap = await pagina(base + '/index.html?apoderado');
    await ap.click('.card-btn:nth-child(1)'); await ap.fill('#e_rut', '2179'); await ap.press('#e_rut', 'Tab'); await ap.click('#ficha button[type=submit]'); await ap.waitForTimeout(900);
    const codigo = (await ap.textContent('#codigoGrande')).trim();
    ok('el apoderado envía su pre-matrícula y recibe un código de 4 dígitos (el único que la página actual sabe leer)', (await pant(ap)) === 'scr-codigo' && /^[0-9]{4}$/.test(codigo), codigo);
    // el funcionario carga ese código con la página actual
    const st = await pagina(base + '/index.html'); await st.fill('#inputClaveInterna', 'clave-funcionarios-ficticia'); await st.press('#inputClaveInterna', 'Enter'); await st.waitForTimeout(700);
    await st.evaluate(() => abrirCargarCodigo()); await st.fill('#inputCodigo', codigo); await st.click('#btnBuscarCodigo'); await st.waitForTimeout(900);
    ok('el funcionario carga la pre-matrícula con la página actual', (await pant(st)) === 'scr-form' && (await st.inputValue('#e_nombre')) === 'Prueba de Matrículas');
  } catch (e) { falladas++; console.log('\n✘ Error inesperado:', e.message.split('\n')[0]); }
  finally { await nav.close(); srv.close(); await db.cerrar(); }
  console.log(`\nResultado: ${pasadas} comprobaciones correctas, ${falladas} fallidas`); process.exit(falladas ? 1 : 0);
})();
