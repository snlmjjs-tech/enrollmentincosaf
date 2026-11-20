// Prueba del PROTOTIPO de cifrado (prototipo-cifrado/): solo datos ficticios, sin ningún servicio real ni conexión a internet.
//  1) El módulo de cifrado (Node): correcto, seguro ante errores, manipulaciones y llaves equivocadas.
//  2) La pantalla (Chromium): llave del colegio → apoderado cifra → la base solo muestra texto ilegible → el panel descifra → Excel.
// Uso: node tests/seguridad/prueba-prototipo-cifrado.js     (necesita los paquetes npm «playwright» y «xlsx»)
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const RAIZ = path.resolve(__dirname, '../..');
let chromium; try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const XLSX = require('xlsx');
const C = require(path.join(RAIZ, 'js/cifrado.js'));

let buenas = 0, malas = 0;
const ok = (nombre, cond, detalle) => { if (cond) { buenas++; console.log('  ✔ ' + nombre); } else { malas++; console.log('  ✘ ' + nombre + (detalle ? '  → ' + detalle : '')); } };
const sec = t => console.log('\n' + t);
const falla = async (fn) => { try { await fn(); return null; } catch (e) { return e.codigo || e.message; } };
const FUERTE = 'pato-lluvia-cobre-mesa-47';
const ficha = (n = 1) => ({ estudiante: { nombre: `Ñandú Pérez Prueba ${n} 🙂`, rut: '11.111.111-1', curso: '1° Medio A', pie: 'si', pieDiagnostico: 'Diagnóstico ficticio de prueba', salud: 'Ninguna' },
                            apoderado: { nombre: `Apoderado Ficticio ${n}`, rut: '12.345.678-5', celular: '+56 9 0000 0001', correo: 'apoderado@example.invalid' } });
const voltea = b64 => { const b = Buffer.from(b64, 'base64'); b[Math.floor(b.length / 2)] ^= 1; return b.toString('base64'); };

(async () => {
  sec('1) Módulo de cifrado');
  ok('una clave de 4 dígitos (2179) se rechaza', !C.validarClave('2179').ok);
  ok('una clave larga pero solo con números se rechaza', !C.validarClave('123456789012').ok);
  ok('una clave repetitiva se rechaza', !C.validarClave('aaaaaaaaaaaa').ok);
  ok('una clave de palabras largas se acepta', C.validarClave(FUERTE).ok && !C.validarClave(FUERTE).debil);
  ok('en modo «solo para probar» se acepta 2179, marcada como débil', C.validarClave('2179', { permitirDebil: true }).ok && C.validarClave('2179', { permitirDebil: true }).debil === true);
  ok('crear la llave con una clave débil sin permiso falla', (await falla(() => C.crearLlaveColegio('2179'))) !== null);

  const { archivo, publica } = await C.crearLlaveColegio(FUERTE);
  ok('el archivo de llave dice qué es y trae la huella de 16 caracteres', archivo.tipo === 'llave-del-colegio' && /^[0-9a-f]{16}$/.test(archivo.kid) && archivo.kid === publica.kid);
  ok(`la clave se «estira» con ${C.ITERACIONES} vueltas (PBKDF2)`, archivo.privada.iteraciones === C.ITERACIONES && C.ITERACIONES >= 600000);
  ok('el archivo NO trae la llave privada en claro (no empieza como una llave DER) y no tiene campos con ese nombre', Buffer.from(archivo.privada.datos, 'base64')[0] !== 0x30 && !/private|pkcs8|clave"/i.test(Object.keys(archivo.privada).join(',')));
  const llave = await C.abrirLlave(archivo, FUERTE);
  ok('con la clave correcta se abre la llave', llave.kid === archivo.kid);
  ok('con una clave equivocada NO se abre: «clave_incorrecta»', (await falla(() => C.abrirLlave(archivo, FUERTE + 'x'))) === 'clave_incorrecta');
  ok('con la clave vacía NO se abre', (await falla(() => C.abrirLlave(archivo, ''))) === 'clave_incorrecta');
  ok('la llave privada abierta NO se puede exportar (no extraíble)', llave.privada.extractable === false && (await falla(() => crypto.subtle.exportKey('pkcs8', llave.privada))) !== null);

  const p1 = await C.cifrarFicha(ficha(1), publica, 'folio:7');
  ok('lo cifrado se abre y es idéntico a la ficha original (con tildes, ñ y emoji)', JSON.stringify(await C.descifrarFicha(p1, llave, 'folio:7')) === JSON.stringify(ficha(1)));
  const texto = JSON.stringify(p1) + Buffer.from(p1.ct, 'base64').toString('latin1') + Buffer.from(p1.ct, 'base64').toString('utf8');
  ok('lo guardado no contiene ningún dato legible (nombre, RUT, correo, diagnóstico)', ['Ñandú', 'Pérez', '11.111.111', 'example.invalid', 'Diagnóstico', 'Apoderado'].every(x => !texto.includes(x)));
  const p2 = await C.cifrarFicha(ficha(1), publica, 'folio:7');
  ok('la misma ficha cifrada dos veces da resultados distintos (no se pueden comparar)', p1.ct !== p2.ct && p1.iv !== p2.iv && p1.ck !== p2.ck);
  ok('una ficha cifrada para el folio 7 NO abre si se presenta como folio 8 (atada a su folio)', (await falla(() => C.descifrarFicha(p1, llave, 'folio:8'))) === 'no_se_puede_abrir');
  ok('cambiar un solo dato del texto cifrado hace que no abra', (await falla(() => C.descifrarFicha({ ...p1, ct: voltea(p1.ct) }, llave, 'folio:7'))) === 'no_se_puede_abrir');
  ok('cambiar el vector inicial hace que no abra', (await falla(() => C.descifrarFicha({ ...p1, iv: voltea(p1.iv) }, llave, 'folio:7'))) === 'no_se_puede_abrir');
  ok('cambiar la llave envuelta hace que no abra', (await falla(() => C.descifrarFicha({ ...p1, ck: voltea(p1.ck) }, llave, 'folio:7'))) === 'no_se_puede_abrir');
  ok('un paquete con otro algoritmo o versión no abre', (await falla(() => C.descifrarFicha({ ...p1, alg: 'otro' }, llave, 'folio:7'))) === 'no_se_puede_abrir' && (await falla(() => C.descifrarFicha({ ...p1, v: 2 }, llave, 'folio:7'))) === 'no_se_puede_abrir');
  const otro = await C.crearLlaveColegio('otra-clave-larga-distinta-91');
  const lOtro = await C.abrirLlave(otro.archivo, 'otra-clave-larga-distinta-91');
  ok('con la llave de OTRO colegio no se abre: «llave_distinta»', (await falla(() => C.descifrarFicha(p1, lOtro, 'folio:7'))) === 'llave_distinta');
  ok('un paquete con la huella cambiada se rechaza', (await falla(() => C.descifrarFicha({ ...p1, kid: otro.publica.kid }, llave, 'folio:7'))) !== null);
  ok('con una llave pública alterada no se cifra («llave_publica_no_valida»)', (await falla(() => C.cifrarFicha(ficha(), { kid: publica.kid, publica: otro.publica.publica }, 'folio:1'))) === 'llave_publica_no_valida');
  const pubKey = await crypto.subtle.importKey('spki', Buffer.from(publica.publica, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  ok('la llave PÚBLICA sola no puede descifrar nada', (await falla(() => crypto.subtle.decrypt({ name: 'RSA-OAEP' }, pubKey, Buffer.from(p1.ck, 'base64')))) !== null);
  ok('archivo con otra huella (dato autenticado) no abre', (await falla(() => C.abrirLlave({ ...archivo, kid: otro.publica.kid }, FUERTE))) === 'clave_incorrecta');
  ok('archivo con 1 vuelta de PBKDF2 se rechaza (no se aceptan archivos con protección débil)', (await falla(() => C.abrirLlave({ ...archivo, privada: { ...archivo.privada, iteraciones: 1 } }, FUERTE))) === 'archivo_no_valido');
  ok('archivo con miles de millones de vueltas se rechaza (no cuelga el navegador)', (await falla(() => C.abrirLlave({ ...archivo, privada: { ...archivo.privada, iteraciones: 5e10 } }, FUERTE))) === 'archivo_no_valido');
  ok('texto que no es JSON, o JSON de otra cosa, se rechaza', (await falla(() => C.abrirLlave('no soy json', FUERTE))) === 'archivo_no_valido' && (await falla(() => C.abrirLlave({ tipo: 'otro' }, FUERTE))) === 'archivo_no_valido' && (await falla(() => C.abrirLlave(null, FUERTE))) === 'archivo_no_valido');
  const CLAVE_B = 'segunda-clave-persona-dos-58';
  const copia = await C.copiarLlave(archivo, FUERTE, CLAVE_B);
  const lCopia = await C.abrirLlave(copia, CLAVE_B);
  ok('la copia para otra persona tiene su propia clave y abre los MISMOS datos', copia.kid === archivo.kid && JSON.stringify(await C.descifrarFicha(p1, lCopia, 'folio:7')) === JSON.stringify(ficha(1)));
  ok('la copia NO se abre con la clave de la primera persona (ni la primera con la de la segunda)', (await falla(() => C.abrirLlave(copia, FUERTE))) === 'clave_incorrecta' && (await falla(() => C.abrirLlave(archivo, CLAVE_B))) === 'clave_incorrecta');
  ok('la copia usa sal y vector nuevos (no repite los del original)', copia.privada.sal !== archivo.privada.sal && copia.privada.iv !== archivo.privada.iv && copia.privada.datos !== archivo.privada.datos);
  ok('para hacer una copia hace falta la clave actual y una clave nueva válida', (await falla(() => C.copiarLlave(archivo, 'mal', CLAVE_B))) === 'clave_incorrecta' && (await falla(() => C.copiarLlave(archivo, FUERTE, '2179'))) !== null);
  ok('esCifrado reconoce una ficha cifrada y rechaza una ficha normal', C.esCifrado(p1) && !C.esCifrado(ficha(1)) && !C.esCifrado(null) && !C.esCifrado({ ct: 'x' }));
  const t0 = Date.now(); const muchas = []; for (let i = 0; i < 40; i++) muchas.push(await C.cifrarFicha(ficha(i), publica, 'folio:' + (i + 1)));
  for (let i = 0; i < 40; i++) await C.descifrarFicha(muchas[i], llave, 'folio:' + (i + 1));
  ok(`40 fichas se cifran y descifran en un tiempo razonable (${Date.now() - t0} ms)`, Date.now() - t0 < 20000);

  sec('2) Pantalla del prototipo (Chromium, sin red)');
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  const srv = await new Promise(r => { const s = http.createServer((q, res) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(RAIZ, u === '/' ? 'prototipo-cifrado/index.html' : u); if (!f.startsWith(RAIZ)) { res.writeHead(403); return res.end(); } fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': tipos[path.extname(f)] || 'application/octet-stream' }); res.end(d); }); }); s.listen(0, '127.0.0.1', () => r(s)); });
  // Con PROTOTIPO_URL (por ejemplo file:///…/Prototipo_cifrado_INCOSAF.html) se prueba el archivo de un solo .html en vez de la carpeta
  const base = process.env.PROTOTIPO_URL || `http://127.0.0.1:${srv.address().port}/prototipo-cifrado/index.html`;
  const nav = await chromium.launch(); const ctx = await nav.newContext({ acceptDownloads: true }); const pg = await ctx.newPage();
  const externas = [], errores = [];
  pg.on('request', r => { if (!/^(http:\/\/127\.0\.0\.1|file:|data:|blob:)/.test(r.url())) externas.push(r.url()); });
  pg.on('pageerror', e => errores.push(e.message));
  await pg.goto(base); await pg.waitForTimeout(300);
  const tab = n => pg.click(`.tab[data-tab=${n}]`);
  const texto2 = () => pg.evaluate(() => document.body.innerText);
  const msg = id => pg.textContent('#' + id);
  const DATOS = ['Estudiante de Prueba', 'apoderado@example.invalid', '11.111.111-1', '12.345.678-5', '+56 9 0000 0001', 'Diagnóstico ficticio'];

  await tab('apoderado'); await pg.click('#btnEjemplo'); await pg.click('#formFicha button[type=submit]');
  ok('sin llave del colegio no se puede enviar y se explica', /Primero crea la llave/.test(await msg('msgFicha')));

  await tab('llave');
  await pg.fill('#clave1', '2179'); await pg.fill('#clave2', '2179'); await pg.click('#btnCrearLlave');
  ok('2179 se rechaza si no se marca «solo para probar»', /al menos 12/.test(await msg('msgLlave')) && (await pg.evaluate(() => localStorage.getItem('proto_cfg'))) === null);
  await pg.fill('#clave1', FUERTE); await pg.fill('#clave2', FUERTE + 'x'); await pg.click('#btnCrearLlave');
  ok('si las dos claves no coinciden, no crea la llave', /no coinciden/.test(await msg('msgLlave')));
  await pg.fill('#clave2', FUERTE); await pg.click('#btnCrearLlave'); await pg.waitForSelector('#btnDescargarLlave:not([hidden])');
  ok('con una clave fuerte se crea la llave y los campos de clave se vacían', /Llave creada/.test(await msg('msgLlave')) && (await pg.inputValue('#clave1')) === '' && (await pg.inputValue('#clave2')) === '');
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#btnDescargarLlave')]);
  const rutaLlave = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proto-')), 'llave-del-colegio.json'); await dl.saveAs(rutaLlave);
  const archivoDesc = JSON.parse(fs.readFileSync(rutaLlave, 'utf8'));
  ok('se descarga el archivo de llave con su protección', dl.suggestedFilename() === 'llave-del-colegio.json' && archivoDesc.privada.iteraciones >= 600000);
  ok('además del archivo, la pantalla muestra el TEXTO de la llave para copiarlo (por si la descarga no funciona, como en el iPad)', await pg.isVisible('#textoLlave') && JSON.stringify(JSON.parse(await pg.inputValue('#textoLlave'))) === JSON.stringify(archivoDesc));
  const pub = await pg.inputValue('#textoPublica');
  ok('se muestran los datos PÚBLICOS de la llave para pegarlos en la página real (sin ningún dato de la llave privada)', /^window\.LLAVE_PUBLICA_COLEGIO = \{"kid":"[0-9a-f]{16}","publica":"[A-Za-z0-9+\/=]+"\};$/.test(pub) && !/privada|datos|sal|iv/.test(pub.replace('publica', '').replace('LLAVE_PUBLICA_COLEGIO', '')) && pub.includes(archivoDesc.kid));
  ok('en el navegador solo queda la llave PÚBLICA: ni la clave ni la llave privada se guardan', await pg.evaluate(() => { const t = JSON.stringify(Object.assign({}, localStorage)); return !t.includes('privada') && !t.includes('pato-lluvia'); }));

  // Copia de la llave para otra persona (con su propia clave)
  const CLAVE_C = 'tercera-clave-persona-tres-33';
  await pg.fill('#copiaTexto', fs.readFileSync(rutaLlave, 'utf8')); await pg.fill('#copiaClaveActual', FUERTE + 'mal'); await pg.fill('#copiaClave1', CLAVE_C); await pg.fill('#copiaClave2', CLAVE_C); await pg.fill('#copiaNombre', 'Inspector Pérez'); await pg.click('#btnCrearCopia');
  await pg.waitForFunction(() => /no es correcta/.test(document.getElementById('msgCopia').textContent));
  ok('para crear una copia hace falta la clave actual: con una equivocada se rechaza', await pg.isHidden('#cajaCopia'));
  await pg.fill('#copiaClaveActual', FUERTE); await pg.fill('#copiaClave1', CLAVE_C); await pg.fill('#copiaClave2', CLAVE_C); await pg.click('#btnCrearCopia'); await pg.waitForSelector('#btnDescargarCopia:not([hidden])');
  const [dc] = await Promise.all([pg.waitForEvent('download'), pg.click('#btnDescargarCopia')]);
  const rutaCopia = path.join(path.dirname(rutaLlave), 'copia.json'); await dc.saveAs(rutaCopia); const copiaDesc = JSON.parse(fs.readFileSync(rutaCopia, 'utf8'));
  ok('se descarga la copia (nombre con la persona) con la MISMA llave pero otra protección', dc.suggestedFilename() === 'llave-del-colegio-inspector-p-rez.json' && copiaDesc.kid === archivoDesc.kid && copiaDesc.privada.datos !== archivoDesc.privada.datos && (await pg.inputValue('#copiaClave1')) === '');
  await pg.fill('#clave1', 'x');   // (solo para que el siguiente bloque encuentre el formulario limpio)
  await pg.fill('#clave1', '');

  await tab('apoderado');
  for (let i = 1; i <= 3; i++) { await pg.click('#btnEjemplo'); await pg.click('#formFicha button[type=submit]'); await pg.waitForSelector('#resultadoEnvio:not([hidden])'); }
  ok('se enviaron 3 matrículas ficticias (folios 1 a 3) y el formulario queda vacío', (await msg('folioEnviado')) === '3' && (await pg.inputValue('#f_nombre')) === '');
  await tab('bd');
  ok('la base muestra 3 filas', (await pg.locator('#tablaBd tbody tr').count()) === 3);
  const tBd = await texto2();
  ok('un extraño NO ve ningún dato: ni nombres, ni RUT, ni correo, ni teléfono, ni diagnóstico', DATOS.every(x => !tBd.includes(x)) && !(await pg.evaluate(() => localStorage.getItem('proto_bd'))).includes('Estudiante de Prueba'));
  await pg.fill('#buscaBd', 'Prueba');
  ok('buscar «Prueba» en la base no encuentra nada', /No se encontró/.test(await msg('resBusquedaBd')));

  await tab('panel');
  const tBloq = await texto2();
  ok('el panel empieza BLOQUEADO y no muestra ningún dato', await pg.isVisible('#bloqueado') && await pg.isHidden('#abierto') && DATOS.every(x => !tBloq.includes(x)) && tBloq.includes('bloqueado'));
  await pg.setInputFiles('#archivoLlave', rutaLlave); await pg.fill('#claveAbrir', FUERTE + 'mal'); await pg.click('#btnAbrir');
  await pg.waitForFunction(() => /incorrecta/.test(document.getElementById('msgAbrir').textContent));
  ok('con una clave equivocada NO abre y no muestra datos', await pg.isHidden('#abierto') && (await texto2()).indexOf('Estudiante de Prueba') === -1);
  const basura = path.join(path.dirname(rutaLlave), 'basura.json'); fs.writeFileSync(basura, '{"hola":1}');
  await pg.setInputFiles('#archivoLlave', basura); await pg.fill('#claveAbrir', FUERTE); await pg.click('#btnAbrir');
  await pg.waitForFunction(() => /no es una llave/.test(document.getElementById('msgAbrir').textContent));
  ok('un archivo que no es la llave se rechaza con un mensaje claro', await pg.isHidden('#abierto'));
  await pg.setInputFiles('#archivoLlave', rutaLlave); await pg.fill('#claveAbrir', FUERTE); await pg.click('#btnAbrir');
  await pg.waitForSelector('#abierto:not([hidden])');
  ok('con el archivo y la clave correctos se desbloquea y la clave se borra del campo', (await pg.inputValue('#claveAbrir')) === '');
  ok('aparecen las 3 matrículas legibles', (await pg.locator('#tablaPanel tbody tr').count()) === 3 && (await pg.textContent('#tablaPanel')).includes('Estudiante de Prueba 2') && (await pg.textContent('#tablaPanel')).includes('apoderado@example.invalid'));
  await pg.fill('#buscaPanel', 'prueba 2');
  ok('la búsqueda filtra en el navegador (1 de 3)', (await pg.locator('#tablaPanel tbody tr').count()) === 1 && /1 de 3/.test(await msg('resPanel')));
  await pg.fill('#buscaPanel', '');
  const [dx] = await Promise.all([pg.waitForEvent('download'), pg.click('#btnExcel')]);
  const rutaX = path.join(path.dirname(rutaLlave), 'matriculas.xlsx'); await dx.saveAs(rutaX);
  const filasX = XLSX.utils.sheet_to_json(XLSX.readFile(rutaX).Sheets['Matrículas']);
  ok('el Excel sale legible con las 3 matrículas y sus datos completos', filasX.length === 3 && filasX[1].Estudiante === 'Estudiante de Prueba 2' && filasX[1].RUT === '11.111.111-1' && filasX[1].Correo === 'apoderado@example.invalid' && filasX[1]['Diagnóstico PIE'] === 'Diagnóstico ficticio de prueba');
  await pg.click('#btnCopiarTabla');
  const tsv = await pg.inputValue('#textoTabla');
  ok('«Copiar tabla» arma el texto con columnas para pegar en Excel o Numbers (sin necesitar descargas)', tsv.startsWith('Folio\tEstudiante\tRUT') && tsv.includes('Estudiante de Prueba 2') && tsv.split('\n').length === 4);
  await pg.click('#btnBloquear');
  await pg.setInputFiles('#archivoLlave', rutaCopia); await pg.fill('#claveAbrir', FUERTE); await pg.click('#btnAbrir');
  await pg.waitForFunction(() => /incorrecta/.test(document.getElementById('msgAbrir').textContent));
  ok('la copia de la segunda persona NO se abre con la clave de la primera', await pg.isHidden('#abierto'));
  await pg.fill('#claveAbrir', CLAVE_C); await pg.click('#btnAbrir'); await pg.waitForSelector('#abierto:not([hidden])');
  ok('la copia de la segunda persona, con SU clave, abre los mismos datos (3 matrículas)', (await pg.locator('#tablaPanel tbody tr').count()) === 3 && (await pg.textContent('#tablaPanel')).includes('Estudiante de Prueba 2'));
  await pg.click('#btnBloquear');
  ok('al bloquear desaparecen los datos de la pantalla', await pg.isVisible('#bloqueado') && (await pg.locator('#tablaPanel tbody tr').count()) === 0 && (await texto2()).indexOf('Estudiante de Prueba 2') === -1);

  // Desbloqueo pegando el TEXTO de la llave (sin archivo)
  const textoLlave = fs.readFileSync(rutaLlave, 'utf8');
  await pg.fill('#pegarLlave', textoLlave); await pg.fill('#claveAbrir', FUERTE + 'mal'); await pg.click('#btnAbrir');
  await pg.waitForFunction(() => /incorrecta/.test(document.getElementById('msgAbrir').textContent));
  ok('pegando el texto con una clave equivocada NO abre', await pg.isHidden('#abierto'));
  await pg.fill('#pegarLlave', 'esto no es una llave'); await pg.fill('#claveAbrir', FUERTE); await pg.click('#btnAbrir');
  await pg.waitForFunction(() => /no es una llave/.test(document.getElementById('msgAbrir').textContent));
  ok('pegar un texto que no es la llave se rechaza con un mensaje claro', await pg.isHidden('#abierto'));
  await pg.fill('#pegarLlave', textoLlave); await pg.fill('#claveAbrir', FUERTE); await pg.click('#btnAbrir'); await pg.waitForSelector('#abierto:not([hidden])');
  ok('pegando el texto de la llave y su clave se desbloquea (3 matrículas) y el texto pegado se borra', (await pg.locator('#tablaPanel tbody tr').count()) === 3 && (await pg.inputValue('#pegarLlave')) === '');
  await pg.click('#btnBloquear');
  ok('al bloquear se borra también la tabla copiada', (await pg.inputValue('#textoTabla')) === '' && await pg.isHidden('#textoTabla'));

  // Manipulaciones en la base (alguien con acceso al servidor que intenta cambiar o mezclar filas)
  await pg.evaluate(() => {
    const bd = JSON.parse(localStorage.getItem('proto_bd'));
    [bd[0].cifrado, bd[2].cifrado] = [bd[2].cifrado, bd[0].cifrado];                       // cambia de lugar las fichas del folio 1 y 3
    const ct = bd[1].cifrado.ct, k = Math.floor(ct.length / 2);                            // altera un carácter de la ficha del folio 2
    bd[1].cifrado.ct = ct.slice(0, k) + (ct[k] === 'A' ? 'B' : 'A') + ct.slice(k + 1);
    localStorage.setItem('proto_bd', JSON.stringify(bd));
  });
  await pg.setInputFiles('#archivoLlave', rutaLlave); await pg.fill('#claveAbrir', FUERTE); await pg.click('#btnAbrir'); await pg.waitForSelector('#abierto:not([hidden])');
  const tPanel = await pg.textContent('#tablaPanel');
  ok('si alguien cambia de lugar o altera filas en la base, esas filas NO se abren (y no muestran datos de otros)', (await pg.locator('#tablaPanel tbody tr').count()) === 3 && !/Estudiante de Prueba/.test(tPanel) && (tPanel.match(/No se pudo abrir|llave/g) || []).length >= 3, tPanel.slice(0, 200));
  await pg.click('#btnBloquear');

  ok('la página no hizo ninguna petición a internet', externas.length === 0, externas.join(' '));
  ok('la política de seguridad de la página impide enviar datos a cualquier sitio (connect-src \'none\') y solo permite su propio código', await pg.evaluate(() => { const c = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content; return /connect-src 'none'/.test(c) && /default-src 'none'/.test(c) && !/unsafe-inline|unsafe-eval|https?:/.test(c); }));
  ok('sin errores de JavaScript', errores.length === 0, errores.join(' | '));

  // Bloqueo automático tras 10 minutos sin usar el panel (reloj simulado)
  if (pg.clock && pg.clock.install) {
    const pg2 = await ctx.newPage(); await pg2.clock.install(); await pg2.goto(base);
    await pg2.evaluate(arch => localStorage.setItem('proto_bd', arch), JSON.stringify([]));
    await pg2.click('.tab[data-tab=panel]'); await pg2.setInputFiles('#archivoLlave', rutaLlave); await pg2.fill('#claveAbrir', FUERTE); await pg2.click('#btnAbrir'); await pg2.waitForSelector('#abierto:not([hidden])');
    await pg2.clock.fastForward('09:00'); const abiertoA = await pg2.isVisible('#abierto');
    await pg2.clock.fastForward('02:00'); await pg2.waitForTimeout(100);
    ok('el panel se bloquea solo tras 10 minutos sin usarlo (y no antes)', abiertoA && await pg2.isVisible('#bloqueado'));
  } else console.log('  (omitida: esta versión de Playwright no simula el reloj)');

  await nav.close(); srv.close();
  console.log(`\nResultado: ${buenas} comprobaciones correctas, ${malas} fallidas`);
  process.exit(malas ? 1 : 0);
})().catch(e => { console.log('✘ Error inesperado: ' + (e && e.stack || e)); process.exit(1); });
