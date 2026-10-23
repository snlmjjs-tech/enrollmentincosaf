// Prueba de herramientas/preparar-prueba.js: la copia de PRUEBAS queda conectada solo al proyecto de pruebas y la herramienta
// se niega a generar nada si algo apunta a producción o si la clave parece secreta. No usa servicios reales.
// Uso: node tests/seguridad/prueba-generador.js
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const RAIZ = path.resolve(__dirname, '../..');
const HERR = path.join(RAIZ, 'herramientas/preparar-prueba.js');
const REF_PROD = 'mtlunrefaxsagfkphvvw';
let P = 0, F = 0; const ok = (n, c, d) => { if (c) { P++; console.log(`  ✔ ${n}`); } else { F++; console.log(`  ✘ ${n}${d ? '  → ' + d : ''}`); } };

const URL_PRUEBA = 'https://abcdefghijklmnopqrst.supabase.co';
const CLAVE_PRUEBA = 'sb_publishable_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
const APPS_PRUEBA = 'https://script.google.com/macros/s/' + 'AKfycbzPRUEBAFICTICIA0123456789abcdef' + '/exec';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = rol => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: rol, ref: 'abcdefghijklmnopqrst' })}.firmaFicticia`;
const hash = f => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const antes = ['js/app.js', 'index.html', 'css/styles.css', 'apps-script/Code.gs'].map(f => [f, hash(path.join(RAIZ, f))]);

function correr(args, extraEnv = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'incosaf-gen-'));
  const salida = path.join(out, 'salida');
  const r = spawnSync('node', [HERR, ...args, '--salida', salida], { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  return { ...r, salida, limpiar: () => fs.rmSync(out, { recursive: true, force: true }) };
}
const leer = (r, f) => fs.readFileSync(path.join(r.salida, f), 'utf8');

console.log('\n1) Generación correcta con un proyecto de pruebas');
let r = correr(['--supabase-url', URL_PRUEBA, '--supabase-key', CLAVE_PRUEBA, '--apps-script-url', APPS_PRUEBA]);
ok('termina bien y crea la carpeta de pruebas', r.status === 0 && fs.existsSync(r.salida), (r.stderr || '').slice(0, 200));
const app = r.status === 0 ? leer(r, 'js/app.js') : '', html = r.status === 0 ? leer(r, 'index.html') : '';
ok('js/app.js apunta a la URL y la clave de PRUEBAS', app.includes(`const SUPABASE_URL = "${URL_PRUEBA}"`) && app.includes(CLAVE_PRUEBA) && app.includes(APPS_PRUEBA));
ok('no queda NADA de producción (ni proyecto, ni clave pública real, ni Apps Script real)', !app.includes(REF_PROD) && !html.includes(REF_PROD) && !/sb_publishable_bjKNRf/.test(app) && !/AKfycbzFw8rbYDDGh9ZDQ5oC/.test(app) && !/AKfycbyuK1KURduUz0Nvrodo/.test(app));
ok('la política de seguridad (CSP) solo permite hablar con el proyecto de pruebas', html.includes(`connect-src 'self' ${URL_PRUEBA}`) && !html.includes(REF_PROD));
ok('la página muestra la franja roja «ENTORNO DE PRUEBAS» con el ID del proyecto', /ENTORNO DE PRUEBAS · proyecto abcdefghijklmnopqrst/.test(html) && /<title>\[PRUEBAS\]/.test(html));
ok('no se copian CNAME, nomina2026.json ni la carpeta de pruebas/docs', !fs.existsSync(path.join(r.salida, 'CNAME')) && !fs.existsSync(path.join(r.salida, 'nomina2026.json')) && !fs.existsSync(path.join(r.salida, 'tests')) && !fs.existsSync(path.join(r.salida, 'supabase')));
ok('las librerías, estilos e imágenes sí se copian', ['vendor/jspdf-4.2.1.umd.min.js', 'css/styles.css', 'assets/logo.png', 'js/ui.js'].every(f => fs.existsSync(path.join(r.salida, f))));
ok('el sitio generado no contiene ninguna clave secreta (sb_secret_…, JWT)', !/sb_secret_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{15,}\.eyJ/.test(app + html));
r.limpiar();
r = correr(['--supabase-url', URL_PRUEBA + '/', '--supabase-key', jwt('anon')]);
ok('acepta también la clave «anon» (JWT con rol anon) y una URL con barra final', r.status === 0); r.limpiar();
r = correr(['--supabase-url', URL_PRUEBA, '--supabase-key', CLAVE_PRUEBA]);
ok('sin Apps Script, genera igual y deja el marcador de «sin configurar» (el correo no se enviará)', r.status === 0 && leer(r, 'js/app.js').includes('PEGA_AQUI_LA_URL_DEL_APPS_SCRIPT_DE_PRUEBAS')); r.limpiar();
r = correr([], { PRUEBA_SUPABASE_URL: URL_PRUEBA, PRUEBA_SUPABASE_KEY: CLAVE_PRUEBA });
ok('también acepta los valores por variables de entorno', r.status === 0); r.limpiar();

console.log('\n2) Se niega a generar (código de salida 1, sin crear nada)');
const rechazos = [
  ['la dirección del proyecto REAL de producción', ['--supabase-url', `https://${REF_PROD}.supabase.co`, '--supabase-key', CLAVE_PRUEBA]],
  ['la dirección de producción en mayúsculas', ['--supabase-url', `https://${REF_PROD.toUpperCase()}.supabase.co`, '--supabase-key', CLAVE_PRUEBA]],
  ['una clave secreta sb_secret_', ['--supabase-url', URL_PRUEBA, '--supabase-key', 'sb_secret_' + 'x'.repeat(30)]],
  ['una clave JWT con rol service_role', ['--supabase-url', URL_PRUEBA, '--supabase-key', jwt('service_role')]],
  ['una clave que no es de Supabase', ['--supabase-url', URL_PRUEBA, '--supabase-key', 'contraseña-cualquiera-123456']],
  ['una clave que contiene el ID de producción', ['--supabase-url', URL_PRUEBA, '--supabase-key', 'sb_publishable_' + REF_PROD]],
  ['una URL sin https', ['--supabase-url', 'http://abcdefghijklmnopqrst.supabase.co', '--supabase-key', CLAVE_PRUEBA]],
  ['una URL de otro sitio que imita a Supabase', ['--supabase-url', 'https://abcdefghijklmnopqrst.supabase.co.malo.example.com', '--supabase-key', CLAVE_PRUEBA]],
  ['una URL que no es de Supabase', ['--supabase-url', 'https://ejemplo.com', '--supabase-key', CLAVE_PRUEBA]],
  ['el Apps Script de PRODUCCIÓN', ['--supabase-url', URL_PRUEBA, '--supabase-key', CLAVE_PRUEBA, '--apps-script-url', (fs.readFileSync(path.join(RAIZ, 'js/app.js'), 'utf8').match(/const APPS_SCRIPT_URL = "([^"]+)"/) || [])[1]]],
  ['una dirección de Apps Script con formato raro', ['--supabase-url', URL_PRUEBA, '--supabase-key', CLAVE_PRUEBA, '--apps-script-url', 'https://script.google.com.malo.example.com/macros/s/x/exec']],
  ['faltan los datos', []]
];
for (const [nombre, args] of rechazos) { const x = correr(args); ok(`rechaza: ${nombre}`, x.status === 1 && !fs.existsSync(x.salida) && /NO SE GENERÓ NADA/.test(x.stderr), `estado=${x.status} ${(x.stderr || '').slice(0, 120)}`); x.limpiar(); }

console.log('\n3) La herramienta no modifica el repositorio');
ok('js/app.js, index.html, css y Code.gs quedan idénticos (la copia es aparte)', antes.every(([f, h]) => hash(path.join(RAIZ, f)) === h));
ok('el .gitignore protege la carpeta de pruebas y los archivos de claves', /\.prueba-local\//.test(fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8')) && /\.env/.test(fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8')));
console.log(`\nResultado: ${P} comprobaciones correctas, ${F} fallidas`);
process.exit(F ? 1 : 0);
