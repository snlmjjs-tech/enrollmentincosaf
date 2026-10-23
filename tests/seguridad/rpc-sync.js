// Llamadas SÍNCRONAS a las funciones de la base local (para simular UrlFetchApp de Apps Script, que es síncrono).
const path = require('path');
const { Worker, MessageChannel, receiveMessageOnPort } = require('worker_threads');
function crearRpcSync(opts) {
  const sab = new SharedArrayBuffer(4), flag = new Int32Array(sab);
  const { port1, port2 } = new MessageChannel();
  const w = new Worker(path.join(__dirname, 'rpc-sync-worker.js'), { workerData: { opts, sab, port: port2 }, transferList: [port2] });
  function llamar(nombre, args, extra) {
    Atomics.store(flag, 0, 0);
    w.postMessage({ nombre, args, extra });
    Atomics.wait(flag, 0, 0, 20000);
    const m = receiveMessageOnPort(port1);
    if (!m) throw new Error('la base no respondió');
    return m.message;
  }
  return { llamar, cerrar: () => w.terminate() };
}
module.exports = { crearRpcSync };
