// Entorno de Google Apps Script SIMULADO: ejecuta apps-script/Code.gs real. Gmail no existe aquí (MailApp guarda el mensaje
// en memoria y NO envía nada). Supabase se atiende con las funciones SQL reales de un Postgres LOCAL a través de rpc-sync.
const vm = require('vm'), crypto = require('crypto');

function crearEntorno({ codigo, props, sync }) {
  const enviados = [], llamadas = [], store = Object.assign({}, props);
  const e = { enviados, llamadas, store, caido: false, mailFalla: false, forzar: {} };
  const resp = (cod, cuerpo) => ({ getResponseCode: () => cod, getContentText: () => JSON.stringify(cuerpo) });
  const ctx = {
    console: { error() {}, log() {} }, JSON, Math, Date, parseInt, RegExp, String, Number, Object, Array, Error,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ getContent: () => t, setMimeType() { return this; } }) },
    Utilities: {
      formatDate: d => d.toISOString().slice(0, 10), base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      newBlob: (b, tipo, nombre) => ({ tipo, nombre, bytes: b.length, datos: Buffer.from(b) }), base64EncodeWebSafe: b => Buffer.from(b).toString('base64url'),
      computeDigest: (alg, t) => crypto.createHash('sha256').update(t).digest(), DigestAlgorithm: { SHA_256: 'sha256' }
    },
    UrlFetchApp: { fetch: (url, o) => {
      const nombre = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url)[1]; const args = JSON.parse(o.payload);
      llamadas.push({ nombre, args, apikey: o.headers.apikey });
      if (e.caido) return resp(503, {});
      if (e.forzar[nombre]) return e.forzar[nombre](args);
      const r = sync.llamar(nombre, args, { ip: '203.0.113.5' });
      return r.ok ? resp(200, r.data === undefined ? null : r.data) : resp(400, { message: r.mensaje });
    } },
    MailApp: { sendEmail: o => { if (e.mailFalla) throw new Error('servicio de correo caído'); enviados.push(o); } }
  };
  vm.createContext(ctx); vm.runInContext(codigo + '\nthis.doPost=doPost;this.doGet=doGet;', ctx);
  e.ctx = ctx;
  e.post = obj => { const t = typeof obj === 'string' ? obj : JSON.stringify(obj); return JSON.parse(ctx.doPost({ postData: { length: t.length, contents: t } }).getContent()); };
  return e;
}
module.exports = { crearEntorno };
