/**
 * Envío de certificados de matrícula — Google Apps Script
 * ---------------------------------------------------------------------------------------------
 * UN SOLO correo por solicitud, con un certificado PDF independiente por cada estudiante matriculado.
 *
 * Seguridad (resumen; el detalle está en docs/multiple/):
 *   · No hay ningún secreto en la página web. Para enviar hay que traer un token de sesión de funcionario
 *     (se comprueba en Supabase) y este script presenta además SU PROPIO secreto (propiedad SECRETO_SCRIPT,
 *     solo existe aquí y en la base de Supabase como hash).
 *   · El DESTINATARIO, los nombres, folios y cursos salen de la base de datos (función reservar_envio), no de
 *     lo que envíe el navegador. El navegador solo aporta los PDF, que se comprueban uno por uno.
 *   · Los certificados deben corresponder EXACTAMENTE a las matrículas guardadas de la solicitud: si falta uno,
 *     sobra uno o no coincide un folio, no se envía nada (nunca se envía «una parte»).
 *   · Límites: tamaño por PDF, tamaño total, cantidad de adjuntos, correos por destinatario y por día.
 *   · Los reintentos no duplican: una solicitud ya enviada no se vuelve a enviar.
 *   · Si Supabase no responde, no se envía nada (falla cerrada).
 *
 * Instalación (a mano; ver docs/multiple/GUIA_ENTORNO_PRUEBA.md). Un proyecto de Apps Script DISTINTO para
 * pruebas y para producción. Propiedades del script (Configuración del proyecto → Propiedades del script):
 *     ENTORNO             «prueba» o «produccion»  (obligatoria)
 *     SUPABASE_URL        https://<proyecto>.supabase.co
 *     SUPABASE_KEY        clave pública (sb_publishable_...)  — NUNCA una clave secreta ni de servicio
 *     SECRETO_SCRIPT      texto largo y aleatorio; el mismo que se registra como hash en Supabase
 *     NOMBRE_COLEGIO, CORREO_CONTACTO, TELEFONO_CONTACTO, DIRECCION_COLEGIO   (datos del correo)
 *     LIMITE_DIARIO       (opcional) tope de correos por día; por defecto 100, máximo 300
 *     DESTINATARIOS_PRUEBA  (solo en ENTORNO=prueba) lista de correos autorizados, separados por coma.
 *                           En modo prueba NO se envía a ninguna otra dirección.
 *   Implementar → Aplicación web → Ejecutar como: Yo · Quién tiene acceso: Cualquier persona.
 */

// ---------- Límites (ver docs/multiple/LIMITES.md para la justificación) ----------
var MAX_CERTIFICADOS = 5;          // igual que MAX_ESTUDIANTES de la página y que _max_estudiantes() de la base
var MAX_PDF_BASE64 = 250000;       // por PDF, en caracteres Base64 (≈ 187 KB reales; un certificado comprimido mide ≈ 120 000)
var MAX_TOTAL_BASE64 = 1000000;    // suma de todos los PDF de la solicitud (≈ 750 KB); Gmail admite 25 MB por mensaje
var MAX_SOLICITUD_CHARS = 1200000; // tamaño de toda la petición HTTP (JSON incluido)
var MAX_POR_DESTINATARIO = 5;      // correos ENVIADOS por destinatario y día (cada solicitud = 1 correo, sea de 1 o de 5 alumnos)
var MAX_LIMITE_DIARIO = 300;
var ESPERA_BLOQUEO_MS = 20000;
var MAX_ENVIADOS_RECORDADOS = 120; // solicitudes ya enviadas que se recuerdan (protege contra duplicados si falla el registro)
var REF_PRODUCCION = 'mtlunrefaxsagfkphvvw'; // identificador PÚBLICO del proyecto real: el modo prueba nunca puede apuntarle

function doGet() {
  return json_({ ok: true, servicio: 'certificados de matrícula' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || e.postData.length > MAX_SOLICITUD_CHARS) return json_({ ok: false, error: 'solicitud_invalida' });
    var cfg = configuracion_();
    if (!cfg.ok) return json_({ ok: false, error: 'configuracion' });

    var d = JSON.parse(e.postData.contents);
    if (typeof d.token !== 'string' || !/^[0-9a-f]{64}$/.test(d.token)) return json_({ ok: false, error: 'sesion_invalida' });
    if (typeof d.solicitudId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(d.solicitudId)) {
      return json_({ ok: false, error: 'solicitud_invalida' });
    }

    // 1) Certificados: estructura, cantidad y tamaños (ANTES de gastar cuota ni reservar nada)
    var v = validarCertificados_(d.certificados);
    if (!v.ok) return json_({ ok: false, error: v.error });

    // 2) Idempotencia local: si este script ya envió esta solicitud, no se repite
    if (yaEnviada_(d.solicitudId)) return json_({ ok: true, ya_enviado: true });

    var lock = LockService.getScriptLock();
    lock.waitLock(ESPERA_BLOQUEO_MS);
    try {
      if (yaEnviada_(d.solicitudId)) return json_({ ok: true, ya_enviado: true });
      var estado = estadoDelDia_();
      var tope = Math.min(parseInt(propiedad_('LIMITE_DIARIO', '100'), 10) || 100, MAX_LIMITE_DIARIO);
      if (estado.total >= tope) return json_({ ok: false, error: 'limite_diario' });

      // 3) Datos autoritativos y reserva del envío en Supabase (comprueba secreto, token y estado de la solicitud)
      var r = rpc_('reservar_envio', { p_secreto: cfg.secreto, p_solicitud: d.solicitudId, p_token: d.token });
      if (r === null) return json_({ ok: false, error: 'servicio_no_disponible' });
      if (!r.ok) return json_({ ok: false, error: motivoAError_(r.motivo), ya_enviado: r.motivo === 'ya_enviado' ? true : undefined });

      // 4) Verificaciones sobre los datos de la base
      var dest = typeof r.destinatario === 'string' ? r.destinatario.trim() : '';   // se valida TAL CUAL, sin «limpiar» (así no se acepta algo manipulado)
      var falla = null;
      if (dest.length > 120 || !/^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(dest)) falla = 'correo_invalido';
      else if (cfg.entorno === 'prueba' && cfg.autorizados.indexOf(dest.toLowerCase()) < 0) falla = 'destinatario_no_autorizado';
      else if ((estado.destinos[hash_(dest)] || 0) >= MAX_POR_DESTINATARIO) falla = 'limite_destinatario';
      else if (!r.estudiantes || r.estudiantes.length < 1 || r.estudiantes.length > MAX_CERTIFICADOS) falla = 'datos_invalidos';
      else if (!coinciden_(r.estudiantes, v.porFolio)) falla = 'certificados_no_coinciden';
      if (falla) { liberar_(cfg, d.solicitudId, falla); return json_({ ok: false, error: falla }); }

      // 5) Armado y envío de UN correo con todos los certificados
      var colegio = propiedad_('NOMBRE_COLEGIO', 'Instituto Comercial Alberto Valenzuela Llanos de San Fernando');
      var adjuntos = [], lineas = [], folios = [];
      for (var i = 0; i < r.estudiantes.length; i++) {
        var est = r.estudiantes[i];
        var folio = limpiar_(String(est.folio), 9);
        var nombreArchivo = 'Certificado_matricula_Ficha_' + folio + '_' + slug_(est.nombre) + '.pdf';
        adjuntos.push(Utilities.newBlob(Utilities.base64Decode(v.porFolio[folio]), 'application/pdf', nombreArchivo));
        folios.push(folio);
        lineas.push((i + 1) + '. ' + limpiar_(est.nombre, 200) + (est.rut ? ' (RUT ' + limpiar_(est.rut, 20) + ')' : '') + '\n' +
          '   Ficha: ' + folio + ' · ' + (est.tipo === 'antiguo' ? 'Estudiante antiguo' : 'Estudiante nuevo') +
          (est.tipo === 'nuevo' && est.procedencia ? ' · Colegio de procedencia: ' + limpiar_(est.procedencia, 200) : '') +
          (est.cursoMatricula ? ' · Curso 2027: ' + limpiar_(est.cursoMatricula, 200) : '') + '\n' +
          '   Certificado adjunto: ' + nombreArchivo);
      }
      var contacto = propiedad_('CORREO_CONTACTO', '');
      var telefono = propiedad_('TELEFONO_CONTACTO', '');
      var direccion = propiedad_('DIRECCION_COLEGIO', '');
      var varios = folios.length > 1;
      var asunto = (cfg.entorno === 'prueba' ? '[PRUEBA] ' : '') + 'Confirmación de matrícula 2027 - ' +
        (varios ? 'Fichas ' + listaFolios_(folios) + ' (' + folios.length + ' estudiantes)' : 'Ficha ' + folios[0]);
      var cuerpo =
        (cfg.entorno === 'prueba' ? '*** MENSAJE DE PRUEBA: datos ficticios, sin valor oficial ***\n\n' : '') +
        'Estimado(a) ' + limpiar_(r.apoderado, 200) + ':\n' +
        'Confirmamos ' + (varios ? 'las matrículas 2027 de ' + folios.length + ' estudiantes' : 'la matrícula 2027') + ' en ' + colegio + '.\n' +
        'Solicitud: ' + d.solicitudId.substring(0, 8).toUpperCase() + '\n\n' +
        lineas.join('\n\n') + '\n\n' +
        'Cada certificado en PDF es independiente: puede abrirlo, imprimirlo y compartirlo por separado.\n\n' +
        'Atentamente,\n' + colegio + '\n\n--\n' +
        'Este es un correo automático de confirmación de matrícula.\n' +
        (contacto ? 'Para consultas escriba a: ' + contacto + (telefono ? ' · Teléfono: ' + telefono : '') + '\n' : '') +
        colegio + (direccion ? ' · ' + direccion : '');
      var opciones = { to: dest, subject: asunto, body: cuerpo, name: colegio, attachments: adjuntos };
      if (contacto) opciones.replyTo = contacto;

      try {
        MailApp.sendEmail(opciones);
      } catch (errMail) {
        console.error(errMail);
        liberar_(cfg, d.solicitudId, 'servicio_correo');
        return json_({ ok: false, error: 'envio_fallido' });
      }

      // 6) El servicio de correo aceptó el envío: se recuerda ANTES de avisar a Supabase (evita duplicados si eso falla)
      estado.total += 1;
      estado.destinos[hash_(dest)] = (estado.destinos[hash_(dest)] || 0) + 1;
      guardarEstado_(estado);
      recordarEnviada_(d.solicitudId);
      var reg = rpc_('registrar_envio', { p_secreto: cfg.secreto, p_solicitud: d.solicitudId, p_resultado: 'enviado', p_detalle: null });
      return json_({ ok: true, enviado: true, certificados: folios.length, registro: !!(reg && reg.ok) });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    console.error(err);                       // el detalle queda en el registro del script, no se envía al navegador
    return json_({ ok: false, error: 'error_interno' });
  }
}

// ---------- Validación de certificados ----------
function validarCertificados_(lista) {
  if (!Array.isArray(lista) || lista.length < 1) return { ok: false, error: 'certificados_invalidos' };
  if (lista.length > MAX_CERTIFICADOS) return { ok: false, error: 'demasiados_certificados' };
  var porFolio = {}, total = 0;
  for (var i = 0; i < lista.length; i++) {
    var c = lista[i];
    if (!c || typeof c.folio !== 'string' || !/^[0-9]{1,9}$/.test(c.folio) || porFolio[c.folio] !== undefined) return { ok: false, error: 'certificados_invalidos' };
    var b = c.pdfBase64;
    if (typeof b !== 'string' || b.length < 100 || !/^[A-Za-z0-9+\/]+=*$/.test(b) || b.indexOf('JVBER') !== 0) return { ok: false, error: 'pdf_invalido' };  // «JVBER» = «%PDF» en Base64
    if (b.length > MAX_PDF_BASE64) return { ok: false, error: 'pdf_demasiado_grande' };
    total += b.length;
    if (total > MAX_TOTAL_BASE64) return { ok: false, error: 'adjuntos_excedidos' };
    // estructura: empieza con %PDF- y termina con %%EOF
    var bytes = Utilities.base64Decode(b);
    var cola = '';
    for (var k = Math.max(0, bytes.length - 1024); k < bytes.length; k++) cola += String.fromCharCode(bytes[k] & 255);
    if (cola.indexOf('%%EOF') < 0) return { ok: false, error: 'pdf_invalido' };
    porFolio[c.folio] = b;
  }
  return { ok: true, porFolio: porFolio };
}

// Los folios de los certificados deben ser exactamente los de las matrículas guardadas de la solicitud
function coinciden_(estudiantes, porFolio) {
  var claves = Object.keys(porFolio);
  if (claves.length !== estudiantes.length) return false;
  for (var i = 0; i < estudiantes.length; i++) {
    if (porFolio[String(estudiantes[i].folio)] === undefined) return false;
  }
  return true;
}

// ---------- Utilidades ----------
function configuracion_() {
  var entorno = propiedad_('ENTORNO', '');
  var url = propiedad_('SUPABASE_URL', ''), key = propiedad_('SUPABASE_KEY', ''), secreto = propiedad_('SECRETO_SCRIPT', '');
  if ((entorno !== 'prueba' && entorno !== 'produccion') || !url || !key || secreto.length < 20) return { ok: false };
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url)) return { ok: false };
  var autorizados = [];
  if (entorno === 'prueba') {
    if (url.indexOf(REF_PRODUCCION) >= 0) return { ok: false };   // el modo prueba nunca puede usar el proyecto real
    autorizados = propiedad_('DESTINATARIOS_PRUEBA', '').toLowerCase().split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    if (!autorizados.length) return { ok: false };               // sin lista de destinatarios autorizados no se envía nada
  }
  return { ok: true, entorno: entorno, url: url.replace(/\/$/, ''), key: key, secreto: secreto, autorizados: autorizados };
}

function rpc_(nombre, cuerpo) {
  var cfg = configuracion_();
  var r = UrlFetchApp.fetch(cfg.url + '/rest/v1/rpc/' + nombre, {
    method: 'post', contentType: 'application/json', headers: { apikey: cfg.key },
    payload: JSON.stringify(cuerpo), muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) return null;
  try { return JSON.parse(r.getContentText()); } catch (e) { return null; }
}

// Devuelve la solicitud a «error» para poder reintentar (el correo NO salió)
function liberar_(cfg, solicitudId, codigo) {
  rpc_('registrar_envio', { p_secreto: cfg.secreto, p_solicitud: solicitudId, p_resultado: 'error', p_detalle: codigo });
}

function motivoAError_(m) {
  switch (m) {
    case 'sesion': return 'sesion_invalida';
    case 'no_encontrada': return 'no_encontrada';
    case 'no_guardada': return 'solicitud_no_guardada';
    case 'ya_enviado': return 'ya_enviado';
    case 'en_proceso': return 'en_proceso';
    case 'demasiados_reintentos': return 'demasiados_reintentos';
    case 'sin_correo': return 'sin_correo';
    case 'bloqueado': return 'bloqueado';
    default: return 'error_interno';        // «secreto» y otros: no se detalla al navegador
  }
}

function limpiar_(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, '').trim().substring(0, max);
}
function slug_(texto) {
  var t = limpiar_(String(texto || ''), 80);
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  t = t.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 30);
  return t || 'Estudiante';
}
function listaFolios_(folios) {
  if (folios.length === 1) return folios[0];
  return folios.slice(0, -1).join(', ') + ' y ' + folios[folios.length - 1];
}

function propiedad_(nombre, porDefecto) {
  var v = PropertiesService.getScriptProperties().getProperty(nombre);
  return v === null || v === '' ? porDefecto : v;
}
function hoy_() { return Utilities.formatDate(new Date(), 'America/Santiago', 'yyyy-MM-dd'); }
function hash_(texto) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto.toLowerCase())).substring(0, 10);
}
function estadoDelDia_() {
  var crudo = PropertiesService.getScriptProperties().getProperty('ESTADO_ENVIOS');
  var e = crudo ? JSON.parse(crudo) : null;
  if (!e || e.fecha !== hoy_()) e = { fecha: hoy_(), total: 0, destinos: {} };
  return e;
}
function guardarEstado_(e) { PropertiesService.getScriptProperties().setProperty('ESTADO_ENVIOS', JSON.stringify(e)); }

function yaEnviada_(id) {
  var crudo = PropertiesService.getScriptProperties().getProperty('ENVIADOS');
  return !!crudo && JSON.parse(crudo).indexOf(id) >= 0;
}
function recordarEnviada_(id) {
  var crudo = PropertiesService.getScriptProperties().getProperty('ENVIADOS');
  var lista = crudo ? JSON.parse(crudo) : [];
  lista.push(id);
  if (lista.length > MAX_ENVIADOS_RECORDADOS) lista = lista.slice(lista.length - MAX_ENVIADOS_RECORDADOS);
  PropertiesService.getScriptProperties().setProperty('ENVIADOS', JSON.stringify(lista));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
