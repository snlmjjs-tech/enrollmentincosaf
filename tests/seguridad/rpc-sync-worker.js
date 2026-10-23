// Hilo auxiliar de rpc-sync.js: atiende las llamadas a la base (asíncronas) para que el script de Google simulado,
// que es síncrono, pueda esperar la respuesta.
const { workerData, parentPort } = require('worker_threads');
const { crearRpc } = require('./rpc-local');
const db = crearRpc(workerData.opts);
const flag = new Int32Array(workerData.sab);
parentPort.on('message', async ({ nombre, args, extra }) => {
  let respuesta;
  try { respuesta = { ok: true, data: await db.rpc(nombre, args, extra) }; }
  catch (e) { respuesta = { ok: false, mensaje: String(e.message || e) }; }
  workerData.port.postMessage(respuesta);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
});
