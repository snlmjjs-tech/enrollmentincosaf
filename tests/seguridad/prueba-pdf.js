// Prueba de los certificados PDF (jsPDF 4.2.1): tamaño con y sin compresión, límites, contenido, imágenes y aspecto.
// Genera los PDF en un navegador (Chromium) con la página real. No usa servicios reales.
// Uso: node tests/seguridad/prueba-pdf.js      (usa pdftotext/pdfinfo/pdfimages/pdftoppm de poppler si están instalados)
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const RAIZ = path.resolve(__dirname, '../..');
let P = 0, F = 0; const ok = (n, c, d) => { if (c) { P++; console.log(`  ✔ ${n}`); } else { F++; console.log(`  ✘ ${n}${d ? '  → ' + d : ''}`); } };
const hay = c => { try { execFileSync(c, ['-v'], { stdio: 'ignore' }); return true; } catch (e) { return e.status !== undefined && e.code !== 'ENOENT'; } };
const POPPLER = hay('pdftotext') && hay('pdfinfo') && hay('pdfimages') && hay('pdftoppm');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'incosaf-pdf-'));
const tipos = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const MAX_PDF = 250000, MAX_TOTAL = 1000000;

const ficha = (folio, nombre, o = {}) => ({ tipo: o.tipo || 'nuevo', folio: String(folio), fechaRegistro: '23-10-2026, 12:44:56',
  estudiante: { nombre, rut: '11.111.111-1', procedencia: o.procedencia || 'Colegio TEST', cursoMatricula: o.curso || '', ...(o.estudiante || {}) },
  apoderado: { nombre: o.apoderado || 'Apoderado TEST', rut: '22.222.222-2' } });
const guardar = (nombre, b64) => { const f = path.join(tmp, nombre); fs.writeFileSync(f, Buffer.from(b64, 'base64')); return f; };
const texto = f => execFileSync('pdftotext', ['-layout', f, '-']).toString();

(async () => {
  const srv = await new Promise(r => { const s = http.createServer((q, res) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(RAIZ, u === '/' ? 'index.html' : u);
    if (!f.startsWith(RAIZ) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': tipos[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(res); }).listen(0, '127.0.0.1', () => r(s)); });
  const nav = await chromium.launch(); const pg = await nav.newPage();
  await pg.route(/fonts\.|supabase\.co|script\.google/, r => r.abort());
  await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html`); await pg.waitForTimeout(1000);

  const generar = (fichas, comprimir) => pg.evaluate(([fs2, comp]) => {
    const J = window.jspdf.jsPDF; const orig = window.__J || (window.__J = J);
    window.jspdf.jsPDF = function (o) { return new orig({ ...o, compress: comp }); }; Object.assign(window.jspdf.jsPDF, orig); window.jspdf.jsPDF.prototype = orig.prototype;
    try { return fs2.map(f => generarComprobantePDFBase64(f)); } finally { window.jspdf.jsPDF = orig; }
  }, [fichas, comprimir]);

  console.log('\n1) Tamaño: sin compresión (el problema) y con compresión (la corrección)');
  const f1 = ficha(123, 'Estudiante TEST Uno');
  const [sin] = await generar([f1], false); const [con] = await generar([f1], true);
  const [real] = await pg.evaluate(f => [generarComprobantePDFBase64(f)], f1);
  ok(`sin compresión (jsPDF 4.2.1): ${sin.length} caracteres Base64 → deja poco margen sobre el tope anterior de 400 000`, sin.length > 300000, String(sin.length));
  ok(`con compresión: ${con.length} caracteres (${Math.round(con.length / sin.length * 100)} % del tamaño sin comprimir)`, con.length < 130000 && con.length < sin.length / 2, String(con.length));
  ok('la página usa la compresión: el certificado real mide lo mismo que el comprimido', Math.abs(real.length - con.length) < 2000, `${real.length} vs ${con.length}`);
  ok(`un certificado cabe con holgura en el límite por PDF (${MAX_PDF}): al menos el doble de margen`, real.length * 2 < MAX_PDF, String(real.length));

  console.log('\n2) Varios certificados en una misma solicitud');
  const cinco = Array.from({ length: 5 }, (_, i) => ficha(200 + i, `Estudiante TEST ${i + 1}`, { tipo: i % 2 ? 'nuevo' : 'antiguo', curso: '2° Medio A' }));
  const b5 = await pg.evaluate(fs2 => fs2.map(f => generarComprobantePDFBase64(f)), cinco);
  const total5 = b5.reduce((a, b) => a + b.length, 0);
  ok(`5 certificados suman ${total5} caracteres: dentro del total permitido (${MAX_TOTAL}) con ≥ 1,5 veces de margen`, total5 * 1.5 < MAX_TOTAL, String(total5));
  ok('cada uno de los 5 está dentro del límite por PDF', b5.every(b => b.length < MAX_PDF));
  ok('todos empiezan con %PDF (JVBER en Base64) y terminan con %%EOF', b5.every(b => b.startsWith('JVBER') && Buffer.from(b, 'base64').slice(-1024).toString('latin1').includes('%%EOF')));
  ok('el nombre del archivo de cada uno lleva su folio (lo arma el servidor; el PDF es independiente)', new Set(b5).size === 5, 'los 5 PDF deben ser distintos entre sí');

  console.log('\n3) Casos extremos de tamaño');
  const largo = 'Ñandú '.repeat(35).trim();              // 209 caracteres con tildes y ñ
  const [extremo] = await pg.evaluate(f => [generarComprobantePDFBase64(f)], ficha(999999999, largo, { procedencia: 'Colegio '.repeat(25).trim(), apoderado: 'Apoderado '.repeat(20).trim(), curso: '4° Medio C' }));
  ok(`con nombres de 200+ caracteres el PDF sigue por debajo del límite (${extremo.length} < ${MAX_PDF})`, extremo.length < MAX_PDF);
  const [cero] = await pg.evaluate(f => [generarComprobantePDFBase64(f)], ficha(1, 'A', { procedencia: '' }));
  ok('con datos mínimos el certificado también se genera', cero.startsWith('JVBER'));

  if (!POPPLER) { console.log('\n(Omitido: poppler no está instalado; contenido, imágenes y aspecto de los PDF quedan pendientes de revisión manual)'); }
  else {
    console.log('\n4) Contenido, imágenes y aspecto');
    const fSin = guardar('sin.pdf', sin), fCon = guardar('con.pdf', con);
    const info = execFileSync('pdfinfo', [fCon]).toString();
    ok('es un PDF de 1 página tamaño carta', /Pages:\s+1/.test(info) && /Page size:\s+612 x 792/.test(info), info.replace(/\n/g, ' | ').slice(0, 200));
    const t = texto(fCon);
    ok('el texto se puede leer (extraído): colegio, título, nombre, RUT, apoderado, folio y leyenda', ['Instituto Comercial Alberto Valenzuela Llanos', 'CERTIFICADO DE MATRÍCULA', 'Estudiante TEST Uno', '11.111.111-1', 'Apoderado TEST', 'Ficha de matrícula: 123', 'acredita el registro'].every(x => t.includes(x)), t.replace(/\s+/g, ' ').slice(0, 200));
    ok('el texto del PDF comprimido es idéntico al del no comprimido', t === texto(fSin));
    const imgs = execFileSync('pdfimages', ['-list', fCon]).toString().trim().split('\n').slice(2);
    ok('lleva 1 imagen (el logo institucional)', imgs.length === 1, imgs.join(' | '));
    const png = (f, base) => { execFileSync('pdftoppm', ['-png', '-r', '70', '-singlefile', f, path.join(tmp, base)]); return path.join(tmp, base + '.png'); };
    const pCon = png(fCon, 'con'), pSin = png(fSin, 'sin');
    ok('la compresión NO cambia nada de lo que se ve: las dos imágenes renderizadas son idénticas byte a byte', fs.readFileSync(pCon).equals(fs.readFileSync(pSin)));
    ok('la página renderizada no está en blanco (tiene logo y texto)', fs.statSync(pCon).size > 8000, String(fs.statSync(pCon).size));
    if (process.env.CAPTURAS) { fs.mkdirSync(process.env.CAPTURAS, { recursive: true }); fs.copyFileSync(png(fCon, 'cert'), path.join(process.env.CAPTURAS, 'certificado.png')); }
    const tx = texto(guardar('extremo.pdf', extremo));
    ok('con nombres larguísimos el texto se ajusta y NO se corta: aparece el nombre completo (209 caracteres)', tx.replace(/\s+/g, ' ').includes(largo), tx.replace(/\s+/g, ' ').slice(0, 260));
    const t5 = b5.map((b, i) => texto(guardar(`c${i}.pdf`, b)));
    ok('cada certificado contiene SOLO a su estudiante y su folio (no mezcla hermanos)', t5.every((x, i) => x.includes(`Estudiante TEST ${i + 1}`) && x.includes(`Ficha de matrícula: ${200 + i}`) && t5.every((_, j) => j === i || !x.includes(`Estudiante TEST ${j + 1}`))));
    ok('el certificado de un estudiante antiguo dice «en el curso …» y el de uno nuevo «proveniente del establecimiento …»', /en el curso 2° Medio A/.test(t5[0].replace(/\s+/g, ' ')) && /proveniente del establecimiento Colegio TEST/.test(t5[1].replace(/\s+/g, ' ')));
    const [conCurso] = await pg.evaluate(f => [generarComprobantePDFBase64(f)], ficha(55, 'Nueva TEST', { curso: '2° Medio' }));
    ok('un estudiante nuevo con curso indicado lo muestra («para cursar 2° Medio»)', /para cursar 2° Medio/.test(texto(guardar('nc.pdf', conCurso)).replace(/\s+/g, ' ')));
  }

  console.log('\n5) Descarga manual de los certificados desde la consola (procedimiento de la guía)');
  const dl = pg.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  await pg.evaluate(f => { const a = document.createElement('a'); a.href = 'data:application/pdf;base64,' + generarComprobantePDFBase64(f); a.download = 'Certificado_Ficha_' + f.folio + '.pdf'; a.click(); }, f1);
  const d = await dl;
  ok('el fragmento de la guía descarga un PDF válido con la política de seguridad activa', !!d && /Certificado_Ficha_123\.pdf/.test(d.suggestedFilename()) && fs.readFileSync(await d.path()).slice(0, 5).toString() === '%PDF-');

  await nav.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nResultado: ${P} comprobaciones correctas, ${F} fallidas`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('Error inesperado:', e); process.exit(2); });
