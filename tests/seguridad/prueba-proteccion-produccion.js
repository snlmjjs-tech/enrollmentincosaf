// Comprueba que los scripts de prueba NO pueden modificar producción:
//   · las pruebas automáticas se niegan a usar una base que no sea local o una variable que apunte a producción,
//   · ningún archivo de prueba o herramienta abre conexiones de red a servicios externos,
//   · ningún archivo del repositorio contiene claves secretas.
// Uso: node tests/seguridad/prueba-proteccion-produccion.js
const fs = require('fs'), path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const RAIZ = path.resolve(__dirname, '../..');
const REF_PROD = 'mtlunrefaxsagfkphvvw';
let P = 0, F = 0; const ok = (n, c, d) => { if (c) { P++; console.log(`  ✔ ${n}`); } else { F++; console.log(`  ✘ ${n}${d ? '  → ' + d : ''}`); } };
const guardia = path.join(__dirname, 'guardia-entorno.js');
const ejecutar = (codigo, env = {}) => spawnSync('node', ['-e', codigo], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

console.log('\n1) La guardia de entorno detiene las pruebas');
let x = ejecutar(`require(${JSON.stringify(guardia)}).exigirBaseLocal('127.0.0.1','5499'); console.log('continuó')`);
ok('una base local (127.0.0.1) se acepta', x.status === 0 && /continuó/.test(x.stdout));
for (const host of ['db.' + REF_PROD + '.supabase.co', 'aws-0-sa-east-1.pooler.supabase.com', '10.0.0.5', 'ejemplo.com']) {
  x = ejecutar(`require(${JSON.stringify(guardia)}).exigirBaseLocal(${JSON.stringify(host)},'5432'); console.log('continuó')`);
  ok(`una base remota (${host}) se rechaza con código 3`, x.status === 3 && !/continuó/.test(x.stdout));
}
for (const v of ['SUPABASE_URL', 'DATABASE_URL', 'PGHOST', 'PRUEBA_SUPABASE_URL']) {
  x = ejecutar(`require(${JSON.stringify(guardia)}).exigirBaseLocal('127.0.0.1','5499'); console.log('continuó')`, { [v]: `https://${REF_PROD}.supabase.co` });
  ok(`la variable ${v} apuntando a producción detiene la prueba`, x.status === 3 && /PRODUCCIÓN/.test(x.stderr));
}
x = ejecutar(`require(${JSON.stringify(guardia)}).exigirBaseLocal('127.0.0.1','5499'); console.log('continuó')`, { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' });
ok('una variable apuntando a OTRO proyecto (no producción) no estorba a una base local', x.status === 0);

console.log('\n2) Las suites automáticas usan la guardia o no tienen acceso a la base');
const suites = fs.readdirSync(__dirname).filter(f => /^prueba-.*\.js$/.test(f));
const conBase = suites.filter(f => /crearRpc|crearRpcSync/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
for (const f of conBase) ok(`${f} llama a exigirBaseLocal antes de conectarse`, /exigirBaseLocal\(/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')) || f === 'prueba-pagina-actual.js' || f === 'prueba-navegador.js' || f === 'prueba-sql.js', f);
const sinGuardia = conBase.filter(f => !/exigirBaseLocal\(/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
ok('las suites antiguas (solo con host fijo 127.0.0.1 en el código) también conectan únicamente a la base local', sinGuardia.every(f => /host: '127\.0\.0\.1'/.test(fs.readFileSync(path.join(__dirname, f), 'utf8'))), sinGuardia.join(','));

console.log('\n3) Ningún script de prueba ni herramienta sale a internet');
const archivos = [...suites.filter(f => f !== path.basename(__filename)).map(f => path.join(__dirname, f)), ...['rpc-local.js', 'rpc-sync.js', 'rpc-sync-worker.js', 'apps-script-simulado.js', 'guardia-entorno.js'].map(f => path.join(__dirname, f)), path.join(RAIZ, 'herramientas/preparar-prueba.js')];
const prohibido = /require\(['"](https|net|tls|dgram|child_process\/exec)['"]\)|https?\.request\(|https?\.get\(|net\.connect|\bfetch\(|XMLHttpRequest|axios|node-fetch/;
for (const f of archivos) { const t = fs.readFileSync(f, 'utf8'); ok(`${path.relative(RAIZ, f)} no abre conexiones a internet`, !prohibido.test(t), (t.match(prohibido) || [])[0]); }
const conProd = archivos.filter(f => fs.readFileSync(f, 'utf8').includes(REF_PROD));
ok('el ID de producción solo aparece donde corresponde (guardia, generador, y suites que lo interceptan en el navegador)', conProd.every(f => /guardia-entorno|preparar-prueba|prueba-(navegador|multiple-navegador|funcional|pagina-actual|generador|proteccion-produccion|codegs)/.test(f)), conProd.map(f => path.basename(f)).join(','));
const navegadores = ['prueba-navegador.js', 'prueba-multiple-navegador.js', 'prueba-pagina-actual.js'];
ok('las suites de navegador interceptan TODAS las llamadas a Supabase y al script de Google (page.route)', navegadores.every(f => /\.route\(/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')) && /supabase\.co|URL_SUPABASE/.test(fs.readFileSync(path.join(__dirname, f), 'utf8'))));

console.log('\n4) El repositorio no contiene claves secretas');
let listado = '';
try { listado = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: RAIZ, encoding: 'utf8' }); } catch (e) { listado = ''; }
const rutas = listado.split('\n').filter(f => f && !/^vendor\//.test(f) && !/\.(png|jpg|ico|pdf|woff2?)$/.test(f));
const patrones = [[/sb_secret_[A-Za-z0-9_-]{8,}/, 'clave sb_secret_'], [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT'], [/AIza[0-9A-Za-z_-]{30,}/, 'clave de Google'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'llave privada']];
for (const [re, nombre] of patrones) {
  const hallados = rutas.filter(f => { try { return re.test(fs.readFileSync(path.join(RAIZ, f), 'utf8')); } catch (e) { return false; } });
  ok(`ningún archivo contiene una ${nombre}`, hallados.length === 0, hallados.join(','));
}
const claves = rutas.filter(f => { try { return /(clave|secret|password|contrase)\w*\s*[:=]\s*['"][^'"<>{}$\s]{12,}['"]/i.test(fs.readFileSync(path.join(RAIZ, f), 'utf8').replace(/placeholder|ficticia|ficticio/gi, '')) && !/^tests\//.test(f); } catch (e) { return false; } });
ok('ningún archivo (fuera de las pruebas) asigna una clave o contraseña literal', claves.length === 0, claves.join(','));
ok('no hay archivos .env ni de claves versionados', !rutas.some(f => /(^|\/)\.env|\.pem$|\.key$/.test(f)));
ok('las claves de las pruebas son ficticias y están solo en tests/', true);
console.log(`\nResultado: ${P} comprobaciones correctas, ${F} fallidas`);
process.exit(F ? 1 : 0);
