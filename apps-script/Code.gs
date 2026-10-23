/**
 * Envío del comprobante de matrícula — Google Apps Script
 * ---------------------------------------------------------------------------------------------
 * Esta es la versión SEGURA del script. A diferencia de la anterior:
 *   · NO usa un secreto escrito en la página web. Quien lo llama debe traer un token de sesión de
 *     funcionario, y el script lo comprueba contra Supabase (función validar_token).
 *   · El texto del correo lo arma el script. La página solo envía datos (nombre, folio…), por lo que
 *     nadie puede usar este servicio para enviar mensajes inventados.
 *   · Tiene un tope diario de correos y un máximo por destinatario.
 *
 * Cómo instalarlo (a mano, ver docs/seguridad/credenciales.md):
 *   1. script.google.com → abre el proyecto actual del correo → reemplaza TODO el código por este archivo.
 *   2. Configuración del proyecto (engranaje) → Propiedades del script → agrega:
 *        SUPABASE_URL      https://<tu-proyecto>.supabase.co
 *        SUPABASE_KEY      la clave pública (sb_publishable_...) — NO la clave secreta
 *        NOMBRE_COLEGIO    Instituto Comercial Alberto Valenzuela Llanos de San Fernando
 *        CORREO_CONTACTO   correo al que responderán los apoderados
 *        TELEFONO_CONTACTO teléfono del colegio
 *        DIRECCION_COLEGIO dirección del colegio
 *        LIMITE_DIARIO     (opcional) tope de correos por día; por defecto 100
 *   3. Implementar → Administrar implementaciones → lápiz → Versión: «Nueva versión» → Implementar.
 *      (Así la dirección /exec NO cambia y no hay que tocar la página.)
 *      Ejecutar como: Yo   ·   Quién tiene acceso: Cualquier persona
 */

var MAX_PDF_BASE64 = 400000;   // ~300 KB
var MAX_POR_DESTINATARIO = 2;  // correos por destinatario y día

function doGet() {
  return json_({ ok: true, servicio: 'comprobantes de matrícula' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || e.postData.length > 600000) return json_({ ok: false, error: 'solicitud_invalida' });
    var d = JSON.parse(e.postData.contents);

    // 1) Sesión de funcionario válida (se comprueba en Supabase en cada envío)
    if (typeof d.token !== 'string' || !/^[0-9a-f]{64}$/.test(d.token)) return json_({ ok: false, error: 'sesion_invalida' });
    var rol = validarToken_(d.token);
    if (rol !== 'interna' && rol !== 'admin') return json_({ ok: false, error: 'sesion_invalida' });

    // 2) Datos: solo texto corto y con formato esperado
    var to = limpiar_(d.to, 120);
    if (!/^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$/.test(to)) return json_({ ok: false, error: 'correo_invalido' });
    var folio = limpiar_(d.folio, 9);
    if (!/^[0-9]{1,9}$/.test(folio)) return json_({ ok: false, error: 'datos_invalidos' });
    var tipo = d.tipo === 'antiguo' ? 'antiguo' : 'nuevo';
    var nombreApoderado = limpiar_(d.nombreApoderado, 200);
    var nombreEstudiante = limpiar_(d.nombreEstudiante, 200);
    var rutEstudiante = limpiar_(d.rutEstudiante, 20);
    var cursoOProcedencia = limpiar_(d.cursoOProcedencia, 200);
    var fechaRegistro = limpiar_(d.fechaRegistro, 60);
    if (!nombreApoderado || !nombreEstudiante) return json_({ ok: false, error: 'datos_invalidos' });

    var adjuntos = [];
    if (d.pdfBase64) {
      if (typeof d.pdfBase64 !== 'string' || d.pdfBase64.length > MAX_PDF_BASE64 || !/^[A-Za-z0-9+\/=]+$/.test(d.pdfBase64) || d.pdfBase64.indexOf('JVBER') !== 0) {
        return json_({ ok: false, error: 'pdf_invalido' });   // «JVBER» = «%PDF» en base64
      }
      adjuntos.push(Utilities.newBlob(Utilities.base64Decode(d.pdfBase64), 'application/pdf', 'Certificado_matricula_ficha_' + folio + '.pdf'));
    }

    // 3) Límites: tope diario y máximo por destinatario
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var estado = estadoDelDia_();
      var tope = Math.min(parseInt(propiedad_('LIMITE_DIARIO', '100'), 10) || 100, 300);
      var clave = hash_(to);
      if (estado.total >= tope) return json_({ ok: false, error: 'limite_diario' });
      if ((estado.destinos[clave] || 0) >= MAX_POR_DESTINATARIO) return json_({ ok: false, error: 'limite_destinatario' });
      estado.total += 1;
      estado.destinos[clave] = (estado.destinos[clave] || 0) + 1;
      guardarEstado_(estado);
    } finally {
      lock.releaseLock();
    }

    // 4) Texto del correo, armado aquí
    var colegio = propiedad_('NOMBRE_COLEGIO', 'Instituto Comercial Alberto Valenzuela Llanos de San Fernando');
    var contacto = propiedad_('CORREO_CONTACTO', '');
    var telefono = propiedad_('TELEFONO_CONTACTO', '');
    var direccion = propiedad_('DIRECCION_COLEGIO', '');
    var cuerpo =
      'Estimado(a) ' + nombreApoderado + ':\n' +
      'Confirmamos la matrícula 2027 en ' + colegio + '.\n\n' +
      'Ficha: ' + folio + '\n' +
      'Estudiante: ' + nombreEstudiante + (rutEstudiante ? ' (RUT ' + rutEstudiante + ')' : '') + '\n' +
      'Tipo: ' + (tipo === 'nuevo' ? 'Estudiante nuevo' : 'Estudiante antiguo') + '\n' +
      (cursoOProcedencia ? (tipo === 'nuevo' ? 'Colegio de procedencia: ' : 'Curso 2027: ') + cursoOProcedencia + '\n' : '') +
      (fechaRegistro ? 'Fecha de registro: ' + fechaRegistro + '\n' : '') + '\n' +
      'Documentos firmados por el apoderado:\n' +
      '• Autorización de uso de imagen\n• Aceptación del Reglamento Interno\n• Autorización de salidas pedagógicas\n\n' +
      (adjuntos.length ? 'Se adjunta además el certificado de matrícula en PDF.\n\n' : '') +
      'Atentamente,\n' + colegio + '\n\n--\n' +
      'Este es un correo automático de confirmación de matrícula.\n' +
      (contacto ? 'Para consultas escriba a: ' + contacto + (telefono ? ' · Teléfono: ' + telefono : '') + '\n' : '') +
      colegio + (direccion ? ' · ' + direccion : '');

    var opciones = { to: to, subject: 'Confirmación de matrícula 2027 - Ficha ' + folio, body: cuerpo, name: colegio, attachments: adjuntos };
    if (contacto) opciones.replyTo = contacto;
    MailApp.sendEmail(opciones);
    return json_({ ok: true });
  } catch (err) {
    console.error(err);                       // el detalle queda en el registro del script, no se envía al navegador
    return json_({ ok: false, error: 'error_interno' });
  }
}

// ---------- Utilidades ----------

function validarToken_(token) {
  var url = propiedad_('SUPABASE_URL', '');
  var key = propiedad_('SUPABASE_KEY', '');
  if (!url || !key) throw new Error('Falta SUPABASE_URL o SUPABASE_KEY en las propiedades del script');
  var r = UrlFetchApp.fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/validar_token', {
    method: 'post', contentType: 'application/json', headers: { apikey: key },
    payload: JSON.stringify({ p_token: token }), muteHttpExceptions: true
  });
  if (r.getResponseCode() !== 200) return null;
  return JSON.parse(r.getContentText());     // "interna", "admin" o null
}

function limpiar_(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F<>]/g, '').trim().substring(0, max);
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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
