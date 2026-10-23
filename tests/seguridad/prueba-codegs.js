// Prueba del Apps Script REAL (apps-script/Code.gs) ejecutado en un entorno simulado de Google, conectado a las
// funciones SQL REALES en un Postgres LOCAL (a través de rpc-sync). Gmail se simula: NO se envía ningún correo.
// Uso: PGPORT=5499 node tests/seguridad/prueba-codegs.js
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const { execFileSync } = require('child_process');
const { crearRpc } = require('./rpc-local');
const { crearRpcSync } = require('./rpc-sync');
const { exigirBaseLocal } = require('./guardia-entorno');

const RAIZ = path.resolve(__dirname, '../..');
const PUERTO = process.env.PGPORT || '5499';
exigirBaseLocal('127.0.0.1', PUERTO);
const OPTS = { host: '127.0.0.1', port: +PUERTO, user: 'postgres', database: 'postgres' };
const db = crearRpc(OPTS), sync = crearRpcSync(OPTS);
const psql = a => execFileSync('psql', ['-h', '127.0.0.1', '-p', PUERTO, '-U', 'postgres', '-q', '-v', 'ON_ERROR_STOP=1', '-f', a], { stdio: ['ignore', 'pipe', 'pipe'] });
const CODIGO = fs.readFileSync(path.join(RAIZ, 'apps-script/Code.gs'), 'utf8');

let P = 0, F = 0;
const ok = (n, c, d) => { if (c) { P++; console.log(`  ✔ ${n}`); } else { F++; console.log(`  ✘ ${n}${d ? ' → ' + d : ''}`); } };
const seccion = t => console.log('\n' + t);
const uuid = () => crypto.randomUUID();
const rut = n => { let s = 0, m = 2; for (const d of String(n).split('').reverse()) { s += d * m; m = m === 7 ? 2 : m + 1; } const r = 11 - s % 11; return n + '-' + (r === 11 ? '0' : r === 10 ? 'K' : r); };

const SECRETO = 'secreto-script-ficticio';
const PROPS = { ENTORNO: 'prueba', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', SUPABASE_KEY: 'sb_publishable_FICTICIA', SECRETO_SCRIPT: SECRETO,
  NOMBRE_COLEGIO: 'Colegio TEST', CORREO_CONTACTO: 'contacto@example.invalid', TELEFONO_CONTACTO: '000', DIRECCION_COLEGIO: 'Calle TEST 1',
  LIMITE_DIARIO: '50', DESTINATARIOS_PRUEBA: 'apoderado.test@example.invalid, otro.test@example.invalid' };
const DEST = 'apoderado.test@example.invalid';

// ---- Entorno de Google simulado (módulo compartido) ----
const { crearEntorno } = require('./apps-script-simulado');
const entorno = props => crearEntorno({ codigo: CODIGO, props, sync });

// ---- Datos ficticios reales en la base ----
let tokInterna, tokAdmin, contador = 1000;
const fichaEst = (n, o = {}) => ({
  tipo: o.tipo || 'nuevo',
  estudiante: { nombre: o.nombre || `Estudiante TEST ${n}`, rut: rut(31000000 + n), fnac: '2012-03-15', direccion: 'Calle Ficticia 1', comuna: 'Comuna TEST', nacionalidad: 'Chilena',
    celular: '+56 9 0000 0000', correo: '', procedencia: (o.tipo || 'nuevo') === 'nuevo' ? 'Colegio TEST' : '', cursoMatricula: (o.tipo || 'nuevo') === 'antiguo' ? '2° Medio A' : '',
    repitencia: 'no', repCurso: '', repAnio: '', pie: 'no', pieDiagnostico: '', pieDocumentacion: '', salud: 'no', saludDetalle: '', observaciones: '' },
  apoderado: { nombre: o.apoderado || 'Apoderado TEST', rut: rut(21000000 + (o.grupo || 0)), edad: '40', direccion: 'Calle Ficticia 1', comuna: 'Comuna TEST', nacionalidad: 'Chilena',
    celular: '+56 9 0000 0001', correo: o.correo === undefined ? DEST : o.correo, parentesco: 'Madre', viveConEstudiante: 'si', nivelEducacional: 'Titulado de una Universidad',
    situacionLaboral: 'Trabaja jornada completa (todo el día)', lugarTrabajo: 'Fuera del hogar' },
  suplente: null
});
async function crear(n, o = {}) {
  const id = uuid(); const base = contador; contador += n + 1;
  const r = await db.rpc('reservar_folios', { p_clave: tokInterna, p_solicitud: id, p_cantidad: n });
  const fichas = r.folios.map((fo, i) => ({ ...fichaEst(base + i, { tipo: i % 2 ? 'nuevo' : 'antiguo', grupo: base, ...o, nombre: (o.nombres || [])[i] }), folio: String(fo), fechaRegistro: '23-10-2026, 10:00:00' }));
  await db.rpc('guardar_solicitud', { p_clave: tokInterna, p_solicitud: id, p_fichas: fichas });
  return { id, folios: r.folios.map(String), fichas };
}
const pdf = (bytes = 40000, marca = 'A') => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(bytes, marca), Buffer.from('\n%%EOF\n')]);
const certs = (s, o = {}) => s.folios.map(fo => ({ folio: fo, pdfBase64: pdf(o.bytes || 40000, fo.slice(-1)).toString('base64') }));
const estadoCorreo = async id => (await db.admin('select correo_estado, correo_intentos, correo_detalle from public.solicitudes where id=$1', [id])).rows[0];
const filas = async id => (await db.admin('select count(*)::int n from public.matriculas where solicitud_id=$1', [id])).rows[0].n;
const sol = (s, c, extra = {}) => ({ token: tokInterna, solicitudId: s.id, certificados: c, ...extra });

(async () => {
  psql(path.join(RAIZ, 'supabase/schema.sql')); psql(path.join(RAIZ, 'supabase/migraciones/002_matricula_multiple.sql'));
  await db.admin(`update public.config set modo_transicion=false; update public.config set clave_script_hash = extensions.crypt('${SECRETO}', extensions.gen_salt('bf')) where id; delete from public.intentos; delete from public.sesiones`);
  tokInterna = (await db.rpc('iniciar_sesion', { p_clave: 'clave-funcionarios-ficticia', p_rol: 'interna' }, { ip: '198.51.100.7' })).token;
  tokAdmin = (await db.rpc('iniciar_sesion', { p_clave: 'clave-encargados-ficticia', p_rol: 'admin' }, { ip: '198.51.100.7' })).token;

  seccion('1) Un solo correo por solicitud, con un certificado independiente por estudiante');
  let e = entorno(PROPS); let s = await crear(1);
  let r = e.post(sol(s, certs(s)));
  ok('1 certificado → 1 correo', r.ok && r.enviado && e.enviados.length === 1 && e.enviados[0].attachments.length === 1, JSON.stringify(r));
  ok('el estado en la base queda «enviado»', (await estadoCorreo(s.id)).correo_estado === 'enviado');
  e = entorno(PROPS); s = await crear(3, { nombres: ['Ana TEST Uno', 'Beto TEST Dos', 'Carla TEST Tres'] });
  r = e.post(sol(s, certs(s)));
  ok('3 certificados → UN solo correo (no tres)', r.ok && e.enviados.length === 1 && e.enviados[0].attachments.length === 3, JSON.stringify(r));
  ok('los 3 PDF son archivos separados con el folio de cada alumno en el nombre', e.enviados[0].attachments.map(a => a.nombre).every((n, i) => n.startsWith(`Certificado_matricula_Ficha_${s.folios[i]}_`)) && new Set(e.enviados[0].attachments.map(a => a.nombre)).size === 3, e.enviados[0].attachments.map(a => a.nombre).join());
  ok('el asunto identifica las fichas y la cantidad de estudiantes', new RegExp(`Fichas ${s.folios[0]}, ${s.folios[1]} y ${s.folios[2]} \\(3 estudiantes\\)`).test(e.enviados[0].subject), e.enviados[0].subject);
  ok('el cuerpo nombra a los 3 estudiantes y la solicitud', ['Ana TEST Uno', 'Beto TEST Dos', 'Carla TEST Tres'].every(n => e.enviados[0].body.includes(n)) && e.enviados[0].body.includes(s.id.substring(0, 8).toUpperCase()));
  ok('el cuerpo indica la condición y el curso/procedencia de cada alumno (de la base)', e.enviados[0].body.includes('Estudiante antiguo') && e.enviados[0].body.includes('Estudiante nuevo') && e.enviados[0].body.includes('2° Medio A') && e.enviados[0].body.includes('Colegio TEST'));
  ok('en modo prueba el asunto lleva [PRUEBA] y el cuerpo el aviso de datos ficticios', e.enviados[0].subject.startsWith('[PRUEBA]') && /MENSAJE DE PRUEBA/.test(e.enviados[0].body));
  ok('responde a la dirección de contacto del colegio', e.enviados[0].replyTo === 'contacto@example.invalid');
  e = entorno(PROPS); s = await crear(5);
  r = e.post(sol(s, certs(s)));
  ok('5 certificados (el máximo) → UN correo con 5 adjuntos', r.ok && e.enviados.length === 1 && e.enviados[0].attachments.length === 5, JSON.stringify(r));
  ok('la respuesta al navegador no contiene secretos, correos ni datos', JSON.stringify(r) === '{"ok":true,"enviado":true,"certificados":5,"registro":true}');
  e = entorno({ ...PROPS, ENTORNO: 'produccion' }); s = await crear(2);
  r = e.post(sol(s, certs(s)));
  ok('en modo producción el asunto NO lleva [PRUEBA] ni aviso', r.ok && !/PRUEBA/.test(e.enviados[0].subject + e.enviados[0].body));

  seccion('2) Los datos del correo salen de la base, no del navegador');
  e = entorno(PROPS); s = await crear(2, { nombres: ['Nombre Real Uno', 'Nombre Real Dos'] });
  r = e.post(sol(s, certs(s), { to: 'atacante@example.com', nombreEstudiante: 'Nombre Falso', nombreApoderado: 'Falso', subject: 'Phishing', body: 'texto libre' }));
  ok('el destinatario es el de la base aunque el navegador mande otro', r.ok && e.enviados[0].to === DEST);
  ok('el asunto y el cuerpo los arma el script (se ignora el texto libre)', !/Phishing|Falso|texto libre|atacante/.test(e.enviados[0].subject + e.enviados[0].body) && e.enviados[0].body.includes('Nombre Real Uno'));

  seccion('3) Token, secreto y solicitud');
  e = entorno(PROPS); s = await crear(1);
  for (const [nombre, obj, esperado] of [
    ['sin token', { ...sol(s, certs(s)), token: undefined }, 'sesion_invalida'],
    ['token con formato inválido', { ...sol(s, certs(s)), token: 'hola' }, 'sesion_invalida'],
    ['token con formato correcto pero inexistente', { ...sol(s, certs(s)), token: 'c'.repeat(64) }, 'sesion_invalida'],
    ['secreto antiguo fijo en lugar de token', { ...sol(s, certs(s)), token: undefined, secreto: 'incosaf-secreto-antiguo' }, 'sesion_invalida'],
    ['identificador de solicitud inválido', { ...sol(s, certs(s)), solicitudId: '1; drop table' }, 'solicitud_invalida'],
    ['solicitud inexistente', { ...sol(s, certs(s)), solicitudId: uuid() }, 'no_encontrada']
  ]) { const x = e.post(obj); ok(`rechaza: ${nombre}`, x.ok === false && x.error === esperado && e.enviados.length === 0, JSON.stringify(x)); }
  ok('JSON roto → error genérico', e.post('{no es json').error === 'error_interno');
  const sinGuardar = uuid(); await db.rpc('reservar_folios', { p_clave: tokInterna, p_solicitud: sinGuardar, p_cantidad: 1 });
  ok('una solicitud que no se guardó no se envía', e.post({ token: tokInterna, solicitudId: sinGuardar, certificados: certs(s) }).error === 'solicitud_no_guardada');
  const sinCorreo = await crear(1, { correo: '' });
  ok('una solicitud sin correo del apoderado no se envía', e.post(sol(sinCorreo, certs(sinCorreo))).error === 'sin_correo');
  ok('ninguno de esos rechazos envió correo', e.enviados.length === 0);
  const eSecreto = entorno({ ...PROPS, SECRETO_SCRIPT: 'otro-secreto-distinto-123' });
  ok('con un secreto de script que no coincide con la base, no se envía y no se detalla el motivo', eSecreto.post(sol(s, certs(s))).error === 'error_interno' && eSecreto.enviados.length === 0);
  await db.admin(`update public.solicitudes set creada = now() - interval '30 hours' where id=$1`, [s.id]);
  ok('un funcionario no puede enviar una solicitud de hace más de 24 h', e.post(sol(s, certs(s))).error === 'sesion_invalida' && e.enviados.length === 0);
  ok('el panel de encargados (token admin) sí puede reenviarla', (r = e.post({ ...sol(s, certs(s)), token: tokAdmin })).ok && e.enviados.length === 1, JSON.stringify(r));

  seccion('4) Certificados manipulados: nunca se envía «una parte»');
  e = entorno(PROPS); s = await crear(3); const otra = await crear(1); const c = certs(s);
  for (const [nombre, lista, esperado] of [
    ['falta un certificado (2 de 3)', c.slice(0, 2), 'certificados_no_coinciden'],
    ['sobra un certificado de OTRA solicitud', [...c, certs(otra)[0]], 'certificados_no_coinciden'],
    ['un folio no corresponde a la solicitud', [c[0], c[1], { ...c[2], folio: otra.folios[0] }], 'certificados_no_coinciden'],
    ['folio repetido', [c[0], c[1], { ...c[1] }], 'certificados_invalidos'],
    ['sin certificados', [], 'certificados_invalidos'],
    ['certificados no es una lista', 'abc', 'certificados_invalidos'],
    ['6 certificados (más del máximo)', Array.from({ length: 6 }, (_, i) => ({ folio: String(900 + i), pdfBase64: c[0].pdfBase64 })), 'demasiados_certificados'],
    ['folio con formato inválido', [{ folio: '12a', pdfBase64: c[0].pdfBase64 }], 'certificados_invalidos']
  ]) { const x = e.post(sol(s, lista)); ok(`rechaza: ${nombre}`, x.ok === false && x.error === esperado && e.enviados.length === 0, JSON.stringify(x)); }
  ok('la solicitud sigue pendiente de envío (se puede reintentar con los PDF correctos)', ['pendiente', 'error'].includes((await estadoCorreo(s.id)).correo_estado), JSON.stringify(await estadoCorreo(s.id)));
  r = e.post(sol(s, c));
  ok('con los 3 PDF correctos se envía el correo completo', r.ok && e.enviados.length === 1 && e.enviados[0].attachments.length === 3);

  seccion('5) Archivos inválidos y tamaños');
  e = entorno(PROPS); s = await crear(2); const cc = certs(s);
  const malos = [
    ['archivo que no es PDF (ejecutable)', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]).toString('base64'), 'pdf_invalido'],
    ['PDF sin marca final %%EOF (truncado/corrupto)', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 'B')]).toString('base64'), 'pdf_invalido'],
    ['caracteres que no son Base64', 'JVBER<script>alert(1)</script>'.padEnd(200, 'A'), 'pdf_invalido'],
    ['texto vacío', '', 'pdf_invalido'],
    ['PDF individual demasiado grande (> 250 000 caracteres)', pdf(200000).toString('base64'), 'pdf_demasiado_grande']
  ];
  for (const [nombre, b64, esperado] of malos) {
    const x = e.post(sol(s, [{ folio: s.folios[0], pdfBase64: b64 }, cc[1]]));
    ok(`rechaza: ${nombre}`, x.ok === false && x.error === esperado && e.enviados.length === 0, JSON.stringify(x));
  }
    const cinco = await crear(5); const cincoGrandes = cinco.folios.map(fo => ({ folio: fo, pdfBase64: pdf(170000, 'D').toString('base64') }));
  ok('cada PDF cabe (≈227 000) pero la SUMA (≈1,13 M) excede el total permitido (1 M) → se rechaza todo (adjuntos_excedidos)', e.post(sol(cinco, cincoGrandes)).error === 'adjuntos_excedidos' && e.enviados.length === 0);
  ok('la solicitud no se «cierra» por ese rechazo: sigue pendiente', ['pendiente', 'error'].includes((await estadoCorreo(cinco.id)).correo_estado));
  const x2 = e.post(sol(s, certs(s), { relleno: 'x'.repeat(1300000) }));
  ok('una petición HTTP de más de 1,2 millones de caracteres se rechaza', x2.error === 'solicitud_invalida' && e.enviados.length === 0);
  const tamanoReal = certs(await crear(5), { bytes: 90000 });
  ok('los certificados reales (≈120 000 caracteres c/u) × 5 caben con amplio margen', tamanoReal.reduce((a, c2) => a + c2.pdfBase64.length, 0) < 1000000);

  seccion('6) Límites por destinatario y globales');
  e = entorno({ ...PROPS, LIMITE_DIARIO: '100' });
  const resultados = [];
  for (let i = 0; i < 6; i++) { const si = await crear(i % 3 + 1, { grupo: 50 + i }); resultados.push({ si, r: e.post(sol(si, certs(si))) }); }
  ok('hasta 5 correos al mismo destinatario el mismo día (cada solicitud, de 1 a 3 alumnos, cuenta UN correo)', resultados.slice(0, 5).every(x => x.r.ok) && e.enviados.length === 5, JSON.stringify(resultados.map(x => x.r.error || 'ok')));
  ok('el 6.º correo al mismo destinatario se rechaza (limite_destinatario)', resultados[5].r.error === 'limite_destinatario' && e.enviados.length === 5);
  ok('el rechazo por límite deja la solicitud en «error» (sus matrículas siguen guardadas)', (await estadoCorreo(resultados[5].si.id)).correo_estado === 'error' && (await filas(resultados[5].si.id)) === 3);
  e = entorno({ ...PROPS, LIMITE_DIARIO: '2' });
  const g1 = await crear(1, { correo: 'otro.test@example.invalid', grupo: 70 }), g2 = await crear(1, { grupo: 71 }), g3 = await crear(1, { grupo: 72 });
  ok('tope global diario: los 2 primeros se envían', e.post(sol(g1, certs(g1))).ok && e.post(sol(g2, certs(g2))).ok);
  ok('el 3.º se rechaza por límite diario ANTES de reservar nada', e.post(sol(g3, certs(g3))).error === 'limite_diario' && e.enviados.length === 2 && (await estadoCorreo(g3.id)).correo_intentos === 0);
  ok('la solicitud rechazada por el tope queda intacta (pendiente, 0 intentos)', (await estadoCorreo(g3.id)).correo_estado === 'pendiente');

  seccion('7) Destinatario no autorizado / inválido / manipulado');
  e = entorno(PROPS); s = await crear(1, { correo: 'otra.persona@example.com', grupo: 80 });
  ok('en modo prueba NO se envía a una dirección que no está en la lista autorizada', e.post(sol(s, certs(s))).error === 'destinatario_no_autorizado' && e.enviados.length === 0);
  const eProd = entorno({ ...PROPS, ENTORNO: 'produccion' });
  ok('en producción ese mismo destinatario sí es válido', eProd.post(sol(s, certs(s))).ok && eProd.enviados.length === 1);
  e = entorno(PROPS);
  for (const [nombre, dir] of [['correo sin formato', 'esto-no-es-un-correo'], ['inyección de cabeceras con salto de línea', `${DEST}\nBcc: victima@example.com`], ['varios destinatarios con coma', `${DEST},otro@example.com`], ['con símbolos < >', `<${DEST}>`]]) {
    const si = await crear(1, { grupo: 90 + Math.floor(Math.random() * 5) });   // la base valida el correo; se altera directamente para probar el script
    await db.admin(`update public.matriculas set datos = jsonb_set(datos, '{apoderado,correo}', to_jsonb($1::text)) where solicitud_id=$2`, [dir, si.id]);
    const x = e.post(sol(si, certs(si)));
    ok(`rechaza (aunque la base estuviera alterada): ${nombre}`, x.ok === false && x.error === 'correo_invalido' && e.enviados.length === 0, JSON.stringify(x));
  }

  seccion('8) Reintentos sin duplicación');
  e = entorno(PROPS); s = await crear(2);
  r = e.post(sol(s, certs(s))); const r2 = e.post(sol(s, certs(s))); const r3 = e.post(sol(s, certs(s)));
  ok('enviar la misma solicitud 3 veces genera UN solo correo', r.ok && e.enviados.length === 1 && r2.ya_enviado === true && r3.ya_enviado === true, JSON.stringify([r, r2, r3]));
  const eNuevo = entorno(PROPS);   // el script se reinicia (otra instancia sin memoria local): lo detecta la base
  const rn = eNuevo.post(sol(s, certs(s)));
  ok('aunque el script pierda su memoria local, la base impide el duplicado (ya_enviado)', rn.ya_enviado === true && eNuevo.enviados.length === 0, JSON.stringify(rn));
  e = entorno(PROPS); s = await crear(2); e.mailFalla = true;
  r = e.post(sol(s, certs(s)));
  ok('si el servicio de correo falla: error claro, nada enviado, solicitud en «error»', r.error === 'envio_fallido' && e.enviados.length === 0 && (await estadoCorreo(s.id)).correo_estado === 'error');
  ok('las matrículas siguen guardadas tras el fallo del correo', (await filas(s.id)) === 2);
  e.mailFalla = false; r = e.post(sol(s, certs(s)));
  ok('al reintentar (servicio recuperado) se envía UN correo con los 2 certificados', r.ok && e.enviados.length === 1 && e.enviados[0].attachments.length === 2 && (await estadoCorreo(s.id)).correo_estado === 'enviado');
  e = entorno(PROPS); s = await crear(2);
  e.forzar.registrar_envio = () => ({ getResponseCode: () => 503, getContentText: () => '{}' });   // el correo sale pero no se puede avisar a la base
  r = e.post(sol(s, certs(s)));
  ok('si el correo sale pero falla el aviso a la base: el envío se informa como hecho', r.ok && r.enviado && r.registro === false && e.enviados.length === 1);
  delete e.forzar.registrar_envio; await db.admin(`update public.solicitudes set correo_reservado = now() - interval '20 minutes' where id=$1`, [s.id]);
  r = e.post(sol(s, certs(s)));
  ok('…y aunque la base siga en «enviando» y venza la reserva, el script recuerda el envío y NO lo repite', r.ya_enviado === true && e.enviados.length === 1, JSON.stringify(r));
  const sf = await crear(1); const ef = entorno(PROPS);
  await db.admin(`update public.solicitudes set correo_intentos = 6, correo_estado='error' where id=$1`, [sf.id]);
  ok('tras 6 intentos fallidos la solicitud se detiene (demasiados_reintentos)', ef.post(sol(sf, certs(sf))).error === 'demasiados_reintentos' && ef.enviados.length === 0);
  const sp = await crear(1); const ep = entorno(PROPS);
  await db.admin(`update public.solicitudes set correo_estado='enviando', correo_reservado = now() where id=$1`, [sp.id]);
  ok('un envío en curso (otro intento simultáneo) se rechaza: en_proceso', ep.post(sol(sp, certs(sp))).error === 'en_proceso' && ep.enviados.length === 0);

  seccion('9) Fallos de Supabase y configuración: falla cerrada');
  e = entorno(PROPS); s = await crear(1); e.caido = true;
  r = e.post(sol(s, certs(s)));
  ok('si Supabase no responde NO se envía nada', r.error === 'servicio_no_disponible' && e.enviados.length === 0);
  for (const [nombre, props] of [
    ['sin ENTORNO', { ...PROPS, ENTORNO: '' }], ['ENTORNO desconocido', { ...PROPS, ENTORNO: 'otro' }], ['sin SUPABASE_URL', { ...PROPS, SUPABASE_URL: '' }],
    ['sin SECRETO_SCRIPT', { ...PROPS, SECRETO_SCRIPT: '' }], ['secreto demasiado corto', { ...PROPS, SECRETO_SCRIPT: 'corto' }],
    ['URL que no es de Supabase', { ...PROPS, SUPABASE_URL: 'https://sitio-malicioso.example.com' }],
    ['modo prueba SIN lista de destinatarios autorizados', { ...PROPS, DESTINATARIOS_PRUEBA: '' }],
    ['modo prueba apuntando al proyecto de PRODUCCIÓN', { ...PROPS, SUPABASE_URL: 'https://mtlunrefaxsagfkphvvw.supabase.co' }]
  ]) { const ee = entorno(props); const x = ee.post(sol(s, certs(s))); ok(`configuración incompleta o peligrosa → no envía (${nombre})`, x.error === 'configuracion' && ee.enviados.length === 0 && ee.llamadas.length === 0, JSON.stringify(x)); }
  e = entorno(PROPS); e.post(sol(await crear(1), certs(s)));
  ok('Supabase solo se consulta con la clave PÚBLICA, nunca con una clave secreta', e.llamadas.every(l => l.apikey === 'sb_publishable_FICTICIA'));
  ok('Code.gs no contiene claves ni secretos reales', !/sb_secret|service_role|eyJ[A-Za-z0-9_-]{20,}|AIza|incosaf20/.test(CODIGO));
  ok('el modo producción tampoco puede apuntar a un servidor que no sea de Supabase', entorno({ ...PROPS, ENTORNO: 'produccion', SUPABASE_URL: 'http://abcdefghijklmnopqrst.supabase.co' }).post(sol(s, certs(s))).error === 'configuracion');

  seccion('10) Sanitización de textos de la base');
  e = entorno(PROPS); s = await crear(1, { nombres: ['x'] });
  await db.admin(`update public.matriculas set datos = jsonb_set(datos, '{estudiante,nombre}', to_jsonb($1::text)) where solicitud_id=$2`, ['Ana <img src=x onerror=alert(1)> Ñandú', s.id]);
  r = e.post(sol(s, certs(s)));
  ok('los < > de los nombres se eliminan y el correo va en texto plano', r.ok && !/[<>]/.test(e.enviados[0].body) && /Ana img src=x onerror=alert\(1\) Ñandú/.test(e.enviados[0].body));
  ok('el nombre del archivo adjunto es seguro (solo letras, números y guiones bajos)', /^Certificado_matricula_Ficha_\d+_[A-Za-z0-9_]+\.pdf$/.test(e.enviados[0].attachments[0].nombre), e.enviados[0].attachments[0].nombre);
  ok('doGet no revela datos sensibles', JSON.parse(e.ctx.doGet().getContent()).servicio === 'certificados de matrícula');

  sync.cerrar(); await db.cerrar();
  console.log(`\nResultado: ${P} comprobaciones correctas, ${F} fallidas`);
  process.exit(F ? 1 : 0);
})().catch(e => { console.error('Error inesperado:', e); process.exit(2); });
