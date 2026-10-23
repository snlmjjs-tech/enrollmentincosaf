// Guardia de entorno: impide que los scripts de prueba se ejecuten por accidente contra PRODUCCIÓN.
//  · Las pruebas automatizadas solo hablan con un Postgres LOCAL (127.0.0.1) y con servicios simulados.
//  · El identificador del proyecto real de producción está bloqueado en todas las herramientas.
// El identificador de un proyecto (la parte antes de «.supabase.co») es un dato público: no es un secreto.
const REF_PRODUCCION = 'mtlunrefaxsagfkphvvw';

function esProduccion(texto) { return String(texto || '').toLowerCase().includes(REF_PRODUCCION); }

// Aborta si el servidor de base de datos no es local o si alguna variable de entorno apunta a producción
function exigirBaseLocal(host, puerto) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(String(host))) {
    console.error(`ABORTADO: las pruebas automatizadas solo pueden usar una base LOCAL (se pidió ${host}:${puerto}).`);
    process.exit(3);
  }
  exigirSinProduccionEnEntorno();
}

function exigirSinProduccionEnEntorno() {
  const culpables = Object.entries(process.env).filter(([k, v]) => /SUPABASE|DATABASE|PG|URL|HOST/i.test(k) && esProduccion(v)).map(([k]) => k);
  if (culpables.length) {
    console.error(`ABORTADO: la variable ${culpables.join(', ')} apunta al proyecto de PRODUCCIÓN. Estas pruebas nunca deben usarlo.`);
    process.exit(3);
  }
}

// Para las herramientas que reciben la dirección de un Supabase de PRUEBAS (preparar-prueba.js)
function exigirProyectoDePrueba(url) {
  let u;
  try { u = new URL(url); } catch (e) { throw new Error('La dirección de Supabase no es válida.'); }
  if (u.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname)) {
    throw new Error('La dirección debe tener la forma https://<id-del-proyecto>.supabase.co');
  }
  if (esProduccion(u.hostname)) {
    throw new Error('Esa dirección es la de PRODUCCIÓN. Usa solo el proyecto de pruebas. No se hizo nada.');
  }
  return u.hostname.split('.')[0];
}

module.exports = { REF_PRODUCCION, esProduccion, exigirBaseLocal, exigirSinProduccionEnEntorno, exigirProyectoDePrueba };
