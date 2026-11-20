/* PROTOTIPO (datos ficticios): pantalla de demostración del cifrado. La «base de datos» es simulada en este navegador. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.Cifrado;

  /* ---------- «Base de datos» simulada (localStorage; si no está disponible, memoria) ---------- */
  const memoria = {};
  const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { memoria[k] = v; } };
  const leer = (k, def) => { try { const x = localStorage.getItem(k); return x === null ? (k in memoria ? memoria[k] : def) : JSON.parse(x); } catch (e) { return k in memoria ? memoria[k] : def; } };
  const leerBd = () => { const b = leer('proto_bd', []); return Array.isArray(b) ? b : []; };

  const mensaje = (id, texto, tipo) => { const el = $(id); el.textContent = texto || ''; el.className = 'msg' + (tipo ? ' ' + tipo : ''); };
  const celda = (tr, texto, clase) => { const td = document.createElement('td'); td.textContent = texto == null ? '' : String(texto); if (clase) td.className = clase; tr.appendChild(td); return td; };

  /* ---------- Pestañas y ojo para ver la clave ---------- */
  function mostrarPestana(nombre) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('activa', t.dataset.tab === nombre));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('visible', p.id === 'p-' + nombre));
    if (nombre === 'bd') pintarBd();
  }
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => mostrarPestana(t.dataset.tab)));
  document.querySelectorAll('.ojo').forEach(b => b.addEventListener('click', () => {
    const inp = $(b.dataset.ojo), ver = inp.type === 'password';
    inp.type = ver ? 'text' : 'password';
    b.setAttribute('aria-pressed', ver ? 'true' : 'false');
    b.setAttribute('aria-label', ver ? 'Ocultar clave' : 'Mostrar clave');
  }));

  /* ---------- 1 · Llave del colegio ---------- */
  let archivoLlave = null;
  function pintarEstadoLlave() {
    const cfg = leer('proto_cfg', null);
    $('estadoLlave').textContent = cfg ? `Llave pública configurada en la página (huella ${cfg.kid}). Ya se pueden cifrar matrículas.` : 'Todavía no hay llave del colegio. Crea una para poder usar las otras pestañas.';
    $('estadoLlave').className = 'estado' + (cfg ? ' ok' : '');
  }
  $('btnCrearLlave').addEventListener('click', async () => {
    const c1 = $('clave1').value, c2 = $('clave2').value, debil = $('debil').checked;
    if (c1 !== c2) return mensaje('msgLlave', 'Las dos claves no coinciden.', 'err');
    const v = C.validarClave(c1, { permitirDebil: debil });
    if (!v.ok) return mensaje('msgLlave', v.motivo, 'err');
    $('btnCrearLlave').disabled = true; mensaje('msgLlave', 'Creando la llave… (puede tardar unos segundos)');
    try {
      const r = await C.crearLlaveColegio(c1, { permitirDebil: debil });
      guardar('proto_cfg', r.publica);
      archivoLlave = r.archivo;
      $('textoLlave').value = JSON.stringify(r.archivo); $('cajaTexto').hidden = false;
      $('textoPublica').value = 'window.LLAVE_PUBLICA_COLEGIO = ' + JSON.stringify(r.publica) + ';'; $('cajaPublica').hidden = false;
      $('btnDescargarLlave').hidden = false;
      mensaje('msgLlave', v.debil ? 'Llave creada con una clave CORTA: solo sirve para probar.' : 'Llave creada. Descarga el archivo y guárdalo en dos lugares.', v.debil ? 'err' : 'ok');
      $('clave1').value = ''; $('clave2').value = '';
      pintarEstadoLlave();
    } catch (e) { mensaje('msgLlave', 'No se pudo crear la llave.', 'err'); }
    $('btnCrearLlave').disabled = false;
  });
  $('btnDescargarLlave').addEventListener('click', () => {
    if (!archivoLlave) return;
    descargar(new Blob([JSON.stringify(archivoLlave, null, 2)], { type: 'application/json' }), 'llave-del-colegio.json');
  });
  /* Copiar al portapapeles; si el navegador no lo permite, se selecciona el texto para copiarlo a mano. */
  async function copiar(texto, area, idMsg) {
    try { await navigator.clipboard.writeText(texto); mensaje(idMsg, 'Copiado.', 'ok'); }
    catch (e) { area.hidden = false; area.focus(); area.select(); mensaje(idMsg, 'Selecciona el texto y cópialo (mantén pulsado y elige «Copiar»).', 'err'); }
  }
  $('btnCopiarLlave').addEventListener('click', () => copiar($('textoLlave').value, $('textoLlave'), 'msgCopiarLlave'));
  function descargar(blob, nombre) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* ---------- Copias de la llave para otras personas ---------- */
  let archivoCopia = null, nombreCopia = 'persona';
  $('btnCrearCopia').addEventListener('click', async () => {
    const texto = $('copiaTexto').value.trim(), c1 = $('copiaClave1').value, c2 = $('copiaClave2').value;
    if (!texto) return mensaje('msgCopia', 'Pega el texto de la llave actual.', 'err');
    if (c1 !== c2) return mensaje('msgCopia', 'Las dos claves nuevas no coinciden.', 'err');
    const v = C.validarClave(c1, { permitirDebil: $('debil').checked });
    if (!v.ok) return mensaje('msgCopia', v.motivo, 'err');
    $('btnCrearCopia').disabled = true; mensaje('msgCopia', 'Creando la copia…');
    try {
      archivoCopia = await C.copiarLlave(texto, $('copiaClaveActual').value, c1, { permitirDebil: $('debil').checked });
      nombreCopia = ($('copiaNombre').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) || 'persona';
      $('textoCopia').value = JSON.stringify(archivoCopia); $('cajaCopia').hidden = false; $('btnDescargarCopia').hidden = false;
      $('copiaClave1').value = ''; $('copiaClave2').value = ''; $('copiaClaveActual').value = '';
      mensaje('msgCopia', 'Copia creada. Descárgala (o copia su texto) y entrégala a esa persona junto con SU clave.', 'ok');
    } catch (e) { mensaje('msgCopia', e.codigo === 'clave_incorrecta' ? 'La clave actual no es correcta.' : e.codigo === 'archivo_no_valido' ? 'El texto no es una llave del colegio válida.' : 'No se pudo crear la copia.', 'err'); }
    $('btnCrearCopia').disabled = false;
  });
  $('btnDescargarCopia').addEventListener('click', () => { if (archivoCopia) descargar(new Blob([JSON.stringify(archivoCopia, null, 2)], { type: 'application/json' }), `llave-del-colegio-${nombreCopia}.json`); });

  /* ---------- 2 · Apoderado ---------- */
  const CAMPOS = ['nombre', 'rut', 'fnac', 'curso', 'pie', 'diag', 'salud', 'apo', 'aporut', 'cel', 'mail'];
  $('btnEjemplo').addEventListener('click', () => {
    const n = leerBd().length + 1;
    const ej = { nombre: `Estudiante de Prueba ${n}`, rut: '11.111.111-1', fnac: '2012-05-10', curso: '1° Medio A', pie: 'si', diag: 'Diagnóstico ficticio de prueba',
      salud: 'Ninguno', apo: `Apoderado de Prueba ${n}`, aporut: '12.345.678-5', cel: '+56 9 0000 0001', mail: 'apoderado@example.invalid' };
    CAMPOS.forEach(c => { $('f_' + c).value = ej[c]; });
  });
  $('formFicha').addEventListener('submit', async e => {
    e.preventDefault();
    const cfg = leer('proto_cfg', null);
    if (!cfg) return mensaje('msgFicha', 'Primero crea la llave del colegio (pestaña 1).', 'err');
    const v = {}; CAMPOS.forEach(c => { v[c] = $('f_' + c).value.trim(); });
    if (!v.nombre || !v.rut || !v.apo || !v.aporut) return mensaje('msgFicha', 'Faltan datos: nombre y RUT del estudiante y del apoderado.', 'err');
    const bd = leerBd(), folio = bd.reduce((m, r) => Math.max(m, r.folio), 0) + 1;
    const ficha = {
      estudiante: { nombre: v.nombre, rut: v.rut, fnac: v.fnac, curso: v.curso, pie: v.pie, pieDiagnostico: v.diag, salud: v.salud },
      apoderado: { nombre: v.apo, rut: v.aporut, celular: v.cel, correo: v.mail }
    };
    try {
      const paquete = await C.cifrarFicha(ficha, cfg, 'folio:' + folio);
      bd.push({ folio, creada: new Date().toISOString(), cifrado: paquete });
      guardar('proto_bd', bd);
      CAMPOS.forEach(c => { $('f_' + c).value = c === 'pie' ? 'no' : ''; });
      mensaje('msgFicha', '');
      $('folioEnviado').textContent = String(folio);
      $('vistaEnviada').textContent = JSON.stringify(paquete).slice(0, 360) + '…';
      $('resultadoEnvio').hidden = false;
    } catch (err) { mensaje('msgFicha', 'No se pudo cifrar. Revisa la llave del colegio.', 'err'); }
  });

  /* ---------- 3 · Base de datos (vista de un extraño) ---------- */
  function pintarBd() {
    const tb = $('tablaBd').tBodies[0]; tb.replaceChildren();
    const bd = leerBd(), q = $('buscaBd').value.trim().toLowerCase();
    let coincidencias = 0;
    bd.forEach(r => {
      const texto = JSON.stringify(r).toLowerCase();
      if (q && texto.includes(q)) coincidencias++;
      const tr = document.createElement('tr');
      celda(tr, r.folio); celda(tr, r.creada.replace('T', ' ').slice(0, 19)); celda(tr, r.cifrado.kid);
      celda(tr, JSON.stringify(r.cifrado).slice(0, 260) + '…', 'cifrado');
      tb.appendChild(tr);
    });
    if (!bd.length) { const tr = document.createElement('tr'); celda(tr, 'La base está vacía. Envía una matrícula en la pestaña 2.').colSpan = 4; tb.appendChild(tr); }
    if (q) mensaje('resBusquedaBd', coincidencias ? `Se encontraron ${coincidencias} filas.` : `No se encontró «${$('buscaBd').value.trim()}» en ninguna fila: los datos no se pueden leer sin la llave.`, coincidencias ? 'err' : 'ok');
    else mensaje('resBusquedaBd', '');
  }
  $('buscaBd').addEventListener('input', pintarBd);
  $('btnVaciarBd').addEventListener('click', () => { guardar('proto_bd', []); pintarBd(); });

  /* ---------- 4 · Panel del colegio ---------- */
  let llave = null, claros = [], temporizador = null;
  const MINUTOS_BLOQUEO = 10;
  const reiniciarBloqueo = () => { clearTimeout(temporizador); if (llave) temporizador = setTimeout(bloquear, MINUTOS_BLOQUEO * 60000); };
  ['click', 'keydown', 'input'].forEach(ev => document.addEventListener(ev, reiniciarBloqueo));

  function bloquear() {
    llave = null; claros = []; clearTimeout(temporizador);
    $('tablaPanel').tBodies[0].replaceChildren(); $('buscaPanel').value = ''; mensaje('resPanel', '');
    $('textoTabla').value = ''; $('textoTabla').hidden = true;
    $('abierto').hidden = true; $('bloqueado').hidden = false;
  }
  $('btnBloquear').addEventListener('click', bloquear);

  const MENSAJES = { archivo_no_valido: 'El archivo no es una llave del colegio válida.', clave_incorrecta: 'Clave incorrecta, o el archivo está dañado.', llave_distinta: 'Hay matrículas cifradas con otra llave; este archivo no las abre.' };
  $('btnAbrir').addEventListener('click', async () => {
    const f = $('archivoLlave').files[0], pegado = $('pegarLlave').value.trim(), clave = $('claveAbrir').value;
    if (!f && !pegado) return mensaje('msgAbrir', 'Elige el archivo de llave o pega su texto.', 'err');
    if ((f && f.size > 20000) || pegado.length > 20000) return mensaje('msgAbrir', 'El archivo no es una llave del colegio válida.', 'err');
    $('btnAbrir').disabled = true; mensaje('msgAbrir', 'Abriendo… (puede tardar un par de segundos)');
    try {
      const abierta = await C.abrirLlave(f ? await f.text() : pegado, clave);
      const filas = [];
      for (const r of leerBd()) {
        try { filas.push({ folio: r.folio, ficha: await C.descifrarFicha(r.cifrado, abierta, 'folio:' + r.folio) }); }
        catch (e) { filas.push({ folio: r.folio, ficha: null, error: MENSAJES[e.codigo] || 'No se pudo abrir esta matrícula.' }); }
      }
      llave = abierta; claros = filas;
      $('claveAbrir').value = ''; $('archivoLlave').value = ''; $('pegarLlave').value = ''; mensaje('msgAbrir', '');
      $('bloqueado').hidden = true; $('abierto').hidden = false;
      pintarPanel(); reiniciarBloqueo();
    } catch (e) { mensaje('msgAbrir', MENSAJES[e.codigo] || 'No se pudo abrir.', 'err'); }
    $('btnAbrir').disabled = false;
  });

  function filaPlana(x) {
    const E = x.ficha.estudiante || {}, A = x.ficha.apoderado || {};
    return { Folio: x.folio, Estudiante: E.nombre, RUT: E.rut, 'Fecha de nacimiento': E.fnac, Curso: E.curso, PIE: E.pie === 'si' ? 'Sí' : 'No',
      'Diagnóstico PIE': E.pieDiagnostico, Salud: E.salud, Apoderado: A.nombre, 'RUT apoderado': A.rut, Celular: A.celular, Correo: A.correo };
  }
  function visibles() {
    const q = $('buscaPanel').value.trim().toLowerCase();
    return claros.filter(x => x.ficha && (!q || Object.values(filaPlana(x)).join(' ').toLowerCase().includes(q)));
  }
  function pintarPanel() {
    const tb = $('tablaPanel').tBodies[0]; tb.replaceChildren();
    claros.filter(x => !x.ficha).forEach(x => { const tr = document.createElement('tr'); celda(tr, x.folio); celda(tr, x.error).colSpan = 7; tb.appendChild(tr); });
    const lista = visibles();
    lista.forEach(x => {
      const p = filaPlana(x), tr = document.createElement('tr');
      [p.Folio, p.Estudiante, p.RUT, p.Curso, p.PIE, p.Apoderado, p.Celular, p.Correo].forEach(t => celda(tr, t));
      tb.appendChild(tr);
    });
    mensaje('resPanel', claros.length ? `${lista.length} de ${claros.length} matrículas.` : 'No hay matrículas guardadas.');
  }
  $('buscaPanel').addEventListener('input', pintarPanel);

  $('btnCopiarTabla').addEventListener('click', () => {
    if (!llave) return;
    const filas = visibles().map(filaPlana);
    if (!filas.length) return mensaje('resPanel', 'No hay filas para copiar.', 'err');
    const cols = Object.keys(filas[0]), limpia = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');
    const tsv = [cols.join('\t')].concat(filas.map(f => cols.map(c => limpia(f[c])).join('\t'))).join('\n');
    $('textoTabla').value = tsv;
    copiar(tsv, $('textoTabla'), 'resPanel');
  });
  $('btnExcel').addEventListener('click', () => {
    if (!llave) return;
    const filas = visibles().map(filaPlana);
    if (!filas.length) return mensaje('resPanel', 'No hay filas para exportar.', 'err');
    const hoja = XLSX.utils.json_to_sheet(filas), libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Matrículas');
    const bytes = XLSX.write(libro, { bookType: 'xlsx', type: 'array' });
    descargar(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'matriculas-prototipo.xlsx');
  });

  pintarEstadoLlave();
})();
