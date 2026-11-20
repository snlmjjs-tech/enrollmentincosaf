/* PROTOTIPO (datos ficticios): cifrado de una ficha de matrícula con una llave pública y una privada.
 *
 *  · La llave PÚBLICA va en la página: solo sirve para cerrar (cifrar). Cualquiera puede verla sin riesgo.
 *  · La llave PRIVADA solo la tiene el colegio, dentro de un archivo protegido con una clave. Sirve para abrir.
 *  · Cada ficha se cifra con una llave AES-256 nueva (AES-GCM); esa llave se «envuelve» con la llave pública (RSA-OAEP 3072).
 *  · La ficha queda atada a su folio (dato autenticado): copiar el cifrado de una fila a otra hace que no abra.
 *  · Lo único que ve un extraño en la base de datos es: folio, fecha y texto ilegible.
 *
 * Usa solo la API estándar del navegador (WebCrypto); no carga nada de internet. Sirve también en Node 20+ para las pruebas.
 */
(function (raiz) {
  'use strict';
  const subtle = raiz.crypto && raiz.crypto.subtle;
  const enc = new TextEncoder(), dec = new TextDecoder();

  const ITERACIONES = 600000;                       // PBKDF2-SHA256 (recomendación actual de OWASP)
  const ITER_MIN = 100000, ITER_MAX = 5000000;      // límites al leer un archivo ajeno (evita archivos que cuelguen el navegador)
  const MIN_CLAVE = 12;
  const RSA = { name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const ALGORITMO = 'RSA-OAEP-3072+AES-256-GCM';

  const aB64 = buf => {
    const b = new Uint8Array(buf); let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const deB64 = s => {
    const bin = atob(s), b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b;
  };
  const aHex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
  const azar = n => raiz.crypto.getRandomValues(new Uint8Array(n));
  const falla = codigo => { const e = new Error(codigo); e.codigo = codigo; return e; };

  /* Identificador corto de una llave pública (huella): sirve para saber con qué llave se cifró. */
  async function huella(spki) { return aHex(await subtle.digest('SHA-256', spki)).slice(0, 16); }

  /* Reglas mínimas de la clave que protege la llave privada. */
  function validarClave(clave, opciones) {
    const o = opciones || {};
    if (typeof clave !== 'string' || !clave) return { ok: false, motivo: 'Escribe una clave.' };
    if (o.permitirDebil) return { ok: true, debil: clave.length < MIN_CLAVE };
    if (clave.length < MIN_CLAVE) return { ok: false, motivo: `La clave debe tener al menos ${MIN_CLAVE} caracteres. Usa 4 o 5 palabras al azar con guiones.` };
    if (/^\d+$/.test(clave)) return { ok: false, motivo: 'La clave no puede ser solo números.' };
    if (new Set(clave).size < 5) return { ok: false, motivo: 'La clave es demasiado repetitiva.' };
    return { ok: true, debil: false };
  }

  async function llaveDeClave(clave, sal, iteraciones) {
    const base = await subtle.importKey('raw', enc.encode(clave), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt: sal, iterations: iteraciones, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* Crea la llave del colegio. Devuelve el archivo que se descarga (privada protegida por la clave) y los datos públicos. */
  async function crearLlaveColegio(clave, opciones) {
    const v = validarClave(clave, opciones);
    if (!v.ok) throw falla('clave_no_valida:' + v.motivo);
    const par = await subtle.generateKey(RSA, true, ['encrypt', 'decrypt']);
    const spki = new Uint8Array(await subtle.exportKey('spki', par.publicKey));
    const pkcs8 = await subtle.exportKey('pkcs8', par.privateKey);
    const kid = await huella(spki);
    const sal = azar(16), iv = azar(12);
    const k = await llaveDeClave(clave, sal, ITERACIONES);
    const cifrada = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('llave-privada|' + kid) }, k, pkcs8);
    new Uint8Array(pkcs8).fill(0);
    return {
      archivo: {
        tipo: 'llave-del-colegio', v: 1, kid, publica: aB64(spki),
        privada: { kdf: 'PBKDF2-SHA256', iteraciones: ITERACIONES, sal: aB64(sal), iv: aB64(iv), datos: aB64(cifrada) }
      },
      publica: { kid, publica: aB64(spki) }
    };
  }

  /* Abre el archivo de llave con la clave. La llave privada queda solo en memoria y NO se puede exportar. */
  async function abrirLlave(archivo, clave) {
    let a = archivo;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { throw falla('archivo_no_valido'); } }
    if (!a || a.tipo !== 'llave-del-colegio' || a.v !== 1 || typeof a.kid !== 'string' || typeof a.publica !== 'string' || !a.privada) throw falla('archivo_no_valido');
    const p = a.privada;
    if (p.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(p.iteraciones) || p.iteraciones < ITER_MIN || p.iteraciones > ITER_MAX) throw falla('archivo_no_valido');
    let pkcs8;
    try {
      const k = await llaveDeClave(String(clave || ''), deB64(p.sal), p.iteraciones);
      pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: deB64(p.iv), additionalData: enc.encode('llave-privada|' + a.kid) }, k, deB64(p.datos));
    } catch (e) { throw falla('clave_incorrecta'); }
    try {
      const privada = await subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
      new Uint8Array(pkcs8).fill(0);
      return { kid: a.kid, privada };
    } catch (e) { throw falla('archivo_no_valido'); }
  }

  /* Cifra una ficha con la llave pública. «folio» queda atado al cifrado. */
  async function cifrarFicha(ficha, publica, folio) {
    const spki = deB64(publica.publica);
    if (await huella(spki) !== publica.kid) throw falla('llave_publica_no_valida');
    const pub = await subtle.importKey('spki', spki, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const kAes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = azar(12);
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(`folio:${folio}|kid:${publica.kid}`) }, kAes, enc.encode(JSON.stringify(ficha)));
    const crudo = await subtle.exportKey('raw', kAes);
    const envuelta = await subtle.encrypt({ name: 'RSA-OAEP' }, pub, crudo);
    new Uint8Array(crudo).fill(0);
    return { v: 1, alg: ALGORITMO, kid: publica.kid, ck: aB64(envuelta), iv: aB64(iv), ct: aB64(ct) };
  }

  /* Descifra una ficha con la llave del colegio ya abierta. Cualquier cambio o error: «no_se_puede_abrir». */
  async function descifrarFicha(paquete, llave, folio) {
    if (!paquete || paquete.v !== 1 || paquete.alg !== ALGORITMO) throw falla('no_se_puede_abrir');
    if (paquete.kid !== llave.kid) throw falla('llave_distinta');
    try {
      const crudo = await subtle.decrypt({ name: 'RSA-OAEP' }, llave.privada, deB64(paquete.ck));
      const kAes = await subtle.importKey('raw', crudo, 'AES-GCM', false, ['decrypt']);
      new Uint8Array(crudo).fill(0);
      const pt = await subtle.decrypt({ name: 'AES-GCM', iv: deB64(paquete.iv), additionalData: enc.encode(`folio:${folio}|kid:${paquete.kid}`) }, kAes, deB64(paquete.ct));
      return JSON.parse(dec.decode(pt));
    } catch (e) { throw falla('no_se_puede_abrir'); }
  }

  const API = { ITERACIONES, MIN_CLAVE, ALGORITMO, validarClave, crearLlaveColegio, abrirLlave, cifrarFicha, descifrarFicha };
  raiz.Cifrado = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : self);
