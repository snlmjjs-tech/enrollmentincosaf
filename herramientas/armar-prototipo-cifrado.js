// Arma el prototipo de cifrado como UN SOLO archivo .html (todo adentro), para probarlo con doble clic en el computador.
// No toca ninguna página publicada. La política de seguridad del archivo lista el «hash» de cada bloque de código,
// así que sigue sin poder cargar nada de afuera ni enviar datos a internet (connect-src 'none').
// Uso: node herramientas/armar-prototipo-cifrado.js <archivo-de-salida.html>
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const RAIZ = path.resolve(__dirname, '..'), P = path.join(RAIZ, 'prototipo-cifrado');
const salida = process.argv[2];
if (!salida) { console.error('Indica el archivo de salida, por ejemplo: node herramientas/armar-prototipo-cifrado.js /tmp/prototipo.html'); process.exit(1); }
const leer = f => fs.readFileSync(f, 'utf8');
const hash = t => "'sha256-" + crypto.createHash('sha256').update(t, 'utf8').digest('base64') + "'";
const sinCierre = t => t.replace(/<\/(script|style)/gi, '<\\/$1');

let html = leer(path.join(P, 'index.html'));
const css = sinCierre(leer(path.join(P, 'estilo.css')));
const scripts = [['<script src="../vendor/xlsx-0.18.5.full.min.js"></script>', path.join(RAIZ, 'vendor/xlsx-0.18.5.full.min.js')],
                 ['<script src="../js/cifrado.js"></script>', path.join(RAIZ, 'js/cifrado.js')], ['<script src="app.js"></script>', path.join(P, 'app.js')]];
const hashesJs = [];
for (const [etiqueta, archivo] of scripts) {
  if (!html.includes(etiqueta)) throw new Error('No encuentro ' + etiqueta);
  const codigo = sinCierre(leer(archivo)); hashesJs.push(hash(codigo));
  html = html.replace(etiqueta, () => `<script>${codigo}</script>`);
}
const etiquetaCss = '<link rel="stylesheet" href="estilo.css">';
if (!html.includes(etiquetaCss)) throw new Error('No encuentro la hoja de estilo');
html = html.replace(etiquetaCss, () => `<style>${css}</style>`);
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/,
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${hashesJs.join(' ')}; style-src ${hash(css)}; img-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'">`);
fs.writeFileSync(salida, html);
console.log(`Listo: ${salida} (${(html.length / 1024).toFixed(0)} KB). Ábrelo con doble clic en Chrome o Edge.`);
