/* ==========================================================
   ⚙️ CONFIGURACIÓN — completa estos datos antes de usar
   ========================================================== */
const NOMBRE_COLEGIO = "Instituto Comercial Alberto Valenzuela Llanos de San Fernando";
const CONTACTO_COLEGIO = { correo: "lissette.maldonado@slepcolchagua.cl", telefono: "72 2847263", direccion: "Av. Manso de Velasco 389, San Fernando" };
const LOGO_SRC = document.querySelector(".logo-header").src; // reutiliza el mismo logo del encabezado en los documentos impresos
// jsPDF necesita el logo como imagen ya cargada: se prepara una vez al iniciar
const LOGO_IMG = new Image();
LOGO_IMG.src = LOGO_SRC;

// 1) Supabase: pega aquí la URL y la clave PÚBLICA (anon) de TU proyecto
//    (Supabase → Project Settings → API). Nunca pegues aquí la clave service_role.
//    La base se crea ejecutando supabase/schema.sql en el SQL Editor; la clave del
//    panel de encargados se define ahí y se valida en el servidor.
const SUPABASE_URL = "https://mtlunrefaxsagfkphvvw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bjKNRfhy3hQgXnE8wzvDSw_6Wpfu1CI"; // clave pública (publishable): segura en el navegador porque las tablas no son accesibles directamente

// 2) Envío del comprobante al apoderado (Google Apps Script + Gmail).
//    Aquí va SOLO la dirección del script. No hay ningún secreto en este archivo: el script comprueba
//    que quien lo llama tenga una sesión de funcionario válida (ver apps-script/Code.gs).
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyuK1KURduUz0Nvrodo_fT4gkMI-Sy4Wn9AUg7yN12QYa-8sIfU8T-XvkA4E-f2QCJHtw/exec";
/* ========================================================== */

let sb = null;
try {
  if (!SUPABASE_URL.includes("PEGA_AQUI") && !SUPABASE_ANON_KEY.includes("PEGA_AQUI")) {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch(e){ console.error("Supabase:", e); }

/* ---------- Seguridad: texto seguro en la página ----------
   Todo dato que viene de personas (nombres, direcciones, observaciones, mensajes del servidor…) se trata
   como TEXTO. Nunca se inserta como HTML sin pasar por esc() o por la plantilla h`...`, que escapa
   automáticamente cada valor interpolado. */
class Seguro { constructor(t){ this.t = t; } toString(){ return this.t; } }
const ESCAPES = { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" };
function esc(v){ return String(v ?? "").replace(/[&<>"']/g, c => ESCAPES[c]); }
function h(partes, ...valores){
  let out = partes[0];
  valores.forEach((v, i) => {
    const t = v instanceof Seguro ? v.t
            : Array.isArray(v) ? v.map(x => x instanceof Seguro ? x.t : esc(x)).join("")
            : esc(v);
    out += t + partes[i + 1];
  });
  return new Seguro(out);
}
// Crea un elemento con texto seguro (para armar tablas y listas sin innerHTML)
function el(etiqueta, props = {}, ...hijos){
  const e = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props)){
    if (k === "texto") e.textContent = v;
    else if (k === "datos") for (const [d, dv] of Object.entries(v)) e.dataset[d] = dv;
    else e.setAttribute(k, v);
  }
  hijos.forEach(x => e.append(x));
  return e;
}

/* ---------- Varios estudiantes en una solicitud: ayudantes ----------
   El estudiante 1 usa los campos de siempre (e_nombre, e_rut…). Los estudiantes 2 a 5 son copias de ese bloque con
   los campos renombrados (e2_nombre, e2_rut…). Los datos del apoderado y del suplente existen una sola vez. */
const $ = id => document.getElementById(id);
const eid = (n, campo) => n === 1 ? `e_${campo}` : `e${n}_${campo}`;          // id de un campo del estudiante n
const gname = (n, grupo) => n === 1 ? grupo : `${grupo}${n}`;                   // nombre del grupo de radios (rep, pie, pieDoc, salud)
const bloques = () => [...document.querySelectorAll("#ficha .est-bloque")].map(b => +b.dataset.n);   // estudiantes en pantalla, en orden
const tipoDe = n => document.querySelector(`input[name="tipo_${n}"]:checked`)?.value || "";
const PARENTESCOS = ["Madre", "Padre", "Abuelo(a)", "Hermano(a)", "Tío(a)", "Tutor(a) legal", "Otro"];

// Mensajes del servidor que sí se muestran tal cual (están escritos para el usuario). Cualquier otro
// error de la base se registra en la consola y al usuario se le muestra un mensaje general.
const MENSAJES_SERVIDOR = /(folio_invalido|folio_en_uso|folio_duplicado|dato_invalido|demasiados_intentos|demasiadas_solicitudes|solicitud_invalida): (.*)/s;

// Llama a una función de la base (ver supabase/schema.sql) y lanza un Error legible si falla
async function rpc(nombre, args){
  if (!sb) throw new Error("Supabase no está configurado. Pega la URL y la clave anon al inicio de js/app.js.");
  const { data, error } = await sb.rpc(nombre, args || {});
  if (error) {
    const msg = String(error.message || "");
    if (/clave_incorrecta/.test(msg)) throw new Error("La sesión no es válida o venció. Cierra el acceso y vuelve a ingresar la clave.");
    const m = MENSAJES_SERVIDOR.exec(msg);
    if (m) throw new Error(m[2].trim());
    if (/sin_codigos_disponibles/.test(msg)) throw new Error("No hay códigos disponibles por ahora. Acércate al mesón de matrícula.");
    console.error("Error del servidor:", error);
    throw new Error("Ocurrió un problema al comunicarse con el servidor. Inténtalo nuevamente en unos minutos.");
  }
  return data;
}
// Sesiones. Las claves se cambian por un token al ingresar; la clave no se guarda ni se vuelve a enviar.
//  · tokenAdmin: panel de encargados (solo en memoria; dura 3 horas).
//  · tokenInterno: funcionarios (se guarda solo en esta pestaña; dura 12 horas).
let tokenAdmin = null;
let tokenInterno = null;
try{ tokenInterno = sessionStorage.getItem("tokenInterno"); }catch(e){}

const correoListo = !APPS_SCRIPT_URL.includes("PEGA_AQUI");

// Límites de la solicitud y del correo. Deben ser iguales a los del servidor (supabase/migraciones/002 y apps-script/Code.gs);
// aquí se comprueban ANTES de enviar para avisar de inmediato. Justificación: docs/multiple/LIMITES.md
const MAX_ESTUDIANTES = 5;
const MAX_PDF_BASE64 = 250000;       // por certificado (un certificado comprimido mide ≈ 120 000)
const MAX_TOTAL_BASE64 = 1000000;    // suma de los certificados de una solicitud

let tipoEstudiante = "nuevo";       // condición (nuevo / antiguo) del estudiante 1
let fichaActual = null;             // = fichasActuales[0] (se mantiene por compatibilidad)
let fichasActuales = [];            // una ficha por estudiante de la solicitud en curso
let solicitudActual = null;         // { id, cantidad, folios, guardada }: el id permite reintentar sin duplicar
let solicitudGuardada = null;       // { id, fichas } tras guardar (para reintentar el correo)
let solicitudPendiente = null;      // datos de la solicitud mientras se muestra el resumen
let proximoN = 2;                   // número interno del siguiente estudiante adicional
let quitarPendiente = null;
let finalizando = false;
let yaImprimio = false;
let codigoPreCargado = null;
let registros = [];
let registrosVisibles = [];
let claveEliminarPendiente = null;
let editandoKey = null;
let editandoOriginal = null;

/* ---------- Nómina de alumnos 2026 (autocompletar comuna de estudiantes antiguos) ---------- */
let nomina2026 = null;
// ⚠️ Este archivo se serviría públicamente desde el sitio: NO lo publiques con datos reales de estudiantes.
//    (La búsqueda de estudiantes antiguos debería hacerse en el servidor, no con un archivo público.)
fetch("nomina2026.json").then(r => r.ok ? r.json() : null).then(datos => {
  if (!datos) return;
  nomina2026 = datos;
  const dl = document.getElementById("listaNomina2026");
  dl.replaceChildren(...Object.values(datos).map(a => el("option", { value: String(a.nombre ?? "") })));
}).catch(err => console.error("Nómina 2026:", err));

function buscarEnNomina(n = 1){
  if (tipoDe(n) !== "antiguo" || !nomina2026) return;
  const hint = $(eid(n, "nomina_hint"));
  const rutVal = $(eid(n, "rut")).value.trim();
  const nombreVal = $(eid(n, "nombre")).value.trim().toLowerCase();
  let alumno = null, rutKey = null;
  if (rutValido(rutVal)){
    rutKey = limpiarRut(rutVal);
    alumno = nomina2026[rutKey] || null;
  }
  if (!alumno && nombreVal){
    const encontrado = Object.entries(nomina2026).find(([,a]) => a.nombre.toLowerCase() === nombreVal);
    if (encontrado){ rutKey = encontrado[0]; alumno = encontrado[1]; }
  }
  if (!alumno){ hint.textContent = ""; hint.classList.remove("err"); return; }
  const eNombre = $(eid(n, "nombre"));
  if (!eNombre.value.trim()) eNombre.value = alumno.nombre;
  const eRut = $(eid(n, "rut"));
  if (!eRut.value.trim() && rutKey) eRut.value = formatearRut(rutKey);
  const eComuna = $(eid(n, "comuna"));
  if (!eComuna.value.trim() && alumno.comuna) eComuna.value = alumno.comuna;
  const retirado = alumno.estado === "Retirado";
  hint.classList.toggle("err", retirado);
  hint.textContent = `📋 Encontrado en la nómina 2026: ${alumno.nombre} — Curso 2026: ${alumno.curso || "—"} — Comuna: ${alumno.comuna || "—"}`
    + (retirado ? " — ⚠️ Figura como RETIRADO en 2026." : "");
}
document.getElementById("e_rut").addEventListener("blur", () => buscarEnNomina(1));
document.getElementById("e_nombre").addEventListener("blur", () => buscarEnNomina(1));

// Modo apoderado: se activa al abrir el link con ?apoderado (desde el QR)
const MODO_APODERADO = new URLSearchParams(location.search).has("apoderado");
if (MODO_APODERADO){
  document.addEventListener("DOMContentLoaded", ()=>{
    document.querySelector(".pre-row").style.display = "none";
    document.querySelector(".admin-link").style.display = "none";
    document.getElementById("btnSalir").style.display = "none";
    document.querySelector('#ficha button[type="submit"]').textContent = "Enviar pre-matrícula →";
    document.querySelector("header.app .brand p").textContent = "San Fernando · Pre-matrícula del apoderado";
  });
}

/* ---------- Navegación ---------- */
function mostrar(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({top:0});
}
function cerrar(id){ document.getElementById(id).classList.remove("show"); }
function abrir(id){ document.getElementById(id).classList.add("show"); }
// Muestra un aviso. «x» es TEXTO (o un resultado de h`...` cuando necesita negritas).
function aviso(t,x){
  document.getElementById("avisoTitulo").textContent = t;
  const cuerpo = document.getElementById("avisoTexto");
  if (x instanceof Seguro) cuerpo.innerHTML = x.t; else cuerpo.textContent = String(x ?? "");
  abrir("ovAviso");
}

function iniciarFicha(tipo){
  tipoEstudiante = tipo;
  codigoPreCargado = null;
  editandoKey = null;
  editandoOriginal = null;
  solicitudActual = null; solicitudGuardada = null; solicitudPendiente = null;
  quitarEstudiantesExtra();
  document.getElementById("ficha").reset();
  actualizarLugarTrabajo();
  document.querySelectorAll(".subfields").forEach(s=>s.classList.remove("show"));
  document.querySelectorAll("#ficha .bad").forEach(i=>i.classList.remove("bad"));
  ocultarErrores();
  document.getElementById("e_nomina_hint").textContent = "";
  document.getElementById("e_nomina_hint").classList.remove("err");
  fijarTipo(1, tipo);
  yaImprimio = false;
  actualizarEtiquetas();
  mostrar("scr-form");
}
function volverInicio(){ mostrar("scr-home"); }
function nuevaMatricula(){ mostrar("scr-home"); }

// «¿Dónde trabaja principalmente?» solo aparece si la persona trabaja
function actualizarLugarTrabajo(){
  const trabaja = document.getElementById("a_laboral").value.startsWith("Trabaja");
  document.getElementById("a_lugar_wrap").style.display = trabaja ? "" : "none";
  if (!trabaja) document.querySelectorAll('input[name="a_lugar"]').forEach(r => r.checked = false);
}

function toggleSub(grupo){
  const val = document.querySelector(`input[name="${grupo}"]:checked`)?.value;
  document.getElementById("sub_"+grupo).classList.toggle("show", val==="si");
}

/* ---------- Varios estudiantes: condición, añadir y quitar ---------- */
// Muestra los campos que corresponden a la condición del estudiante n (nuevo o antiguo)
function aplicarTipo(n, tipo){
  const b = $("est" + n);
  b.querySelectorAll(".solo-nuevo").forEach(x => x.style.display = tipo === "nuevo" ? "" : "none");
  b.querySelectorAll(".solo-antiguo").forEach(x => x.style.display = tipo === "antiguo" ? "" : "none");
  if (n === 1){
    tipoEstudiante = tipo || tipoEstudiante;
    $("tipoLabel").textContent = tipo === "nuevo" ? "Estudiante nuevo" : tipo === "antiguo" ? "Estudiante antiguo" : "";
  }
}
function fijarTipo(n, tipo){ setRadio(`tipo_${n}`, tipo); aplicarTipo(n, tipoDe(n)); }
function cambiarTipo(n){
  aplicarTipo(n, tipoDe(n));
  marcarGrupo(`tipo_${n}`, false);
  const hint = $(eid(n, "nomina_hint")); if (hint){ hint.textContent = ""; hint.classList.remove("err"); }
  buscarEnNomina(n);
}
// Resalta (o no) un grupo de botones de opción obligatorio
function marcarGrupo(nombre, malo){
  const r = document.querySelector(`input[name="${nombre}"]`);
  if (r) r.closest(".radio-row").classList.toggle("bad", malo);
}

function etiquetaEst(n){
  const i = bloques().indexOf(n) + 1;
  const nombre = ($(eid(n, "nombre")) || {}).value?.trim();
  return `Estudiante ${i}` + (nombre ? ` (${nombre})` : "");
}

// Crea la ficha del estudiante n copiando el bloque del estudiante 1 (sin sus datos) con los campos renombrados
function crearBloqueEstudiante(n){
  const c = $("est1").cloneNode(true);
  c.id = "est" + n; c.dataset.n = String(n); c.classList.add("est-extra");
  c.querySelectorAll("datalist").forEach(d => d.remove());
  c.querySelectorAll("[id]").forEach(x => { x.id = x.id.replace(/^e_/, `e${n}_`).replace(/^sub_(rep|pie|salud)$/, `sub_$1${n}`); });
  c.querySelectorAll("input[name]").forEach(x => {
    if (/^(rep|pie|pieDoc|salud)$/.test(x.name)) x.name += n;
    else if (x.name === "tipo_1") x.name = "tipo_" + n;
  });
  c.querySelectorAll("[data-args]").forEach(x => {
    try{
      const a = JSON.parse(x.dataset.args);
      x.dataset.args = JSON.stringify(a.map(v => (v === "rep" || v === "pie" || v === "salud") ? v + n : (x.dataset.change === "cambiarTipo" ? n : v)));
    }catch(e){}
  });
  // sin datos: vacío, sin marcas de error y con los sub-campos cerrados
  c.querySelectorAll("input,select,textarea").forEach(x => {
    if (x.type === "radio" || x.type === "checkbox") x.checked = false;
    else if (x.tagName === "SELECT") x.selectedIndex = 0;
    else x.value = "";
  });
  c.querySelectorAll(".bad").forEach(x => x.classList.remove("bad"));
  c.querySelectorAll(".subfields").forEach(x => x.classList.remove("show"));
  c.querySelectorAll(".hint").forEach(x => { if (/nomina_hint$/.test(x.id)) { x.textContent = ""; x.classList.remove("err"); } });
  // encabezado propio con el botón «Quitar»
  const leyenda = c.querySelector("legend");
  leyenda.replaceChildren(el("b", { class: "est-titulo", texto: `Estudiante ${n}` }));
  const cab = el("div", { class: "est-cab" },
    el("span", { class: "est-nombre-vista", id: `est${n}_vista`, texto: "" }),
    el("button", { type: "button", class: "est-quitar", texto: "Quitar este estudiante", datos: { click: "pedirQuitarEstudiante", args: JSON.stringify([n]) } }));
  leyenda.after(cab);
  // el parentesco y «vive con» pueden ser distintos para cada estudiante
  const grid = c.querySelector(".grid.c2");
  const selParent = el("select", { id: `e${n}_parentesco` },
    el("option", { value: "", texto: "Igual al indicado en los datos del apoderado" }), ...PARENTESCOS.map(x => el("option", { value: x, texto: x })));
  const selVive = el("select", { id: `e${n}_vive` },
    el("option", { value: "", texto: "Igual al indicado en los datos del apoderado" }), el("option", { value: "si", texto: "Sí" }), el("option", { value: "no", texto: "No" }));
  grid.append(
    el("div", { class: "field" }, el("label", { texto: "Parentesco del apoderado con este estudiante" }), selParent),
    el("div", { class: "field" }, el("label", { texto: "¿Vive con este estudiante?" }), selVive));
  $("estudiantesExtra").append(c);
  const rutInp = $(eid(n, "rut"));
  rutInp.addEventListener("input", () => { rutInp.value = formatearRut(rutInp.value); });
  rutInp.addEventListener("blur", () => buscarEnNomina(n));
  $(eid(n, "nombre")).addEventListener("blur", () => buscarEnNomina(n));
  $(eid(n, "nombre")).addEventListener("input", () => { const v = $(`est${n}_vista`); if (v) v.textContent = $(eid(n, "nombre")).value.trim(); });
  aplicarTipo(n, "");
  return n;
}
function anadirEstudiante(){
  if (editandoKey || bloques().length >= MAX_ESTUDIANTES) return;
  const n = crearBloqueEstudiante(proximoN++);
  actualizarEtiquetas();
  $("est" + n).scrollIntoView({ behavior: "smooth", block: "start" });
  $(eid(n, "nombre")).focus({ preventScroll: true });
}
function pedirQuitarEstudiante(n){
  if (!$("est" + n)) return;
  quitarPendiente = n;
  $("nombreQuitarEst").textContent = etiquetaEst(n);
  abrir("ovQuitarEst");
}
function confirmarQuitarEstudiante(){
  if (quitarPendiente && quitarPendiente !== 1 && $("est" + quitarPendiente)) $("est" + quitarPendiente).remove();
  quitarPendiente = null;
  cerrar("ovQuitarEst");
  actualizarEtiquetas();
}
function quitarEstudiantesExtra(){ $("estudiantesExtra").replaceChildren(); proximoN = 2; quitarPendiente = null; }

// Títulos «Estudiante N», contador, botón de añadir y texto del botón de envío
function actualizarEtiquetas(){
  const ns = bloques();
  ns.forEach((n, i) => {
    const t = document.querySelector(`#est${n} .est-titulo`);
    if (t) t.textContent = n === 1 ? (ns.length > 1 ? "Estudiante 1" : "Datos del estudiante") : `Estudiante ${i + 1}`;
  });
  const lleno = ns.length >= MAX_ESTUDIANTES;
  $("estAdd").style.display = editandoKey ? "none" : "";
  $("btnAddEst").disabled = lleno;
  $("estAddHint").textContent = lleno
    ? `Se alcanzó el máximo de ${MAX_ESTUDIANTES} estudiantes por solicitud. Para más hermanos, haz una solicitud nueva.`
    : ns.length > 1
      ? `Estudiantes en esta solicitud: ${ns.length} de ${MAX_ESTUDIANTES}. Los datos del apoderado se piden una sola vez, más abajo.`
      : `Si el apoderado tiene más hijos, puede matricularlos en esta misma solicitud (hasta ${MAX_ESTUDIANTES}). Los datos del apoderado se piden una sola vez.`;
  refrescarBotonEnviar();
}
function refrescarBotonEnviar(){
  const b = document.querySelector('#ficha button[type="submit"]');
  if (!b) return;
  b.textContent = editandoKey ? "Guardar cambios ✓"
    : MODO_APODERADO ? "Enviar pre-matrícula →"
    : bloques().length > 1 ? "Revisar la solicitud →"
    : "Generar documentos de matrícula →";
}
// Aviso de errores: indica el estudiante y los campos a corregir (los datos de los demás no se tocan)
function mostrarErrores(problemas){
  $("bannerDetalle").replaceChildren(...problemas.map(t => el("li", { texto: t })));
  $("bannerErr").classList.add("show");
}
function ocultarErrores(){ $("bannerDetalle").replaceChildren(); $("bannerErr").classList.remove("show"); }

/* ---------- RUT chileno: formato + dígito verificador ---------- */
function limpiarRut(r){ return r.replace(/[^0-9kK]/g,"").toUpperCase(); }
function formatearRut(r){
  r = limpiarRut(r);
  if (r.length<2) return r;
  const cuerpo = r.slice(0,-1), dv = r.slice(-1);
  return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g,".") + "-" + dv;
}
function rutValido(r){
  r = limpiarRut(r);
  if (r.length<7) return false;
  const cuerpo = r.slice(0,-1), dv = r.slice(-1);
  let suma=0, mult=2;
  for (let i=cuerpo.length-1;i>=0;i--){ suma += parseInt(cuerpo[i])*mult; mult = mult===7?2:mult+1; }
  const res = 11-(suma%11);
  const dvCalc = res===11?"0":res===10?"K":String(res);
  return dv===dvCalc;
}
["e_rut","a_rut","s_rut"].forEach(id=>{
  const inp=document.getElementById(id);
  inp.addEventListener("input",()=>{ inp.value = formatearRut(inp.value); });
});

/* ---------- Datos de prueba: escribir 2179 en el RUT del estudiante y salir del campo (profesores y apoderados) ---------- */
function llenarDatosPrueba(){
  const set = (id,val)=>{ document.getElementById(id).value = val; };
  set("e_nombre","Prueba de Matrículas"); set("e_rut","11.111.111-1"); set("e_fnac","2012-03-15");
  set("e_dir","Calle de Prueba 393"); set("e_comuna","San Fernando"); set("e_nacionalidad","Chilena");
  set("e_cel","393893"); set("e_mail","");
  if (tipoEstudiante==="nuevo"){ set("e_procedencia","Colegio de Prueba"); }
  else { set("e_cursoAnt","1° Medio"); set("e_letraAnt","A"); }
  ["rep","pie","salud"].forEach(g=>{ setRadio(g,"no"); toggleSub(g); });
  set("e_obs","Matrícula de prueba — borrar");
  set("a_nombre","Apoderado de Prueba"); set("a_rut","12.345.678-5"); set("a_edad","40");
  set("a_dir","Calle de Prueba 393"); set("a_comuna","San Fernando"); set("a_nacionalidad","Chilena");
  set("a_cel","393893"); set("a_mail","");
  set("a_parentesco","Madre"); setRadio("a_vive","si"); set("a_nivel","4° año de educación media Científico Humanista");
  set("a_laboral","Trabaja jornada completa (todo el día)"); actualizarLugarTrabajo(); setRadio("a_lugar","Fuera del hogar");
  setRadio("sup","si"); toggleSub("sup");
  set("s_nombre","Suplente de Prueba"); set("s_rut","18.516.142-0"); set("s_edad","38");
  set("s_dir","Calle de Prueba 393"); set("s_comuna","San Fernando"); set("s_nacionalidad","Chilena");
  set("s_cel","393893"); set("s_mail",""); set("s_parentesco","Padre"); setRadio("s_vive","no");
  document.querySelectorAll("input.bad,select.bad").forEach(i=>i.classList.remove("bad"));
  document.getElementById("e_nomina_hint").textContent = MODO_APODERADO
    ? "🧪 Datos de prueba cargados. Pulsa «Enviar pre-matrícula» al final para probar."
    : "🧪 Datos de prueba cargados. Escribe un correo en el apoderado para probar el envío del certificado.";
}
document.getElementById("e_rut").addEventListener("blur", ()=>{
  if (limpiarRut(document.getElementById("e_rut").value)==="2179") llenarDatosPrueba();
});

/* ---------- Validación ---------- */
function marcar(el, malo){ el.classList.toggle("bad", malo); return !malo; }

// Valida los campos del estudiante n; devuelve la lista de campos con problema (y los marca en rojo)
function validarEstudiante(n){
  const v = c => $(eid(n, c)).value.trim();
  const malos = [];
  const chk = (campo, etiqueta, malo) => { marcar($(eid(n, campo)), malo); if (malo) malos.push(etiqueta); };
  const grupo = (nombre, etiqueta) => {
    const falta = !document.querySelector(`input[name="${nombre}"]:checked`);
    marcarGrupo(nombre, falta); if (falta) malos.push(etiqueta);
  };
  const tipo = tipoDe(n);
  grupo(`tipo_${n}`, "Condición (nuevo o antiguo)");
  chk("nombre", "Nombre", !v("nombre"));
  chk("rut", "RUT", !rutValido(v("rut")));
  chk("fnac", "Fecha de nacimiento", !v("fnac"));
  chk("dir", "Dirección", !v("dir"));
  chk("comuna", "Comuna", !v("comuna"));
  chk("nacionalidad", "Nacionalidad", !v("nacionalidad"));
  chk("cel", "Celular", !v("cel"));
  if (tipo === "nuevo"){
    chk("procedencia", "Colegio de procedencia", !v("procedencia"));
  } else if (tipo === "antiguo"){
    chk("cursoAnt", "Curso", !v("cursoAnt"));
    chk("letraAnt", "Letra del curso", !v("letraAnt"));
  }
  // Radios obligatorios
  grupo(gname(n, "rep"), "¿Ha repetido algún curso?");
  grupo(gname(n, "pie"), "PIE");
  grupo(gname(n, "salud"), "¿Problema de salud?");
  const radio = g => document.querySelector(`input[name="${gname(n, g)}"]:checked`)?.value;
  if (radio("rep") === "si"){
    chk("repCurso", "Curso que repitió", !v("repCurso"));
    chk("repAnio", "Año en que repitió", !v("repAnio"));
  }
  if (radio("pie") === "si"){
    chk("pieDiag", "Diagnóstico PIE", !v("pieDiag"));
    grupo(gname(n, "pieDoc"), "Documentación PIE");
  }
  if (radio("salud") === "si") chk("saludDet", "Problema de salud", !v("saludDet"));
  return malos;
}

// Valida toda la solicitud. Devuelve { ok, problemas }: cada problema nombra al estudiante (o al apoderado) y los campos.
function validarFicha(){
  const problemas = [];
  bloques().forEach(n => { const m = validarEstudiante(n); if (m.length) problemas.push(`${etiquetaEst(n)}: ${m.join(", ")}`); });

  const v = id => document.getElementById(id).value.trim();
  const malosA = [];
  const chk = (id, etiqueta, malo, lista) => { marcar(document.getElementById(id), malo); if (malo) lista.push(etiqueta); };
  chk("a_nombre", "Nombre", !v("a_nombre"), malosA);
  chk("a_rut", "RUT", !rutValido(v("a_rut")), malosA);
  chk("a_edad", "Edad", !v("a_edad"), malosA);
  chk("a_dir", "Dirección", !v("a_dir"), malosA);
  chk("a_comuna", "Comuna", !v("a_comuna"), malosA);
  chk("a_nacionalidad", "Nacionalidad", !v("a_nacionalidad"), malosA);
  chk("a_cel", "Celular", !v("a_cel"), malosA);
  chk("a_parentesco", "Parentesco", !v("a_parentesco"), malosA);
  if (malosA.length) problemas.push(`Apoderado titular: ${malosA.join(", ")}`);

  // Suplente (si se registra)
  if (document.querySelector('input[name="sup"]:checked')?.value==="si"){
    const malosS = [];
    chk("s_nombre", "Nombre", !v("s_nombre"), malosS);
    chk("s_rut", "RUT", !rutValido(v("s_rut")), malosS);
    chk("s_edad", "Edad", !v("s_edad"), malosS);
    chk("s_dir", "Dirección", !v("s_dir"), malosS);
    chk("s_comuna", "Comuna", !v("s_comuna"), malosS);
    chk("s_nacionalidad", "Nacionalidad", !v("s_nacionalidad"), malosS);
    chk("s_cel", "Celular", !v("s_cel"), malosS);
    chk("s_parentesco", "Parentesco", !v("s_parentesco"), malosS);
    if (malosS.length) problemas.push(`Apoderado suplente: ${malosS.join(", ")}`);
  }
  // Caracteres no permitidos (< >): el servidor también los rechaza, pero así se avisa ANTES de generar los documentos
  const conSimbolos = new Map();
  document.querySelectorAll('#ficha input[type="text"], #ficha input[type="tel"], #ficha input[type="email"], #ficha textarea').forEach(campo => {
    const malo = /[<>]/.test(campo.value);
    if (campo.id === "sitio_web") return;
    if (!malo) return;
    campo.classList.add("bad");
    const bloque = campo.closest(".est-bloque");
    const quien = bloque ? etiquetaEst(+bloque.dataset.n) : /^s_/.test(campo.id) ? "Apoderado suplente" : "Apoderado titular";
    conSimbolos.set(quien, (conSimbolos.get(quien) || 0) + 1);
  });
  conSimbolos.forEach((n, quien) => problemas.push(`${quien}: los símbolos < y > no están permitidos (${n} campo${n > 1 ? "s" : ""})`));
  // RUT repetido entre estudiantes de la misma solicitud
  const vistos = new Map();
  bloques().forEach(n => {
    const r = limpiarRut($(eid(n, "rut")).value);
    if (r.length >= 7 && vistos.has(r)){ marcar($(eid(n, "rut")), true); problemas.push(`${etiquetaEst(n)}: el RUT está repetido (ya se usó en ${etiquetaEst(vistos.get(r))})`); }
    else if (r.length >= 7) vistos.set(r, n);
  });
  return { ok: problemas.length === 0, problemas };
}

/* ---------- Generar ficha + memos ---------- */
// Datos de un estudiante (n) tal como se guardan
function leerEstudiante(n){
  const v = c => $(eid(n, c)).value.trim();
  const radio = g => document.querySelector(`input[name="${gname(n, g)}"]:checked`)?.value || "";
  const tipo = tipoDe(n);
  return {
    tipo,
    estudiante: {
      nombre: v("nombre"), rut: v("rut"), fnac: v("fnac"), direccion: v("dir"),
      comuna: v("comuna"), nacionalidad: v("nacionalidad"),
      celular: v("cel"), correo: v("mail"),
      procedencia: tipo==="nuevo" ? v("procedencia") : "",
      cursoMatricula: tipo==="antiguo" ? (v("cursoAnt")+" "+v("letraAnt").toUpperCase()) : v("cursoNuevo"),
      repitencia: radio("rep"), repCurso: v("repCurso"), repAnio: v("repAnio"),
      pie: radio("pie"), pieDiagnostico: v("pieDiag"), pieDocumentacion: radio("pieDoc"),
      salud: radio("salud"), saludDetalle: v("saludDet"),
      observaciones: v("obs")
    }
  };
}
function leerApoderado(){
  const v = id => document.getElementById(id).value.trim();
  const radio = n => document.querySelector(`input[name="${n}"]:checked`)?.value || "";
  return { nombre: v("a_nombre"), rut: v("a_rut"), edad: v("a_edad"), direccion: v("a_dir"), comuna: v("a_comuna"), nacionalidad: v("a_nacionalidad"), celular: v("a_cel"), correo: v("a_mail"),
    parentesco: v("a_parentesco"), viveConEstudiante: radio("a_vive"), nivelEducacional: v("a_nivel"),
    situacionLaboral: v("a_laboral"), lugarTrabajo: v("a_laboral").startsWith("Trabaja") ? radio("a_lugar") : "" };
}
function leerSuplente(){
  const v = id => document.getElementById(id).value.trim();
  const radio = n => document.querySelector(`input[name="${n}"]:checked`)?.value || "";
  return radio("sup")==="si" ? { nombre: v("s_nombre"), rut: v("s_rut"), edad: v("s_edad"), direccion: v("s_dir"), comuna: v("s_comuna"), nacionalidad: v("s_nacionalidad"), celular: v("s_cel"), correo: v("s_mail"), parentesco: v("s_parentesco"), viveConEstudiante: radio("s_vive") } : null;
}
// Ficha de UN estudiante (estudiante 1): la usan la edición desde el panel y la pre-matrícula individual
function recolectarDatos(){
  return { ...leerEstudiante(1), apoderado: leerApoderado(), suplente: leerSuplente() };
}
// Solicitud completa: apoderado y suplente una sola vez + lista de estudiantes
function recolectarSolicitud(){
  return {
    apoderado: leerApoderado(),
    suplente: leerSuplente(),
    estudiantes: bloques().map(n => {
      const e = leerEstudiante(n);
      const x = { tipo: e.tipo, estudiante: e.estudiante };
      if (n !== 1){
        const p = $(eid(n, "parentesco")).value, vv = $(eid(n, "vive")).value;
        if (p) x.parentesco = p;
        if (vv) x.viveConEstudiante = vv;
      }
      return x;
    })
  };
}
// Fichas individuales (una por estudiante) a partir de la solicitud. Misma regla que la base de datos.
function fichasDeSolicitud(sol){
  return sol.estudiantes.map(x => {
    const apoderado = { ...sol.apoderado };
    if (x.parentesco) apoderado.parentesco = x.parentesco;
    if (x.viveConEstudiante) apoderado.viveConEstudiante = x.viveConEstudiante;
    return { tipo: x.tipo, estudiante: x.estudiante, apoderado, suplente: sol.suplente };
  });
}
function nuevoUuid(){
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

document.getElementById("ficha").addEventListener("submit", async e=>{
  e.preventDefault();
  const val = validarFicha();
  if (!val.ok){
    mostrarErrores(val.problemas);
    window.scrollTo({top:0,behavior:"smooth"});
    return;
  }
  ocultarErrores();
  const boton = e.target.querySelector('button[type="submit"]');

  // Modo edición: actualizar UNA matrícula existente (no se tocan sus hermanos)
  if (editandoKey){
    const datos = recolectarDatos();
    boton.disabled = true; boton.textContent = "Guardando…";
    try{
      await rpc("actualizar_matricula", { p_clave: tokenAdmin, p_id: editandoKey, p_ficha: { ...editandoOriginal, ...datos } });
      aviso("Cambios guardados", "Se actualizaron los datos de la matrícula.");
      editandoKey = null;
      editandoOriginal = null;
      cargarAdmin();
    }catch(err){
      aviso("No se pudo guardar", err.message);
    }finally{
      boton.disabled = false; refrescarBotonEnviar();
    }
    return;
  }

  const sol = recolectarSolicitud();

  // Modo apoderado: guardar pre-matrícula y mostrar código
  if (MODO_APODERADO){
    await guardarPrematricula(sol, boton);
    return;
  }

  // Varios estudiantes: primero el resumen para revisar
  if (sol.estudiantes.length > 1){ mostrarResumen(sol); return; }
  await prepararDocumentos(sol, boton);
});

// Pide los folios (uno por estudiante) y arma los documentos. Con el mismo id de solicitud los folios se reutilizan.
async function prepararDocumentos(sol, boton){
  const textoOriginal = boton.textContent;
  boton.disabled = true; boton.textContent = "Generando ficha…";
  try{
    const n = sol.estudiantes.length;
    if (!solicitudActual || solicitudActual.cantidad !== n || solicitudActual.guardada){
      solicitudActual = { id: nuevoUuid(), cantidad: n, folios: null, guardada: false };
    }
    const r = await rpc("reservar_folios", { p_clave: tokenInterno, p_solicitud: solicitudActual.id, p_cantidad: n });
    solicitudActual.folios = r.folios;
    const fecha = new Date().toLocaleString("es-CL");
    fichasActuales = fichasDeSolicitud(sol).map((f, i) => ({ folio: String(r.folios[i]), fechaRegistro: fecha, ...f }));
    fichaActual = fichasActuales[0];
    yaImprimio = false;
    renderMemos();
    mostrar("scr-memos");
  }catch(err){
    console.error("Folio:", err);
    aviso("No se pudo generar el número de ficha", "No fue posible pedir el folio a la base de datos. " + err.message);
  }finally{
    boton.disabled = false; boton.textContent = textoOriginal;
  }
}

/* ---------- Resumen de una solicitud con varios estudiantes ---------- */
function filaResumen(etiqueta, valor){
  return el("div", { class: "resumen-fila" }, el("b", { texto: etiqueta + ":" }), el("span", { texto: valor || "—" }));
}
function mostrarResumen(sol){
  solicitudPendiente = sol;
  const A = sol.apoderado;
  $("resumenApoderado").replaceChildren(el("div", { class: "resumen-card" },
    el("h3", { texto: "Apoderado titular (datos compartidos por todos los estudiantes)" }),
    filaResumen("Nombre", A.nombre), filaResumen("RUT", A.rut), filaResumen("Celular", A.celular),
    filaResumen("Correo (aquí llegará UN solo correo con todos los certificados)", A.correo || "No registrado: no se enviará correo"),
    filaResumen("Parentesco (general)", A.parentesco), sol.suplente ? filaResumen("Suplente", sol.suplente.nombre) : ""));
  const fichas = fichasDeSolicitud(sol), ns = bloques();
  $("resumenEstudiantes").replaceChildren(...sol.estudiantes.map((x, i) => {
    const E = x.estudiante, F = fichas[i];
    const pie = E.pie === "si" ? (E.pieDocumentacion === "si" ? "Documentación PIE entregada" : "Documentación PIE pendiente de entregar") : "No pertenece al PIE";
    return el("div", { class: "resumen-card" },
      el("h3", {}, el("span", { texto: `Estudiante ${i + 1}` }), document.createTextNode(E.nombre)),
      filaResumen("RUT", E.rut),
      el("div", { class: "resumen-fila" }, el("b", { texto: "Condición:" }), el("span", { class: "pill " + x.tipo, texto: x.tipo })),
      filaResumen("Curso 2027", E.cursoMatricula || "No indicado"),
      x.tipo === "nuevo" ? filaResumen("Colegio de procedencia", E.procedencia) : "",
      filaResumen("Parentesco con este estudiante", F.apoderado.parentesco),
      filaResumen("Documentos requeridos", `3 autorizaciones, ficha de antecedentes y certificado PDF (se generan al continuar). ${pie}.`),
      el("div", { class: "resumen-fila" }, el("b", { texto: "Validación:" }), el("span", { class: "estado ok", texto: "✔ Campos obligatorios completos" })),
      el("div", { class: "resumen-acciones" }, el("button", { type: "button", class: "btn btn-ghost", texto: "✏️ Editar este estudiante", datos: { click: "editarEstudianteResumen", args: JSON.stringify([ns[i]]) } })));
  }));
  mostrar("scr-resumen");
}
function editarEstudianteResumen(n){
  mostrar("scr-form");
  const b = $("est" + n);
  if (b) b.scrollIntoView({ behavior: "smooth", block: "start" });
}
async function confirmarResumen(){
  if (!solicitudPendiente) return;
  await prepararDocumentos(solicitudPendiente, $("btnConfirmarResumen"));
}

/* ---------- Pre-matrícula (apoderados vía QR) ---------- */
async function guardarPrematricula(sol, btn){
  btn.disabled = true; btn.textContent = "Enviando…";
  try{
    // Un estudiante: formato de siempre. Varios: una sola solicitud con todos (un solo código).
    const datos = sol.estudiantes.length === 1 ? fichasDeSolicitud(sol)[0] : sol;
    // «_hp» es un campo trampa invisible: las personas lo dejan vacío, algunos robots lo llenan
    const codigo = await rpc("crear_prematricula", { p_datos: { ...datos, _hp: document.getElementById("sitio_web").value } });
    // 6 caracteres se muestran como XXX-XXX; los códigos antiguos de 4 dígitos se muestran igual
    document.getElementById("codigoGrande").textContent = /^[A-Z2-9]{6}$/.test(codigo) ? codigo.slice(0,3) + "-" + codigo.slice(3) : codigo;
    mostrar("scr-codigo");
  }catch(err){
    aviso("No se pudo enviar", err.message);
  }finally{
    btn.disabled = false; refrescarBotonEnviar();
  }
}

function abrirCargarCodigo(){
  document.getElementById("inputCodigo").value = "";
  abrir("ovCodigo");
  setTimeout(()=>document.getElementById("inputCodigo").focus(),100);
}
document.getElementById("inputCodigo").addEventListener("keydown",e=>{ if(e.key==="Enter") cargarPrematricula(); });

async function cargarPrematricula(){
  const codigo = document.getElementById("inputCodigo").value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^([0-9]{4}|[A-Z0-9]{6})$/.test(codigo)){ aviso("Código inválido","Escribe el código completo que trae el apoderado (4 dígitos o 6 caracteres)."); return; }
  const btn = document.getElementById("btnBuscarCodigo");
  btn.disabled = true; btn.textContent = "Buscando…";
  try{
    const datos = await rpc("cargar_prematricula", { p_clave: tokenInterno, p_codigo: codigo });
    if (!datos){ aviso("Código no encontrado", h`No existe una pre-matrícula con el código <b>${codigo}</b>. Verifica con el apoderado.`); return; }
    cerrar("ovCodigo");
    llenarFicha(datos);
    codigoPreCargado = codigo;
  }catch(err){
    aviso("Error al buscar", err.message);
  }finally{
    btn.disabled = false; btn.textContent = "Cargar datos";
  }
}

function setRadio(nombre, valor){
  if (!valor) return;
  const el = document.querySelector(`input[name="${nombre}"][value="${valor}"]`);
  if (el){ el.checked = true; }
}
// Una ficha de siempre o una solicitud con varios estudiantes → siempre { apoderado, suplente, estudiantes:[…] }
function normalizarSolicitud(d){
  if (Array.isArray(d.estudiantes)) return { apoderado: d.apoderado || {}, suplente: d.suplente || null, estudiantes: d.estudiantes.slice(0, MAX_ESTUDIANTES) };
  return { apoderado: d.apoderado || {}, suplente: d.suplente || null, estudiantes: [{ tipo: d.tipo, estudiante: d.estudiante || {} }] };
}
// Rellena los campos del estudiante n con los datos x = { tipo, estudiante, parentesco?, viveConEstudiante? }
function llenarEstudiante(n, x){
  const E = x.estudiante || {};
  const set = (c, val) => { $(eid(n, c)).value = val || ""; };
  fijarTipo(n, x.tipo);
  set("nombre", E.nombre); set("rut", E.rut); set("fnac", E.fnac); set("dir", E.direccion);
  set("comuna", E.comuna); set("nacionalidad", E.nacionalidad);
  set("cel", E.celular); set("mail", E.correo); set("obs", E.observaciones);
  if (x.tipo === "nuevo"){ set("procedencia", E.procedencia); set("cursoNuevo", E.cursoMatricula); }
  else {
    const curso = (E.cursoMatricula || E.cursoAnterior || "").trim();
    const partes = curso.split(" ");
    const letra = partes.length>2 ? partes.pop() : "";
    set("cursoAnt", partes.join(" ")); set("letraAnt", letra);
  }
  const g = gname;
  setRadio(g(n,"rep"), E.repitencia); toggleSub(g(n,"rep")); set("repCurso", E.repCurso); set("repAnio", E.repAnio);
  setRadio(g(n,"pie"), E.pie); toggleSub(g(n,"pie")); set("pieDiag", E.pieDiagnostico); setRadio(g(n,"pieDoc"), E.pieDocumentacion);
  setRadio(g(n,"salud"), E.salud); toggleSub(g(n,"salud")); set("saludDet", E.saludDetalle);
  if (n !== 1){ $(eid(n, "parentesco")).value = x.parentesco || ""; $(eid(n, "vive")).value = x.viveConEstudiante || ""; const v = $(`est${n}_vista`); if (v) v.textContent = E.nombre || ""; }
}
function llenarFicha(d, mensaje){
  const sol = normalizarSolicitud(d);
  iniciarFicha(sol.estudiantes[0].tipo);
  const set = (id,val)=>{ document.getElementById(id).value = val || ""; };
  const A=sol.apoderado, S=sol.suplente;
  // estudiante 1 y los adicionales (si la pre-matrícula trae varios)
  for (let i = 1; i < sol.estudiantes.length; i++) crearBloqueEstudiante(proximoN++);
  const ns = bloques();
  sol.estudiantes.forEach((x, i) => llenarEstudiante(ns[i], x));
  set("a_nombre",A.nombre); set("a_rut",A.rut); set("a_edad",A.edad); set("a_dir",A.direccion);
  set("a_comuna",A.comuna); set("a_nacionalidad",A.nacionalidad);
  set("a_cel",A.celular); set("a_mail",A.correo);
  set("a_parentesco",A.parentesco); setRadio("a_vive",A.viveConEstudiante); set("a_nivel",A.nivelEducacional);
  set("a_laboral",A.situacionLaboral); actualizarLugarTrabajo(); setRadio("a_lugar",A.lugarTrabajo);
  setRadio("sup", S ? "si" : "no"); toggleSub("sup");
  if (S){
    set("s_nombre",S.nombre); set("s_rut",S.rut); set("s_edad",S.edad);
    set("s_dir",S.direccion); set("s_comuna",S.comuna); set("s_nacionalidad",S.nacionalidad);
    set("s_cel",S.celular); set("s_mail",S.correo); set("s_parentesco",S.parentesco); setRadio("s_vive",S.viveConEstudiante);
  }
  actualizarEtiquetas();
  aviso("Datos cargados", mensaje || (sol.estudiantes.length > 1
    ? `Se cargaron los datos de la pre-matrícula (${sol.estudiantes.length} estudiantes). Revísalos junto al apoderado antes de continuar.`
    : "Se cargaron los datos de la pre-matrícula. Revísalos junto al apoderado antes de generar los documentos."));
}

// Edita UNA matrícula (un estudiante). Sus hermanos de la misma solicitud no se tocan.
function editarMatricula(key){
  const r = registros.find(x => x._key === key);
  if (!r) return;
  llenarFicha(
    { tipo: r.tipo, estudiante: r.estudiante, apoderado: r.apoderado, suplente: r.suplente },
    "Se cargaron los datos de esta matrícula para editar. Corrige lo necesario y presiona «Guardar cambios»."
  );
  editandoKey = key;
  editandoOriginal = { folio: r.folio, fechaRegistro: r.fechaRegistro };
  actualizarEtiquetas();
}

function mostrarQR(){
  const url = location.origin + location.pathname + "?apoderado";
  const box = document.getElementById("qrBox");
  box.replaceChildren();
  if (location.protocol === "file:"){
    box.append(el("p", { style: "font-size:.8rem;color:var(--error)", texto: "⚠️ Estás abriendo el archivo localmente. El QR funcionará cuando la página esté subida a internet (GitHub Pages)." }));
  } else {
    new QRCode(box, { text: url, width: 200, height: 200 });
  }
  const link = document.getElementById("qrUrl");
  link.textContent = url;
  link.href = url;
  abrir("ovQR");
}

function copiarLinkApoderado(){
  const url = document.getElementById("qrUrl").textContent;
  const btn = document.getElementById("btnCopiarLink");
  const marcarCopiado = () => { const t = btn.textContent; btn.textContent = "✅ Copiado"; setTimeout(()=>btn.textContent = t, 1800); };
  if (navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(url).then(marcarCopiado).catch(()=> aviso("No se pudo copiar", "Copia el link manualmente: " + url));
  } else {
    const tmp = document.createElement("textarea");
    tmp.value = url; tmp.style.position = "fixed"; tmp.style.opacity = "0";
    document.body.appendChild(tmp); tmp.select();
    try { document.execCommand("copy"); marcarCopiado(); }
    catch(e){ aviso("No se pudo copiar", "Copia el link manualmente: " + url); }
    document.body.removeChild(tmp);
  }
}

function textosMemos(f){
  const A = f.apoderado, E = f.estudiante;
  const hoy = new Date().toLocaleDateString("es-CL",{day:"numeric",month:"long",year:"numeric"});
  return [
    { titulo:"Autorización de uso de imagen",
      cuerpo:h`Yo, <b>${A.nombre}</b>, RUT <b>${A.rut}</b>, en mi calidad de apoderado(a) titular del(la) estudiante <b>${E.nombre}</b>, RUT <b>${E.rut}</b>, autorizo expresamente al <b>${NOMBRE_COLEGIO}</b> a captar, utilizar y difundir la imagen de mi pupilo(a) en fotografías y registros audiovisuales tomados en el contexto de actividades académicas, deportivas, culturales y extraprogramáticas del establecimiento, para ser publicados en medios institucionales tales como la página web oficial, redes sociales, murales, boletines y material de difusión educativa.<br><br>Esta autorización se otorga de manera gratuita y voluntaria, exclusivamente con fines educativos e institucionales, y tendrá vigencia durante el año escolar 2027. Declaro conocer que puedo revocarla en cualquier momento mediante comunicación escrita dirigida a la Dirección del establecimiento.` },
    { titulo:"Aceptación del Reglamento Interno",
      cuerpo:h`Yo, <b>${A.nombre}</b>, RUT <b>${A.rut}</b>, apoderado(a) titular del(la) estudiante <b>${E.nombre}</b>, RUT <b>${E.rut}</b>, declaro haber tomado conocimiento del <b>Reglamento Interno y de Convivencia Escolar</b> del <b>${NOMBRE_COLEGIO}</b>, disponible en el establecimiento y en sus medios oficiales, y manifiesto mi plena conformidad y adhesión a sus normas, protocolos, derechos y deberes.<br><br>Me comprometo, junto a mi pupilo(a), a respetar y cumplir sus disposiciones durante el año escolar 2027, colaborando con el establecimiento en la formación integral del(la) estudiante y en la sana convivencia de la comunidad educativa.` },
    { titulo:"Autorización de salidas pedagógicas",
      cuerpo:h`Yo, <b>${A.nombre}</b>, RUT <b>${A.rut}</b>, apoderado(a) titular del(la) estudiante <b>${E.nombre}</b>, RUT <b>${E.rut}</b>, autorizo a mi pupilo(a) a participar en las <b>salidas pedagógicas</b> organizadas por el <b>${NOMBRE_COLEGIO}</b> durante el año escolar 2027, dentro y fuera de la comuna, siempre que estas cuenten con la supervisión de docentes y/o asistentes de la educación del establecimiento y se realicen en el marco de los objetivos de aprendizaje del plan de estudios.<br><br>Declaro que seré oportunamente informado(a) de cada salida (fecha, lugar y horario) a través de los canales oficiales del establecimiento.` }
  ].map(m=>({...m, fecha:`San Fernando, ${hoy}.`,
    firma:h`${A.nombre} — RUT ${A.rut}<br>Firma del apoderado(a) titular`}));
}

function filaDato(label, valor){
  return h`<div class="dato"><span class="label">${label}</span><span class="valor">${valor || "—"}</span></div>`;
}

function calcularEdad(fechaNacimiento){
  if (!fechaNacimiento) return "";
  const nac = new Date(fechaNacimiento);
  if (isNaN(nac)) return "";
  const hoy = new Date();
  let edad = hoy.getFullYear() - nac.getFullYear();
  const aunNoCumple = (hoy.getMonth() < nac.getMonth()) ||
    (hoy.getMonth() === nac.getMonth() && hoy.getDate() < nac.getDate());
  if (aunNoCumple) edad--;
  return edad >= 0 ? `${edad} años` : "";
}

function fichaAntecedentesInterior(f){
  const E = f.estudiante, A = f.apoderado, S = f.suplente;
  const cursoOProcedencia = f.tipo==="antiguo"
    ? filaDato("Curso 2027", E.cursoMatricula || E.cursoAnterior || "—")
    : h`${filaDato("Colegio de procedencia", E.procedencia)}${E.cursoMatricula ? filaDato("Curso 2027", E.cursoMatricula) : ""}`;
  return h`
    <h2 class="ficha-h2">Ficha de Antecedentes del Estudiante</h2>
    <div class="ficha-top">
      <div class="ficha-datos">
        ${filaDato("Fecha de matrícula", f.fechaRegistro)}
        ${filaDato("Nombre del estudiante", E.nombre)}
        ${filaDato("RUT", E.rut)}
        ${filaDato("Fecha de nacimiento", E.fnac)}
        ${filaDato("Edad", calcularEdad(E.fnac))}
        ${filaDato("Tipo de estudiante", f.tipo==="nuevo" ? "Nuevo" : "Antiguo")}
        ${filaDato("Dirección", E.direccion)}
        ${filaDato("Comuna", E.comuna)}
        ${filaDato("Nacionalidad", E.nacionalidad)}
        ${filaDato("Celular", E.celular)}
        ${filaDato("Correo", E.correo)}
        ${cursoOProcedencia}
      </div>
      <div class="ficha-foto">Foto carnet</div>
    </div>
    <h3 class="ficha-subtitulo">Apoderado titular</h3>
    <div class="ficha-datos">
      ${filaDato("Nombre", A.nombre)}
      ${filaDato("RUT", A.rut)}
      ${filaDato("Edad", A.edad ? A.edad+" años" : "")}
      ${filaDato("Dirección", A.direccion)}
      ${filaDato("Comuna", A.comuna)}
      ${filaDato("Nacionalidad", A.nacionalidad)}
      ${filaDato("Celular", A.celular)}
      ${filaDato("Correo", A.correo)}
      ${filaDato("Parentesco", A.parentesco)}
      ${filaDato("Vive con el estudiante", A.viveConEstudiante==="si" ? "Sí" : A.viveConEstudiante==="no" ? "No" : "")}
      ${filaDato("Último nivel educacional", A.nivelEducacional)}
      ${filaDato("Situación laboral", A.situacionLaboral)}
      ${A.lugarTrabajo ? filaDato("Dónde trabaja", A.lugarTrabajo) : ""}
    </div>
    ${S ? h`
    <h3 class="ficha-subtitulo">Apoderado suplente</h3>
    <div class="ficha-datos">
      ${filaDato("Nombre", S.nombre)}
      ${filaDato("RUT", S.rut)}
      ${filaDato("Edad", S.edad ? S.edad+" años" : "")}
      ${filaDato("Dirección", S.direccion)}
      ${filaDato("Comuna", S.comuna)}
      ${filaDato("Nacionalidad", S.nacionalidad)}
      ${filaDato("Celular", S.celular)}
      ${filaDato("Correo", S.correo)}
      ${filaDato("Parentesco", S.parentesco)}
      ${filaDato("Vive con el estudiante", S.viveConEstudiante==="si" ? "Sí" : S.viveConEstudiante==="no" ? "No" : "")}
    </div>` : ""}
    <div class="firma-doble">
      <div class="firma"><span class="linea-firma">${A.nombre} — RUT ${A.rut}<br>Firma del apoderado(a) titular</span></div>
      ${S ? h`<div class="firma"><span class="linea-firma">${S.nombre} — RUT ${S.rut}<br>Firma del apoderado(a) suplente</span></div>` : ""}
    </div>`;
}

// Documentos en pantalla de UN estudiante (3 autorizaciones + ficha de antecedentes)
function htmlMemosPantalla(f){
  const memos = textosMemos(f);
  return h`${memos.map(m => h`
    <div class="memo-card">
      <h3>${m.titulo}</h3>
      <div>${m.cuerpo}</div>
      <p style="margin-top:16px">${m.fecha}</p>
      <div class="firma"><span class="linea-firma">${m.firma}</span></div>
    </div>`)}<div class="memo-card">${fichaAntecedentesInterior(f)}</div>`;
}
// Hojas de impresión de UN estudiante
function htmlMemosImpresion(f){
  const memos = textosMemos(f);
  return h`${memos.map(m => h`
    <div class="print-memo">
      <div class="encabezado">
        <div class="colegio">${NOMBRE_COLEGIO}</div>
        <div class="sub">Proceso de Matrícula 2027 — Ficha ${f.folio}</div>
      </div>
      <h2>${m.titulo}</h2>
      <div class="cuerpo">${m.cuerpo}</div>
      <p class="fecha">${m.fecha}</p>
      <div class="firma"><span class="linea-firma">${m.firma}</span></div>
      <div class="pie-pagina">
        <img src="${LOGO_SRC}" alt="Logo">
        <div class="pie-texto">${NOMBRE_COLEGIO}<br>Proceso de Matrícula 2027 — Ficha ${f.folio}</div>
      </div>
    </div>`)}${htmlFichaImpresa(f)}`;
}
function renderMemos(){
  const fichas = fichasActuales;
  const varios = fichas.length > 1;
  document.getElementById("memosPantalla").innerHTML = String(h`${fichas.map((f, i) => h`${varios ? h`<h3 class="resumen-card" style="padding:12px 18px"><span class="sol-chip">Estudiante ${i + 1} de ${fichas.length}</span> ${f.estudiante.nombre} — Ficha ${f.folio}</h3>` : ""}${htmlMemosPantalla(f)}`)}`);
  document.getElementById("printArea").innerHTML = String(h`${fichas.map(f => htmlMemosImpresion(f))}`);
}

// Hoja impresa de la «Ficha de antecedentes del estudiante» (se usa al generar los documentos
// y al reimprimir una matrícula desde el panel)
function htmlFichaImpresa(f){
  return h`
    <div class="print-memo ficha-print">
      <div class="encabezado encabezado-ficha">
        <img src="${LOGO_SRC}" alt="Logo">
        <div>
          <div class="colegio">${NOMBRE_COLEGIO}</div>
          <div class="sub">Proceso de Matrícula 2027 — Ficha ${f.folio}</div>
        </div>
      </div>
      ${fichaAntecedentesInterior(f)}
      <div class="pie-pagina">
        <img src="${LOGO_SRC}" alt="Logo">
        <div class="pie-texto">${NOMBRE_COLEGIO}<br>Proceso de Matrícula 2027 — Ficha ${f.folio}</div>
      </div>
    </div>`;
}

function imprimirMemos(){
  renderMemos();
  window.print();
  yaImprimio = true;
  setTimeout(()=>abrir("ovFirma"), 400);
}

/* ---------- Comprobante de matrícula en PDF (para adjuntar al correo) ---------- */
function generarComprobantePDFBase64(f){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "letter", compress: true });   // compress: sin esto jsPDF 4.x triplica el tamaño
  const E = f.estudiante, A = f.apoderado;
  const ancho = doc.internal.pageSize.getWidth();

  doc.addImage(LOGO_IMG, "PNG", (ancho-20)/2, 16, 20, 27.1);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(NOMBRE_COLEGIO, ancho/2, 52, { align: "center", maxWidth: ancho-40 });

  doc.setFontSize(16);
  doc.text("CERTIFICADO DE MATRÍCULA", ancho/2, 64, { align: "center" });

  const cursoTxt = f.tipo === "antiguo"
    ? `en el curso ${E.cursoMatricula || E.cursoAnterior || "—"}`
    : `proveniente del establecimiento ${E.procedencia || "—"}` + (E.cursoMatricula ? `, para cursar ${E.cursoMatricula}` : "");
  const cuerpo =
`Se certifica que con fecha ${f.fechaRegistro}, el/la estudiante ${E.nombre}, RUT ${E.rut}, `+
`fue matriculado(a) en el Instituto Comercial Alberto Valenzuela Llanos de San Fernando, `+
`para el año escolar 2027, ${cursoTxt}, quedando bajo la responsabilidad de su apoderado(a) `+
`titular ${A.nombre}, RUT ${A.rut}.`;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const lineas = doc.splitTextToSize(cuerpo, ancho-40);
  doc.text(lineas, 20, 80);

  const yFolio = 80 + lineas.length*6 + 14;
  doc.setFontSize(10);
  doc.text(`Ficha de matrícula: ${f.folio}`, 20, yFolio);
  const hoy = new Date().toLocaleDateString("es-CL", { day:"numeric", month:"long", year:"numeric" });
  doc.text(`San Fernando, ${hoy}.`, 20, yFolio+8);

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text("Este certificado acredita el registro de la matrícula en el sistema del establecimiento.", ancho/2, 275, { align:"center", maxWidth: ancho-30 });

  return doc.output("datauristring").split(",")[1];
}

/* ---------- Finalizar: guardar + correo ---------- */
// Mensajes para el personal según la respuesta del script de correo (apps-script/Code.gs)
const ERRORES_CORREO = {
  sesion_invalida: "La sesión venció. Cierra el acceso, vuelve a ingresar y reintenta el envío.",
  solicitud_invalida: "La solicitud no es válida.",
  certificados_invalidos: "Los certificados PDF no tienen el formato esperado.",
  demasiados_certificados: "Hay más certificados que el máximo permitido por correo.",
  pdf_invalido: "Uno de los certificados PDF no es un archivo válido.",
  pdf_demasiado_grande: "Un certificado PDF supera el tamaño permitido.",
  adjuntos_excedidos: "Los certificados superan el tamaño total permitido para un solo correo.",
  certificados_no_coinciden: "Los certificados no coinciden con las matrículas guardadas de la solicitud.",
  limite_diario: "Se alcanzó el límite de correos del día. Reintenta mañana.",
  limite_destinatario: "Ya se enviaron los correos permitidos hoy a esa dirección. Reintenta mañana.",
  destinatario_no_autorizado: "El destinatario no está autorizado en este entorno de pruebas.",
  correo_invalido: "El correo del apoderado no es válido. Corrígelo desde el panel y reintenta.",
  en_proceso: "Ya hay un envío en curso para esta solicitud. Espera unos minutos y reintenta.",
  demasiados_reintentos: "Se alcanzó el máximo de reintentos para esta solicitud. Avisa a la administración.",
  servicio_no_disponible: "El servicio de matrículas no respondió. Reintenta en unos minutos.",
  envio_fallido: "El servicio de correo no pudo enviar el mensaje. Reintenta en unos minutos.",
  sin_correo: "El apoderado no registró correo.",
  configuracion: "El envío de correos no está bien configurado. Avisa a la administración.",
  solicitud_no_guardada: "La solicitud aún no está guardada."
};

// Genera un certificado PDF por estudiante y envía UN solo correo con todos. Las matrículas ya están guardadas:
// si algo falla aquí NO se pierde nada y se puede reintentar sin duplicar (la solicitud lleva su identificador).
async function enviarCorreoSolicitud(solicitudId, fichas, token){
  const correo = fichas[0].apoderado.correo;
  const n = fichas.length;
  if (!correo) return { estado: "sin_correo", msg: "El apoderado no registró correo, por lo que no se envió comprobante por email." };
  if (!correoListo) return { estado: "no_configurado", msg: "Los datos se guardaron. El envío automático de correos no está configurado todavía." };
  // 1) un PDF independiente por estudiante; si falla uno, no se envía ninguno
  let certificados;
  try{
    certificados = fichas.map(f => ({ folio: String(f.folio), pdfBase64: generarComprobantePDFBase64(f) }));
  }catch(err){
    console.error("Comprobante PDF:", err);
    return { estado: "pdf", reintentable: true, msg: "Las matrículas se guardaron, pero no se pudo generar uno de los certificados PDF. No se envió ningún correo. Puedes reintentar el envío." };
  }
  // 2) tamaños comprobados ANTES de enviar
  const total = certificados.reduce((a, c) => a + c.pdfBase64.length, 0);
  if (certificados.some(c => c.pdfBase64.length > MAX_PDF_BASE64) || total > MAX_TOTAL_BASE64){
    return { estado: "tamano", msg: "Las matrículas se guardaron, pero los certificados superan el tamaño permitido para un correo. No se envió ninguno. Avisa a la administración." };
  }
  // 3) envío (el script comprueba la sesión, las matrículas guardadas y los límites)
  try{
    const resp = await fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify({ token, solicitudId, certificados }) });
    const data = await resp.json();
    if (data.ok){
      return { estado: "enviado", msg: data.ya_enviado
        ? "El correo de esta solicitud ya se había enviado antes; no se repitió. Destinatario: " + correo + "."
        : n > 1 ? `Se envió UN correo con los ${n} certificados de matrícula (PDF adjuntos) al correo ${correo}.`
                : "Se envió el certificado de matrícula (con PDF adjunto) al correo " + correo + "." };
    }
    if (data.error === "ya_enviado") return { estado: "enviado", msg: "El correo de esta solicitud ya se había enviado antes; no se repitió. Destinatario: " + correo + "." };
    console.error("Correo:", data.error);
    return { estado: "error", reintentable: true, msg: "Las matrículas se guardaron, pero el correo NO se envió. " + (ERRORES_CORREO[data.error] || "Ocurrió un problema con el envío.") + " Puedes reintentar sin duplicar nada." };
  }catch(err){
    console.error(err);
    return { estado: "error", reintentable: true, msg: "Las matrículas se guardaron, pero el correo NO se envió (no hubo respuesta del servicio de correo). Puedes reintentar sin duplicar nada." };
  }
}

async function finalizarMatricula(){
  if (finalizando) return;                                   // doble clic
  const btn = document.getElementById("btnFinalizar");
  finalizando = true; btn.disabled = true; btn.textContent = "Guardando…";
  try{
    // Todas las matrículas o ninguna; con el mismo id de solicitud un reintento devuelve lo ya guardado
    const guardado = await rpc("guardar_solicitud", { p_clave: tokenInterno, p_solicitud: solicitudActual.id, p_fichas: fichasActuales });
    solicitudActual.guardada = true;
    solicitudGuardada = { id: solicitudActual.id, fichas: fichasActuales.slice() };

    // Si venía de una pre-matrícula, eliminarla (el código ya se usó)
    if (codigoPreCargado){
      try{ await rpc("eliminar_prematricula", { p_clave: tokenInterno, p_codigo: codigoPreCargado }); }catch(e){ console.error(e); }
      codigoPreCargado = null;
    }

    const resultado = await enviarCorreoSolicitud(solicitudGuardada.id, solicitudGuardada.fichas, tokenInterno);
    mostrarFinal(resultado, guardado);
  }catch(err){
    aviso("No se pudo guardar", err.message);
  }finally{
    finalizando = false; btn.disabled=false; btn.textContent="Finalizar ✓";
  }
}

function listaFolios(fichas){
  const f = fichas.map(x => x.folio);
  return f.length === 1 ? f[0] : f.slice(0, -1).join(", ") + " y " + f[f.length - 1];
}
function mostrarFinal(resultado, guardado){
  const fichas = solicitudGuardada.fichas;
  document.getElementById("folioTxt").textContent = (fichas.length > 1 ? "Fichas " : "Ficha ") + listaFolios(fichas);
  document.getElementById("doneLista").replaceChildren(...(fichas.length > 1 ? fichas.map((f, i) =>
    el("div", { class: "resumen-card" },
      el("h3", {}, el("span", { texto: `Estudiante ${i + 1}` }), document.createTextNode(f.estudiante.nombre)),
      filaResumen("Ficha", f.folio), filaResumen("Curso 2027", f.estudiante.cursoMatricula || "No indicado"),
      filaResumen("Condición", f.tipo === "antiguo" ? "Estudiante antiguo" : "Estudiante nuevo"),
      el("div", { class: "resumen-fila" }, el("b", { texto: "Matrícula:" }), el("span", { class: "estado ok", texto: "Guardada" }),
        el("b", { texto: "Certificado:" }), el("span", { class: "estado " + (resultado.estado === "enviado" ? "ok" : "pend"), texto: resultado.estado === "enviado" ? "Enviado" : "Pendiente" })))) : []));
  document.getElementById("doneMail").textContent = resultado.msg;
  document.getElementById("doneSpam").style.display = resultado.estado === "enviado" ? "" : "none";
  document.getElementById("btnReintentarCorreo").style.display = resultado.reintentable ? "" : "none";
  const adv = (guardado && guardado.advertencias) || [];
  document.getElementById("doneAdvertencia").textContent = adv.length
    ? "Aviso: " + adv.map(a => `el RUT de ${etiquetaFinal(fichas, a.orden)} ya figura en la ficha ${a.folio_existente} (otra solicitud)`).join("; ") + ". Revisa que no sea un duplicado."
    : "";
  cerrar("ovFirma");
  mostrar("scr-done");
}
function etiquetaFinal(fichas, orden){ const f = fichas[orden - 1]; return f ? f.estudiante.nombre : "un estudiante"; }

// Reintenta el correo de la solicitud recién guardada (no vuelve a guardar nada)
async function reintentarCorreo(){
  if (!solicitudGuardada) return;
  const btn = document.getElementById("btnReintentarCorreo");
  btn.disabled = true; btn.textContent = "Enviando…";
  try{
    const resultado = await enviarCorreoSolicitud(solicitudGuardada.id, solicitudGuardada.fichas, tokenInterno);
    document.getElementById("doneMail").textContent = resultado.msg;
    document.getElementById("doneSpam").style.display = resultado.estado === "enviado" ? "" : "none";
    btn.style.display = resultado.reintentable ? "" : "none";
  } finally { btn.disabled = false; btn.textContent = "✉️ Reintentar el envío del correo"; }
}

/* ---------- Panel admin ---------- */
function pedirClaveAdmin(){ document.getElementById("inputClave").value=""; abrir("ovClave"); setTimeout(()=>document.getElementById("inputClave").focus(),100); }
document.getElementById("inputClave").addEventListener("keydown",e=>{ if(e.key==="Enter") validarClave(); });
async function validarClave(){
  const clave = document.getElementById("inputClave").value;
  const btn = document.querySelector("#ovClave .btn-pri");
  btn.disabled = true;
  try{
    const r = await rpc("iniciar_sesion", { p_clave: clave, p_rol: "admin" });
    if (!r || !r.ok){
      if (r && r.motivo === "bloqueado") aviso("Demasiados intentos", "Se registraron demasiados intentos fallidos desde esta conexión. Espera " + (r.espera_minutos || 15) + " minutos e inténtalo de nuevo.");
      else aviso("Clave incorrecta","La clave ingresada no es válida.");
      return;
    }
    tokenAdmin = r.token;
  }catch(err){
    aviso("No se pudo verificar la clave", err.message); return;
  }finally{
    btn.disabled = false;
    document.getElementById("inputClave").value = "";
  }
  cerrar("ovClave");
  cargarAdmin();
}
async function cargarAdmin(){
  mostrar("scr-admin");
  const tb = document.getElementById("tbodyAdmin");
  if (!sb){ tb.replaceChildren(filaMensaje("Supabase no está configurado.")); return; }
  tb.replaceChildren(filaMensaje("Cargando…"));
  try{
    const filas = await rpc("listar_matriculas", { p_clave: tokenAdmin });
    registros = (filas || []).map(val => ({
      _key: val._key,
      folio: val.folio ?? "—",
      fechaRegistro: val.fechaRegistro ?? "—",
      tipo: val.tipo ?? "nuevo",
      estudiante: val.estudiante ?? {},
      apoderado: val.apoderado ?? {},
      suplente: val.suplente ?? null,
      _solicitud: val._solicitud ?? null, _orden: val._orden ?? null, _hermanos: val._hermanos ?? 1, _correo: val._correo ?? null
    }));
    // Orden ascendente 1, 2, 3... por folio (numérico si es posible, si no por fecha de registro)
    registros.sort((a,b)=>{
      const na = Number(a.folio), nb = Number(b.folio);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return (a.fechaRegistro > b.fechaRegistro) ? 1 : -1;
    });
    poblarFiltroCursosAdmin();
    aplicarFiltrosAdmin();
  }catch(err){
    console.error(err);
    tb.replaceChildren(filaMensaje("No se pudieron cargar las matrículas: " + err.message));
  }
}

function poblarFiltroCursosAdmin(){
  const sel = document.getElementById("fCurso");
  const actual = sel.value;
  const cursos = [...new Set(registros.map(r => r.estudiante.cursoMatricula || r.estudiante.cursoAnterior || "").filter(Boolean))].sort();
  sel.replaceChildren(el("option", { value: "", texto: "Todos los cursos" }), ...cursos.map(c => el("option", { value: c, texto: c })));
  if (cursos.includes(actual)) sel.value = actual;
}

function limpiarFiltrosAdmin(){
  document.getElementById("fBusqueda").value = "";
  document.getElementById("fTipo").value = "";
  document.getElementById("fCurso").value = "";
  document.getElementById("fDesde").value = "";
  document.getElementById("fHasta").value = "";
  aplicarFiltrosAdmin();
}

// La fecha se guarda con toLocaleString("es-CL"), ej: "16-07-2026, 9:56:05 p. m." — solo se usa la parte antes de la coma.
function parseFechaRegistro(str){
  const partes = (str || "").split(",")[0].trim().split("-");
  if (partes.length !== 3) return null;
  const [d, m, y] = partes.map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m-1, d);
}

function aplicarFiltrosAdmin(){
  const q = document.getElementById("fBusqueda").value.trim().toLowerCase();
  const tipo = document.getElementById("fTipo").value;
  const curso = document.getElementById("fCurso").value;
  const desde = document.getElementById("fDesde").value;
  const hasta = document.getElementById("fHasta").value;
  const filtrados = registros.filter(r=>{
    if (tipo && r.tipo !== tipo) return false;
    if (curso && (r.estudiante.cursoMatricula || r.estudiante.cursoAnterior || "") !== curso) return false;
    if (desde || hasta){
      const fecha = parseFechaRegistro(r.fechaRegistro);
      if (!fecha) return false;
      if (desde && fecha < new Date(desde+"T00:00:00")) return false;
      if (hasta && fecha > new Date(hasta+"T23:59:59")) return false;
    }
    if (q){
      const texto = [r.folio, r.estudiante.nombre, r.estudiante.rut, r.apoderado.nombre, r.apoderado.rut, r._solicitud ? r._solicitud.slice(0, 8) : ""].join(" ").toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });
  renderTablaAdmin(filtrados);
}

function renderTablaAdmin(lista){
  registrosVisibles = lista;
  const tb = document.getElementById("tbodyAdmin");
  document.getElementById("contador").textContent = (lista.length===registros.length)
    ? lista.length + " matrícula(s) registrada(s)."
    : lista.length + " de " + registros.length + " matrícula(s) (filtro aplicado).";
  const btnDesc = document.getElementById("btnDescargarExcel");
  btnDesc.textContent = (lista.length===registros.length) ? "⬇️ Descargar Excel" : "⬇️ Descargar Excel (filtrado)";
  if (!lista.length){
    tb.replaceChildren(filaMensaje(registros.length ? "Ninguna matrícula coincide con el filtro." : "Aún no hay matrículas registradas."));
    return;
  }
  tb.replaceChildren(...lista.map(filaMatricula));
}

function filaMensaje(texto){
  return el("tr", {}, el("td", { colspan: "10", texto }));
}

// Una fila del panel. Todo dato de la matrícula se inserta como texto (textContent), nunca como HTML.
function filaMatricula(r){
  const tipo = r.tipo === "antiguo" ? "antiguo" : "nuevo";
  const nombre = r.estudiante.nombre ?? "—";
  const boton = (titulo, icono, accion, args) =>
    el("button", { class: "btn-del", type: "button", title: titulo, texto: icono, datos: { click: accion, args: JSON.stringify(args) } });
  const acciones = el("div", { class: "acciones" },
    boton("Imprimir ficha de matrícula", "🖨️", "imprimirFichaMatricula", [r._key]),
    boton("Cambiar N° de ficha", "#", "abrirFolioFicha", [r._key]),
    boton("Editar matrícula", "✏️", "editarMatricula", [r._key]),
    boton("Eliminar matrícula", "🗑️", "confirmarEliminar", [r._key, r.estudiante.nombre ?? "este estudiante"]));
  return el("tr", {},
    el("td", { texto: r.folio }), el("td", { texto: r.fechaRegistro }),
    el("td", {}, el("span", { class: "pill " + tipo, texto: tipo })),
    el("td", { texto: nombre }), el("td", { texto: r.estudiante.rut ?? "—" }),
    el("td", { texto: tipo === "antiguo" ? (r.estudiante.cursoMatricula ?? r.estudiante.cursoAnterior ?? "—") : (r.estudiante.procedencia ?? "—") }),
    el("td", { texto: r.apoderado.nombre ?? "—" }), el("td", { texto: r.apoderado.celular ?? "—" }),
    celdaSolicitud(r),
    el("td", {}, acciones));
}

// Solicitud a la que pertenece la matrícula (hermanos que se inscribieron juntos) y estado del correo
const ESTADOS_CORREO = {
  enviado: ["ok", "Enviado", "Certificado generado y correo enviado"],
  pendiente: ["pend", "Pendiente", "Certificado pendiente: el correo aún no se envía"],
  enviando: ["pend", "Enviando", "Envío en curso"],
  error: ["err", "Error", "El correo no se pudo enviar: se puede reenviar"],
  sin_correo: ["neutro", "Sin correo", "El apoderado no registró correo"]
};
function celdaSolicitud(r){
  if (!r._solicitud) return el("td", { texto: "—" });
  const est = ESTADOS_CORREO[r._correo];
  const td = el("td", { class: "celda-sol" },
    el("span", { class: "sol-chip", title: "Solicitud " + r._solicitud, texto: `${r._solicitud.slice(0, 6).toUpperCase()} · ${r._orden}/${r._hermanos}` }));
  if (est){
    td.append(el("br"), el("span", { class: "estado " + est[0], title: est[2], texto: est[1] }));
    if (r._correo === "pendiente" || r._correo === "error"){
      td.append(el("button", { class: "btn-mail", type: "button", title: "Reenviar el correo con los certificados de la solicitud", texto: "✉️", datos: { click: "reenviarCorreo", args: JSON.stringify([r._solicitud]) } }));
    }
  }
  return td;
}
// Reenvía el correo único de una solicitud (con los certificados de todos sus estudiantes vigentes). No duplica: el servidor lo impide.
async function reenviarCorreo(solicitudId){
  const hermanos = registros.filter(r => r._solicitud === solicitudId).sort((a, b) => (a._orden ?? 0) - (b._orden ?? 0));
  if (!hermanos.length) return;
  const fichas = hermanos.map(r => ({ folio: String(r.folio), fechaRegistro: r.fechaRegistro, tipo: r.tipo, estudiante: r.estudiante, apoderado: r.apoderado, suplente: r.suplente }));
  aviso("Reenviando correo", "Generando los certificados y enviando…");
  const resultado = await enviarCorreoSolicitud(solicitudId, fichas, tokenAdmin);
  aviso("Reenvío de correo", resultado.msg);
  cargarAdmin();
}

function confirmarEliminar(key, nombre){
  claveEliminarPendiente = key;
  document.getElementById("nombreEliminar").textContent = nombre;
  abrir("ovEliminar");
}
async function eliminarMatricula(){
  if (!claveEliminarPendiente) return;
  const btn = document.getElementById("btnConfirmarEliminar");
  btn.disabled = true; btn.textContent = "Eliminando…";
  try{
    await rpc("eliminar_matricula", { p_clave: tokenAdmin, p_id: claveEliminarPendiente });
    cerrar("ovEliminar");
    cargarAdmin();
  }catch(err){
    aviso("No se pudo eliminar", err.message);
  }finally{
    btn.disabled = false; btn.textContent = "Eliminar definitivamente";
    claveEliminarPendiente = null;
  }
}
function descargarExcel(){
  if (!registrosVisibles.length){ aviso("Sin datos","No hay matrículas para exportar con el filtro actual."); return; }
  const filas = registrosVisibles.map(r=>({
    "Ficha": r.folio, "Fecha registro": r.fechaRegistro,
    "Tipo estudiante": r.tipo==="nuevo"?"Nuevo":"Antiguo",
    "Nombre estudiante": r.estudiante.nombre, "RUT estudiante": r.estudiante.rut,
    "Fecha nacimiento": r.estudiante.fnac, "Dirección": r.estudiante.direccion,
    "Comuna": r.estudiante.comuna, "Nacionalidad": r.estudiante.nacionalidad,
    "Celular estudiante": r.estudiante.celular, "Correo estudiante": r.estudiante.correo,
    "Colegio procedencia": r.estudiante.procedencia, "Curso 2027": r.estudiante.cursoMatricula || r.estudiante.cursoAnterior || "",
    "Repitencia": r.estudiante.repitencia, "Curso repetido": r.estudiante.repCurso, "Año repetido": r.estudiante.repAnio,
    "PIE": r.estudiante.pie, "Diagnóstico PIE": r.estudiante.pieDiagnostico, "Documentación PIE": r.estudiante.pieDocumentacion,
    "Problema de salud": r.estudiante.salud, "Detalle salud": r.estudiante.saludDetalle,
    "Observaciones": r.estudiante.observaciones,
    "Apoderado titular": r.apoderado.nombre, "RUT apoderado": r.apoderado.rut,
    "Edad apoderado": r.apoderado.edad, "Dirección apoderado": r.apoderado.direccion,
    "Comuna apoderado": r.apoderado.comuna, "Nacionalidad apoderado": r.apoderado.nacionalidad,
    "Celular apoderado": r.apoderado.celular, "Correo apoderado": r.apoderado.correo,
    "Parentesco apoderado": r.apoderado.parentesco, "Apoderado vive con el estudiante": r.apoderado.viveConEstudiante,
    "Nivel educacional apoderado": r.apoderado.nivelEducacional, "Situación laboral apoderado": r.apoderado.situacionLaboral,
    "Lugar de trabajo apoderado": r.apoderado.lugarTrabajo,
    "Apoderado suplente": r.suplente ? r.suplente.nombre : "", "RUT suplente": r.suplente ? r.suplente.rut : "",
    "Edad suplente": r.suplente ? r.suplente.edad : "", "Dirección suplente": r.suplente ? r.suplente.direccion : "",
    "Comuna suplente": r.suplente ? r.suplente.comuna : "", "Nacionalidad suplente": r.suplente ? r.suplente.nacionalidad : "",
    "Celular suplente": r.suplente ? r.suplente.celular : "", "Correo suplente": r.suplente ? r.suplente.correo : "",
    "Parentesco suplente": r.suplente ? r.suplente.parentesco : "", "Suplente vive con el estudiante": r.suplente ? r.suplente.viveConEstudiante : "",
    "Solicitud": r._solicitud ? r._solicitud.slice(0, 8).toUpperCase() : "", "N° en la solicitud": r._orden ?? "", "Estudiantes en la solicitud": r._solicitud ? r._hermanos : "",
    "Estado del correo": r._correo ? (ESTADOS_CORREO[r._correo] || [])[1] || r._correo : ""
  }));
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Matrículas 2027");
  const filtrado = registrosVisibles.length !== registros.length;
  XLSX.writeFile(wb, filtrado ? "Matriculas_INCOSAF_2027_filtrado.xlsx" : "Matriculas_INCOSAF_2027.xlsx");
}

// Mismas columnas y orden que la plantilla "Nómina" del colegio, para subir los estudiantes al libro digital
function descargarExcelLibro(){
  if (!registrosVisibles.length){ aviso("Sin datos","No hay matrículas para exportar con el filtro actual."); return; }
  const fechaIso = txt => { const m = /^(\d{1,2})-(\d{1,2})-(\d{4})/.exec(txt||""); return m ? `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}` : ""; };
  const filas = registrosVisibles.map(r=>{
    const E = r.estudiante, A = r.apoderado, S = r.suplente;
    return {
      "N° Matrícula": r.folio,
      "Curso": E.cursoMatricula || E.cursoAnterior || "",
      "Nombre": (E.nombre||"").toUpperCase(),
      "RUN": E.rut,
      "Edad": parseInt(calcularEdad(E.fnac)) || "",
      "Comuna": (E.comuna||"").toUpperCase(),
      "Fecha ingreso": fechaIso(r.fechaRegistro),
      "Fecha retiro": "",
      "Estado": "Activo",
      "Dirección": E.direccion, "Fecha nacimiento": E.fnac, "Nacionalidad": E.nacionalidad,
      "Celular": E.celular, "Correo": E.correo, "Colegio procedencia": E.procedencia,
      "Curso próximo año": "",
      "Repitencia": E.repitencia, "PIE": E.pie, "Diagnóstico PIE": E.pieDiagnostico,
      "Problema de salud": E.salud, "Detalle salud": E.saludDetalle,
      "Observaciones matrícula": E.observaciones,
      "Apoderado titular": A.nombre, "RUT apoderado": A.rut, "Dirección apoderado": A.direccion,
      "Comuna apoderado": A.comuna, "Celular apoderado": A.celular, "Correo apoderado": A.correo,
      "Parentesco apoderado": A.parentesco, "Apoderado vive con el estudiante": A.viveConEstudiante,
      "Nivel educacional apoderado": A.nivelEducacional, "Situación laboral apoderado": A.situacionLaboral,
      "Lugar de trabajo apoderado": A.lugarTrabajo,
      "Apoderado suplente": S ? S.nombre : "", "RUT suplente": S ? S.rut : "",
      "Celular suplente": S ? S.celular : "", "Correo suplente": S ? S.correo : "",
      "Parentesco suplente": S ? S.parentesco : "", "Suplente vive con el estudiante": S ? S.viveConEstudiante : ""
    };
  });
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Nómina 2027");
  XLSX.writeFile(wb, "Nomina_INCOSAF_2027_libro_digital.xlsx");
}

/* ---------- Folios: contador y N° de ficha ---------- */
async function abrirContadorFolio(){
  const inp = document.getElementById("inputSiguienteFolio");
  inp.value = "";
  abrir("ovContadorFolio");
  try{ inp.value = await rpc("ver_siguiente_folio", { p_clave: tokenAdmin }); }
  catch(err){ cerrar("ovContadorFolio"); aviso("No se pudo leer el contador", err.message); return; }
  inp.focus(); inp.select();
}
async function guardarContadorFolio(){
  const valor = parseInt(document.getElementById("inputSiguienteFolio").value, 10);
  if (!Number.isInteger(valor) || valor < 1){ aviso("Número inválido","Escribe un número entero de 1 o más."); return; }
  const btn = document.getElementById("btnGuardarContador");
  btn.disabled = true; btn.textContent = "Guardando…";
  try{
    await rpc("establecer_siguiente_folio", { p_clave: tokenAdmin, p_valor: valor });
    cerrar("ovContadorFolio");
    aviso("Contador actualizado", h`La próxima ficha que se genere será la <b>N° ${valor}</b>.`);
  }catch(err){
    aviso("No se pudo cambiar el contador", err.message);
  }finally{
    btn.disabled = false; btn.textContent = "Guardar";
  }
}

let folioFichaKey = null;
function abrirFolioFicha(key){
  const r = registros.find(x => x._key === key);
  if (!r) return;
  folioFichaKey = key;
  document.getElementById("nombreFolioFicha").textContent = r.estudiante.nombre || "este estudiante";
  document.getElementById("inputFolioFicha").value = r.folio;
  abrir("ovFolioFicha");
  setTimeout(()=>{ const i = document.getElementById("inputFolioFicha"); i.focus(); i.select(); }, 100);
}
async function guardarFolioFicha(){
  const valor = parseInt(document.getElementById("inputFolioFicha").value, 10);
  if (!Number.isInteger(valor) || valor < 1){ aviso("Número inválido","Escribe un número entero de 1 o más."); return; }
  const btn = document.getElementById("btnGuardarFolioFicha");
  btn.disabled = true; btn.textContent = "Guardando…";
  try{
    await rpc("cambiar_folio_matricula", { p_clave: tokenAdmin, p_id: folioFichaKey, p_folio: valor });
    cerrar("ovFolioFicha");
    cargarAdmin();
  }catch(err){
    aviso("No se pudo cambiar el N° de ficha", err.message);
  }finally{
    btn.disabled = false; btn.textContent = "Guardar";
  }
}

/* ---------- Reimprimir la ficha de una matrícula desde el panel ---------- */
function imprimirFichaMatricula(key){
  const r = registros.find(x => x._key === key);
  if (!r) return;
  const f = { folio: r.folio, fechaRegistro: r.fechaRegistro, tipo: r.tipo,
              estudiante: r.estudiante || {}, apoderado: r.apoderado || {}, suplente: r.suplente || null };
  document.getElementById("printArea").innerHTML = String(htmlFichaImpresa(f));
  // el nombre del archivo PDF sale del título de la página
  const tituloOriginal = document.title;
  document.title = ("Ficha " + f.folio + " - " + (f.estudiante.nombre || "")).trim();
  window.addEventListener("afterprint", () => { document.title = tituloOriginal; }, { once: true });
  window.print();
}

/* ---------- Acceso del personal (clave interna → token de sesión) ---------- */
// Los apoderados que llegan por el QR (?apoderado) no pasan por esta pantalla.
function cerrarAcceso(){
  // Se avisa al servidor para que invalide los tokens (si falla, igual vencen solos)
  for (const t of [tokenInterno, tokenAdmin]) if (t) rpc("cerrar_sesion", { p_token: t }).catch(() => {});
  tokenInterno = null; tokenAdmin = null;
  try{ sessionStorage.removeItem("tokenInterno"); }catch(e){}
  document.getElementById("inputClaveInterna").value = "";
  document.getElementById("accesoError").textContent = "";
  mostrar("scr-acceso");
}
async function entrarConClave(clave){
  const err = document.getElementById("accesoError");
  const btn = document.getElementById("btnAcceso");
  err.textContent = "";
  btn.disabled = true; btn.textContent = "Verificando…";
  try{
    const r = await rpc("iniciar_sesion", { p_clave: clave, p_rol: "interna" });
    if (!r || !r.ok){
      err.textContent = r && r.motivo === "bloqueado"
        ? "Demasiados intentos fallidos desde esta conexión. Espera " + (r.espera_minutos || 15) + " minutos."
        : "Clave incorrecta.";
      return false;
    }
    tokenInterno = r.token;
    try{ sessionStorage.setItem("tokenInterno", r.token); }catch(e){}
    mostrar("scr-home");
    return true;
  }catch(e){
    err.textContent = "No se pudo verificar la clave: " + e.message;
    return false;
  }finally{
    btn.disabled = false; btn.textContent = "Entrar";
    document.getElementById("inputClaveInterna").value = "";
  }
}
document.getElementById("formAcceso").addEventListener("submit", e=>{
  e.preventDefault();
  const clave = document.getElementById("inputClaveInterna").value;
  if (!clave){ document.getElementById("accesoError").textContent = "Escribe la clave."; return; }
  entrarConClave(clave);
});
if (MODO_APODERADO){
  mostrar("scr-home");
} else if (tokenInterno){
  // Había una sesión en esta pestaña: el servidor comprueba que siga vigente
  rpc("validar_token", { p_token: tokenInterno })
    .then(rol => { if (rol) mostrar("scr-home"); else cerrarAcceso(); })
    .catch(() => cerrarAcceso());
}

/* ---------- Eventos (sin manejadores en línea: la política de seguridad de contenido no los permite) ----------
   Los elementos declaran su acción con data-click / data-change / data-input (+ data-args en JSON).
   Solo se pueden invocar las funciones de esta lista. */
const ACCIONES = {
  abrirCargarCodigo, abrirContadorFolio, actualizarLugarTrabajo, aplicarFiltrosAdmin, cargarPrematricula, cerrar, cerrarAcceso,
  copiarLinkApoderado, descargarExcel, descargarExcelLibro, eliminarMatricula, finalizarMatricula, guardarContadorFolio,
  guardarFolioFicha, imprimirMemos, iniciarFicha, limpiarFiltrosAdmin, mostrar, mostrarQR, nuevaMatricula, pedirClaveAdmin,
  toggleSub, validarClave, volverInicio,
  // varios estudiantes y correo
  anadirEstudiante, cambiarTipo, pedirQuitarEstudiante, confirmarQuitarEstudiante, confirmarResumen, editarEstudianteResumen,
  reintentarCorreo, reenviarCorreo,
  // botones de las filas del panel
  imprimirFichaMatricula, abrirFolioFicha, editarMatricula, confirmarEliminar
};
function despachar(evento, atributo){
  const origen = evento.target.closest ? evento.target.closest(`[data-${atributo}]`) : null;
  if (!origen) return;
  const f = Object.prototype.hasOwnProperty.call(ACCIONES, origen.dataset[atributo]) ? ACCIONES[origen.dataset[atributo]] : null;
  if (!f) return;
  let args = [];
  try{ args = origen.dataset.args ? JSON.parse(origen.dataset.args) : []; }catch(e){ return; }
  if (Array.isArray(args)) f(...args);
}
document.addEventListener("click", e => despachar(e, "click"));
document.addEventListener("change", e => despachar(e, "change"));
document.addEventListener("input", e => despachar(e, "input"));
