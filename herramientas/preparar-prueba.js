#!/usr/bin/env node
// Genera una COPIA LOCAL de la página conectada exclusivamente a TU proyecto de Supabase de PRUEBAS.
// No modifica ningún archivo del repositorio: escribe en la carpeta .prueba-local/ (ignorada por git).
//
// Uso (sin claves secretas; la clave «publishable» es pública por diseño):
//   node herramientas/preparar-prueba.js --supabase-url https://<id-de-pruebas>.supabase.co --supabase-key sb_publishable_xxx \
//        [--apps-script-url https://script.google.com/macros/s/<id>/exec] [--salida .prueba-local]
// o con variables de entorno: PRUEBA_SUPABASE_URL, PRUEBA_SUPABASE_KEY, PRUEBA_APPS_SCRIPT_URL
//
// Protecciones: se niega a continuar si la dirección es la de producción, si la clave parece secreta (sb_secret_… o JWT de
// service_role), si la dirección del Apps Script es la de producción, o si el resultado todavía contiene algo de producción.
const fs = require('fs'), path = require('path');
const { REF_PRODUCCION, esProduccion, exigirProyectoDePrueba } = require('../tests/seguridad/guardia-entorno');

const RAIZ = path.resolve(__dirname, '..');
function argumento(nombre, entorno) {
  const i = process.argv.indexOf('--' + nombre);
  return (i > -1 && process.argv[i + 1]) || process.env[entorno] || '';
}
function parar(msg) { console.error('\nNO SE GENERÓ NADA: ' + msg + '\n'); process.exit(1); }

const url = argumento('supabase-url', 'PRUEBA_SUPABASE_URL').replace(/\/$/, '');
const clave = argumento('supabase-key', 'PRUEBA_SUPABASE_KEY');
const appsScript = argumento('apps-script-url', 'PRUEBA_APPS_SCRIPT_URL');
const salida = path.resolve(RAIZ, argumento('salida', 'PRUEBA_SALIDA') || '.prueba-local');

if (!url || !clave) parar('faltan --supabase-url y --supabase-key (o PRUEBA_SUPABASE_URL y PRUEBA_SUPABASE_KEY).');
let ref;
try { ref = exigirProyectoDePrueba(url); } catch (e) { parar(e.message); }

// La clave debe ser la PÚBLICA. Se rechazan las secretas.
if (/^sb_secret_/i.test(clave)) parar('esa es una clave SECRETA de Supabase. Usa la clave pública «publishable» (Project Settings → API Keys). Nunca pegues una clave secreta en la página.');
if (/^eyJ/.test(clave)) {
  try {
    const rol = JSON.parse(Buffer.from(clave.split('.')[1], 'base64url').toString()).role;
    if (rol !== 'anon') parar(`esa clave tiene el rol «${rol}» y NO es pública. Usa la clave «publishable» o la «anon».`);
  } catch (e) { parar('la clave no tiene un formato reconocible.'); }
} else if (!/^sb_publishable_[A-Za-z0-9_-]{10,}$/.test(clave)) {
  parar('la clave no parece una clave pública de Supabase (debe empezar con sb_publishable_).');
}
if (esProduccion(clave)) parar('la clave contiene el identificador de producción.');

let urlScript = '';
if (appsScript) {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(appsScript)) parar('la dirección del Apps Script debe ser https://script.google.com/macros/s/<id>/exec');
  const appProd = fs.readFileSync(path.join(RAIZ, 'js/app.js'), 'utf8').match(/const APPS_SCRIPT_URL = "([^"]+)"/);
  if (appProd && appProd[1] === appsScript) parar('esa es la dirección del Apps Script de PRODUCCIÓN. Usa el Apps Script de pruebas.');
  urlScript = appsScript;
}

// ---- Copia ----
fs.rmSync(salida, { recursive: true, force: true });
fs.mkdirSync(salida, { recursive: true });
const copiar = (de, a) => { fs.mkdirSync(path.dirname(a), { recursive: true }); fs.copyFileSync(de, a); };
const recorrer = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? recorrer(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const carpeta of ['css', 'js', 'assets', 'vendor']) for (const f of recorrer(path.join(RAIZ, carpeta))) copiar(f, path.join(salida, path.relative(RAIZ, f)));
// (no se copian CNAME, nomina2026.json ni nada con datos reales)

let app = fs.readFileSync(path.join(salida, 'js/app.js'), 'utf8');
const cambios = [
  [/const SUPABASE_URL = "[^"]*";/, `const SUPABASE_URL = "${url}";`],
  [/const SUPABASE_ANON_KEY = "[^"]*";[^\n]*/, `const SUPABASE_ANON_KEY = "${clave}"; // clave PÚBLICA del proyecto de PRUEBAS`],
  [/const APPS_SCRIPT_URL = "[^"]*";/, `const APPS_SCRIPT_URL = "${urlScript || 'PEGA_AQUI_LA_URL_DEL_APPS_SCRIPT_DE_PRUEBAS'}";`]
];
for (const [re, nuevo] of cambios) { if (!re.test(app)) parar('no se encontró una constante esperada en js/app.js (¿cambió el archivo?).'); app = app.replace(re, () => nuevo); }
fs.writeFileSync(path.join(salida, 'js/app.js'), app);

let html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
html = html.split(`https://${REF_PRODUCCION}.supabase.co`).join(url);
html = html.replace('<title>', '<title>[PRUEBAS] ');
html = html.replace(/<body([^>]*)>/, (m) => `${m}\n<div style="position:sticky;top:0;z-index:9999;background:#c8261c;color:#fff;text-align:center;padding:6px 10px;font:600 13px system-ui">ENTORNO DE PRUEBAS · proyecto ${ref} · datos ficticios (TEST) — no es el sistema real</div>`);
fs.writeFileSync(path.join(salida, 'index.html'), html);

// ---- Verificación final: no puede quedar nada de producción ----
const culpables = recorrer(salida).filter(f => /\.(html|js|css|json|md)$/.test(f) && !f.includes(`${path.sep}vendor${path.sep}`) && esProduccion(fs.readFileSync(f, 'utf8')));
if (culpables.length) { fs.rmSync(salida, { recursive: true, force: true }); parar('quedaron referencias a producción en: ' + culpables.map(f => path.relative(salida, f)).join(', ') + '. Se borró la carpeta generada.'); }
const prodApps = (fs.readFileSync(path.join(RAIZ, 'js/app.js'), 'utf8').match(/const APPS_SCRIPT_URL = "([^"]+)"/) || [])[1];
if (prodApps && fs.readFileSync(path.join(salida, 'js/app.js'), 'utf8').includes(prodApps)) { fs.rmSync(salida, { recursive: true, force: true }); parar('quedó la dirección del Apps Script de producción. Se borró la carpeta generada.'); }

console.log(`\nListo. Página de PRUEBAS generada en: ${path.relative(process.cwd(), salida) || salida}`);
console.log(`  · Supabase de pruebas: ${url}`);
console.log(`  · Apps Script: ${urlScript || '(sin configurar: el correo no se enviará hasta que lo indiques)'}`);
console.log('Para verla:  cd ' + path.relative(process.cwd(), salida) + ' && python3 -m http.server 8080   y abre http://localhost:8080');
console.log('Para el modo apoderado:  http://localhost:8080/?apoderado\n');
