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

// 2) Envío automático del comprobante al apoderado (Google Apps Script + Gmail, gratis)
//    Crea un proyecto en script.google.com, pega el código del script, despliega como
//    "Web app" (acceso: Anyone) y pega aquí la URL que termina en /exec y la clave secreta.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzFw8rbYDDGh9ZDQ5oC_sHcwnnP1BnOuWFzkKrXtaOaaktPtVRnnbFhcFL4jrWMU8fP/exec";
const APPS_SCRIPT_SECRETO = "ZZWBOa92quuP2qK3la7vVYhc";
/* ========================================================== */

let sb = null;
try {
  if (!SUPABASE_URL.includes("PEGA_AQUI") && !SUPABASE_ANON_KEY.includes("PEGA_AQUI")) {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
} catch(e){ console.error("Supabase:", e); }

// Llama a una función de la base (ver supabase/schema.sql) y lanza un Error legible si falla
async function rpc(nombre, args){
  if (!sb) throw new Error("Supabase no está configurado. Pega la URL y la clave anon al inicio de js/app.js.");
  const { data, error } = await sb.rpc(nombre, args || {});
  if (error) {
    if (/clave_incorrecta/.test(error.message)) throw new Error("La clave no es válida o cambió. Cierra el acceso y vuelve a ingresarla.");
    const m = /(folio_invalido|folio_en_uso|folio_duplicado): (.*)/.exec(error.message);
    if (m) throw new Error(m[2]);
    throw new Error(error.message);
  }
  return data;
}
// Clave de encargados ingresada en esta sesión (solo en memoria; el servidor la valida en cada operación)
let claveAdmin = null;
// Clave interna (inspectores) ingresada en la pantalla de entrada. Se guarda solo en esta pestaña
// (sessionStorage): se borra al cerrar la pestaña o al pulsar «Cerrar acceso».
let claveInterna = null;
try{ claveInterna = sessionStorage.getItem("claveInterna"); }catch(e){}

const correoListo = !APPS_SCRIPT_URL.includes("PEGA_AQUI");

let tipoEstudiante = "nuevo";
let fichaActual = null;
let yaImprimio = false;
let codigoPreCargado = null;
let registros = [];
let registrosVisibles = [];
let claveEliminarPendiente = null;
let editandoKey = null;
let editandoOriginal = null;

/* ---------- Nómina de alumnos 2026 (autocompletar comuna de estudiantes antiguos) ---------- */
let nomina2026 = null;
fetch("nomina2026.json").then(r => r.ok ? r.json() : null).then(datos => {
  if (!datos) return;
  nomina2026 = datos;
  const dl = document.getElementById("listaNomina2026");
  const opciones = Object.values(datos).map(a => `<option value="${a.nombre}">`).join("");
  dl.innerHTML = opciones;
}).catch(err => console.error("Nómina 2026:", err));

function buscarEnNomina(){
  if (tipoEstudiante !== "antiguo" || !nomina2026) return;
  const hint = document.getElementById("e_nomina_hint");
  const rutVal = document.getElementById("e_rut").value.trim();
  const nombreVal = document.getElementById("e_nombre").value.trim().toLowerCase();
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
  const eNombre = document.getElementById("e_nombre");
  if (!eNombre.value.trim()) eNombre.value = alumno.nombre;
  const eRut = document.getElementById("e_rut");
  if (!eRut.value.trim() && rutKey) eRut.value = formatearRut(rutKey);
  const eComuna = document.getElementById("e_comuna");
  if (!eComuna.value.trim() && alumno.comuna) eComuna.value = alumno.comuna;
  const retirado = alumno.estado === "Retirado";
  hint.classList.toggle("err", retirado);
  hint.textContent = `📋 Encontrado en la nómina 2026: ${alumno.nombre} — Curso 2026: ${alumno.curso || "—"} — Comuna: ${alumno.comuna || "—"}`
    + (retirado ? " — ⚠️ Figura como RETIRADO en 2026." : "");
}
document.getElementById("e_rut").addEventListener("blur", buscarEnNomina);
document.getElementById("e_nombre").addEventListener("blur", buscarEnNomina);

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
function aviso(t,x){ document.getElementById("avisoTitulo").textContent=t; document.getElementById("avisoTexto").innerHTML=x; abrir("ovAviso"); }

function iniciarFicha(tipo){
  tipoEstudiante = tipo;
  codigoPreCargado = null;
  editandoKey = null;
  editandoOriginal = null;
  document.getElementById("ficha").reset();
  actualizarLugarTrabajo();
  document.querySelectorAll(".subfields").forEach(s=>s.classList.remove("show"));
  document.querySelectorAll("input.bad,select.bad").forEach(i=>i.classList.remove("bad"));
  document.getElementById("bannerErr").classList.remove("show");
  document.getElementById("e_nomina_hint").textContent = "";
  document.getElementById("e_nomina_hint").classList.remove("err");
  document.getElementById("tipoLabel").textContent = tipo==="nuevo" ? "Estudiante nuevo" : "Estudiante antiguo";
  document.querySelectorAll(".solo-nuevo").forEach(el=>el.style.display = tipo==="nuevo" ? "" : "none");
  document.querySelectorAll(".solo-antiguo").forEach(el=>el.style.display = tipo==="antiguo" ? "" : "none");
  document.querySelector('#ficha button[type="submit"]').textContent = MODO_APODERADO ? "Enviar pre-matrícula →" : "Generar documentos de matrícula →";
  yaImprimio = false;
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
function validarFicha(){
  let ok = true;
  const req = id => { const el=document.getElementById(id); return marcar(el, !el.value.trim()) && ok; };
  const v = id => document.getElementById(id).value.trim();

  ok = marcar(document.getElementById("e_nombre"), !v("e_nombre")) && ok;
  ok = marcar(document.getElementById("e_rut"), !rutValido(v("e_rut"))) && ok;
  ok = marcar(document.getElementById("e_fnac"), !v("e_fnac")) && ok;
  ok = marcar(document.getElementById("e_dir"), !v("e_dir")) && ok;
  ok = marcar(document.getElementById("e_comuna"), !v("e_comuna")) && ok;
  ok = marcar(document.getElementById("e_nacionalidad"), !v("e_nacionalidad")) && ok;
  ok = marcar(document.getElementById("e_cel"), !v("e_cel")) && ok;

  if (tipoEstudiante==="nuevo"){
    ok = marcar(document.getElementById("e_procedencia"), !v("e_procedencia")) && ok;
  } else {
    ok = marcar(document.getElementById("e_cursoAnt"), !v("e_cursoAnt")) && ok;
    ok = marcar(document.getElementById("e_letraAnt"), !v("e_letraAnt")) && ok;
  }

  // Radios obligatorios
  for (const g of ["rep","pie","salud"]){
    const sel = document.querySelector(`input[name="${g}"]:checked`);
    if (!sel){ ok=false; document.getElementById("sub_"+g).previousElementSibling.querySelectorAll(".radio-pill span").forEach(s=>s.style.borderColor="var(--error)"); }
  }
  if (document.querySelector('input[name="rep"]:checked')?.value==="si"){
    ok = marcar(document.getElementById("e_repCurso"), !v("e_repCurso")) && ok;
    ok = marcar(document.getElementById("e_repAnio"), !v("e_repAnio")) && ok;
  }
  if (document.querySelector('input[name="pie"]:checked')?.value==="si"){
    ok = marcar(document.getElementById("e_pieDiag"), !v("e_pieDiag")) && ok;
    if (!document.querySelector('input[name="pieDoc"]:checked')) ok=false;
  }
  if (document.querySelector('input[name="salud"]:checked')?.value==="si"){
    ok = marcar(document.getElementById("e_saludDet"), !v("e_saludDet")) && ok;
  }

  // Apoderado titular
  ok = marcar(document.getElementById("a_nombre"), !v("a_nombre")) && ok;
  ok = marcar(document.getElementById("a_rut"), !rutValido(v("a_rut"))) && ok;
  ok = marcar(document.getElementById("a_edad"), !v("a_edad")) && ok;
  ok = marcar(document.getElementById("a_dir"), !v("a_dir")) && ok;
  ok = marcar(document.getElementById("a_comuna"), !v("a_comuna")) && ok;
  ok = marcar(document.getElementById("a_nacionalidad"), !v("a_nacionalidad")) && ok;
  ok = marcar(document.getElementById("a_cel"), !v("a_cel")) && ok;
  ok = marcar(document.getElementById("a_parentesco"), !v("a_parentesco")) && ok;

  // Suplente (si se registra)
  if (document.querySelector('input[name="sup"]:checked')?.value==="si"){
    ok = marcar(document.getElementById("s_nombre"), !v("s_nombre")) && ok;
    ok = marcar(document.getElementById("s_rut"), !rutValido(v("s_rut"))) && ok;
    ok = marcar(document.getElementById("s_edad"), !v("s_edad")) && ok;
    ok = marcar(document.getElementById("s_dir"), !v("s_dir")) && ok;
    ok = marcar(document.getElementById("s_comuna"), !v("s_comuna")) && ok;
    ok = marcar(document.getElementById("s_nacionalidad"), !v("s_nacionalidad")) && ok;
    ok = marcar(document.getElementById("s_cel"), !v("s_cel")) && ok;
    ok = marcar(document.getElementById("s_parentesco"), !v("s_parentesco")) && ok;
  }
  return ok;
}

/* ---------- Generar ficha + memos ---------- */
function recolectarDatos(){
  const v = id => document.getElementById(id).value.trim();
  const radio = n => document.querySelector(`input[name="${n}"]:checked`)?.value || "";
  const conSup = radio("sup")==="si";
  return {
    tipo: tipoEstudiante,
    estudiante: {
      nombre: v("e_nombre"), rut: v("e_rut"), fnac: v("e_fnac"), direccion: v("e_dir"),
      comuna: v("e_comuna"), nacionalidad: v("e_nacionalidad"),
      celular: v("e_cel"), correo: v("e_mail"),
      procedencia: tipoEstudiante==="nuevo" ? v("e_procedencia") : "",
      cursoMatricula: tipoEstudiante==="antiguo" ? (v("e_cursoAnt")+" "+v("e_letraAnt").toUpperCase()) : "",
      repitencia: radio("rep"), repCurso: v("e_repCurso"), repAnio: v("e_repAnio"),
      pie: radio("pie"), pieDiagnostico: v("e_pieDiag"), pieDocumentacion: radio("pieDoc"),
      salud: radio("salud"), saludDetalle: v("e_saludDet"),
      observaciones: v("e_obs")
    },
    apoderado: { nombre: v("a_nombre"), rut: v("a_rut"), edad: v("a_edad"), direccion: v("a_dir"), comuna: v("a_comuna"), nacionalidad: v("a_nacionalidad"), celular: v("a_cel"), correo: v("a_mail"),
      parentesco: v("a_parentesco"), viveConEstudiante: radio("a_vive"), nivelEducacional: v("a_nivel"),
      situacionLaboral: v("a_laboral"), lugarTrabajo: v("a_laboral").startsWith("Trabaja") ? radio("a_lugar") : "" },
    suplente: conSup ? { nombre: v("s_nombre"), rut: v("s_rut"), edad: v("s_edad"), direccion: v("s_dir"), comuna: v("s_comuna"), nacionalidad: v("s_nacionalidad"), celular: v("s_cel"), correo: v("s_mail"), parentesco: v("s_parentesco"), viveConEstudiante: radio("s_vive") } : null
  };
}

document.getElementById("ficha").addEventListener("submit", async e=>{
  e.preventDefault();
  if (!validarFicha()){
    document.getElementById("bannerErr").classList.add("show");
    window.scrollTo({top:0,behavior:"smooth"});
    return;
  }
  document.getElementById("bannerErr").classList.remove("show");
  const datos = recolectarDatos();

  // Modo edición: actualizar una matrícula existente en vez de crear una nueva
  if (editandoKey){
    const btnGuardar = e.target.querySelector('button[type="submit"]');
    btnGuardar.disabled = true; btnGuardar.textContent = "Guardando…";
    try{
      await rpc("actualizar_matricula", { p_clave: claveAdmin, p_id: editandoKey, p_ficha: { ...editandoOriginal, ...datos } });
      aviso("Cambios guardados", "Se actualizaron los datos de la matrícula.");
      editandoKey = null;
      editandoOriginal = null;
      cargarAdmin();
    }catch(err){
      aviso("No se pudo guardar", err.message);
    }finally{
      btnGuardar.disabled = false; btnGuardar.textContent = "Generar documentos de matrícula →";
    }
    return;
  }

  // Modo apoderado: guardar pre-matrícula y mostrar código
  if (MODO_APODERADO){
    await guardarPrematricula(datos, e.target.querySelector('button[type="submit"]'));
    return;
  }

  // Modo profesor: obtener folio secuencial
  const btnGenerar = e.target.querySelector('button[type="submit"]');
  btnGenerar.disabled = true; btnGenerar.textContent = "Generando ficha…";
  let numeroFolio = null;
  try{
    numeroFolio = String(await rpc("obtener_folio", { p_clave: claveInterna }));
  }catch(err){
    console.error("Folio:", err);
    aviso("No se pudo generar el número de ficha",
      "No fue posible pedir el folio a la base de datos. Revisa que Supabase esté configurado y que ejecutaste <code>supabase/schema.sql</code>.<br><br>Detalle técnico: " + err.message);
  }
  btnGenerar.disabled = false; btnGenerar.textContent = "Generar documentos de matrícula →";
  if (!numeroFolio) return; // no continuar sin folio válido

  fichaActual = { folio: numeroFolio, fechaRegistro: new Date().toLocaleString("es-CL"), ...datos };
  yaImprimio = false;
  renderMemos();
  mostrar("scr-memos");
});

/* ---------- Pre-matrícula (apoderados vía QR) ---------- */
async function guardarPrematricula(datos, btn){
  btn.disabled = true; btn.textContent = "Enviando…";
  try{
    const codigo = await rpc("crear_prematricula", { p_datos: datos });
    document.getElementById("codigoGrande").textContent = codigo;
    mostrar("scr-codigo");
  }catch(err){
    aviso("No se pudo enviar", err.message);
  }finally{
    btn.disabled = false; btn.textContent = "Enviar pre-matrícula →";
  }
}

function abrirCargarCodigo(){
  document.getElementById("inputCodigo").value = "";
  abrir("ovCodigo");
  setTimeout(()=>document.getElementById("inputCodigo").focus(),100);
}
document.getElementById("inputCodigo").addEventListener("keydown",e=>{ if(e.key==="Enter") cargarPrematricula(); });

async function cargarPrematricula(){
  const codigo = document.getElementById("inputCodigo").value.trim();
  if (!/^\d{4}$/.test(codigo)){ aviso("Código inválido","El código debe tener 4 dígitos."); return; }
  const btn = document.getElementById("btnBuscarCodigo");
  btn.disabled = true; btn.textContent = "Buscando…";
  try{
    const datos = await rpc("cargar_prematricula", { p_clave: claveInterna, p_codigo: codigo });
    if (!datos){ aviso("Código no encontrado","No existe una pre-matrícula con el código <b>"+codigo+"</b>. Verifica con el apoderado."); return; }
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
function llenarFicha(d, mensaje){
  iniciarFicha(d.tipo);
  const set = (id,val)=>{ document.getElementById(id).value = val || ""; };
  const E=d.estudiante, A=d.apoderado, S=d.suplente;
  set("e_nombre",E.nombre); set("e_rut",E.rut); set("e_fnac",E.fnac); set("e_dir",E.direccion);
  set("e_comuna",E.comuna); set("e_nacionalidad",E.nacionalidad);
  set("e_cel",E.celular); set("e_mail",E.correo); set("e_obs",E.observaciones);
  if (d.tipo==="nuevo"){ set("e_procedencia",E.procedencia); }
  else {
    const curso = (E.cursoMatricula || E.cursoAnterior || "").trim();
    const partes = curso.split(" ");
    const letra = partes.length>2 ? partes.pop() : "";
    set("e_cursoAnt", partes.join(" ")); set("e_letraAnt", letra);
  }
  setRadio("rep",E.repitencia); toggleSub("rep"); set("e_repCurso",E.repCurso); set("e_repAnio",E.repAnio);
  setRadio("pie",E.pie); toggleSub("pie"); set("e_pieDiag",E.pieDiagnostico); setRadio("pieDoc",E.pieDocumentacion);
  setRadio("salud",E.salud); toggleSub("salud"); set("e_saludDet",E.saludDetalle);
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
  aviso("Datos cargados", mensaje || "Se cargaron los datos de la pre-matrícula. Revísalos junto al apoderado antes de generar los documentos.");
}

function editarMatricula(key){
  const r = registros.find(x => x._key === key);
  if (!r) return;
  llenarFicha(
    { tipo: r.tipo, estudiante: r.estudiante, apoderado: r.apoderado, suplente: r.suplente },
    "Se cargaron los datos de esta matrícula para editar. Corrige lo necesario y presiona «Guardar cambios»."
  );
  editandoKey = key;
  editandoOriginal = { folio: r.folio, fechaRegistro: r.fechaRegistro };
  document.querySelector('#ficha button[type="submit"]').textContent = "Guardar cambios ✓";
}

function mostrarQR(){
  const url = location.origin + location.pathname + "?apoderado";
  const box = document.getElementById("qrBox");
  box.innerHTML = "";
  if (location.protocol === "file:"){
    box.innerHTML = "<p style='font-size:.8rem;color:var(--error)'>⚠️ Estás abriendo el archivo localmente. El QR funcionará cuando la página esté subida a internet (GitHub Pages).</p>";
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
      cuerpo:`Yo, <b>${A.nombre}</b>, RUT <b>${A.rut}</b>, en mi calidad de apoderado(a) titular del(la) estudiante <b>${E.nombre}</b>, RUT <b>${E.rut}</b>, autorizo expresamente al <b>${NOMBRE_COLEGIO}</b> a captar, utilizar y difundir la imagen de mi pupilo(a) en fotografías y registros audiovisuales tomados en el contexto de actividades académicas, deportivas, culturales y extraprogramáticas del establecimiento, para ser publicados en medios institucionales tales como la página web oficial, redes sociales, murales, boletines y material de difusión educativa.<br><br>Esta autorización se otorga de manera gratuita y voluntaria, exclusivamente con fines educativos e institucionales, y tendrá vigencia durante el año escolar 2027. Declaro conocer que puedo revocarla en cualquier momento mediante comunicación escrita dirigida a la Dirección del establecimiento.` },
    { titulo:"Aceptación del Reglamento Interno",
      cuerpo:`Yo, <b>${A.nombre}</b>, RUT <b>${A.rut}</b>, apoderado(a) titular del(la) estudiante <b>${E.nombre}</b>, RUT <b>${E.rut}</b>, declaro haber tomado conocimiento del <b>Reglamento Interno y de Convivencia Escolar</b> del <b>${NOMBRE_COLEGIO}</b>, disponible en el establecimiento y en sus medios oficiales, y manifiesto mi plena conformidad y adhesión a sus normas, protocolos, derechos y deberes.<br><br>Me comprometo, junto a mi pupilo(a), a respetar y cumplir sus disposiciones durante el año escolar 2027, colaborando con el establecimiento en la formación integral del(la) estudiante y en la sana convivencia de la comunidad educativa.` },
    { titulo:"Autorización de salidas pedagógicas",
      cuerpo:`Yo, <b>${A.nombre}</b>, RUT <b>${A.rut}</b>, apoderado(a) titular del(la) estudiante <b>${E.nombre}</b>, RUT <b>${E.rut}</b>, autorizo a mi pupilo(a) a participar en las <b>salidas pedagógicas</b> organizadas por el <b>${NOMBRE_COLEGIO}</b> durante el año escolar 2027, dentro y fuera de la comuna, siempre que estas cuenten con la supervisión de docentes y/o asistentes de la educación del establecimiento y se realicen en el marco de los objetivos de aprendizaje del plan de estudios.<br><br>Declaro que seré oportunamente informado(a) de cada salida (fecha, lugar y horario) a través de los canales oficiales del establecimiento.` }
  ].map(m=>({...m, fecha:`San Fernando, ${hoy}.`,
    firma:`${A.nombre} — RUT ${A.rut}<br>Firma del apoderado(a) titular`}));
}

function filaDato(label, valor){
  return `<div class="dato"><span class="label">${label}</span><span class="valor">${valor || "—"}</span></div>`;
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
    : filaDato("Colegio de procedencia", E.procedencia);
  return `
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
    ${S ? `
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
      ${S ? `<div class="firma"><span class="linea-firma">${S.nombre} — RUT ${S.rut}<br>Firma del apoderado(a) suplente</span></div>` : ""}
    </div>`;
}

function renderMemos(){
  const memos = textosMemos(fichaActual);
  document.getElementById("memosPantalla").innerHTML = memos.map(m=>`
    <div class="memo-card">
      <h3>${m.titulo}</h3>
      <div>${m.cuerpo}</div>
      <p style="margin-top:16px">${m.fecha}</p>
      <div class="firma"><span class="linea-firma">${m.firma}</span></div>
    </div>`).join("") + `<div class="memo-card">${fichaAntecedentesInterior(fichaActual)}</div>`;
  document.getElementById("printArea").innerHTML = memos.map(m=>`
    <div class="print-memo">
      <div class="encabezado">
        <div class="colegio">${NOMBRE_COLEGIO}</div>
        <div class="sub">Proceso de Matrícula 2027 — Ficha ${fichaActual.folio}</div>
      </div>
      <h2>${m.titulo}</h2>
      <div class="cuerpo">${m.cuerpo}</div>
      <p class="fecha">${m.fecha}</p>
      <div class="firma"><span class="linea-firma">${m.firma}</span></div>
      <div class="pie-pagina">
        <img src="${LOGO_SRC}" alt="Logo">
        <div class="pie-texto">${NOMBRE_COLEGIO}<br>Proceso de Matrícula 2027 — Ficha ${fichaActual.folio}</div>
      </div>
    </div>`).join("") + htmlFichaImpresa(fichaActual);
}

// Hoja impresa de la «Ficha de antecedentes del estudiante» (se usa al generar los documentos
// y al reimprimir una matrícula desde el panel)
function htmlFichaImpresa(f){
  return `
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
  const doc = new jsPDF({ unit: "mm", format: "letter" });
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
    : `proveniente del establecimiento ${E.procedencia || "—"}`;
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
async function finalizarMatricula(){
  const btn = document.getElementById("btnFinalizar");
  btn.disabled = true; btn.textContent = "Guardando…";
  try{
    await rpc("guardar_matricula", { p_clave: claveInterna, p_ficha: fichaActual });

    // Si venía de una pre-matrícula, eliminarla (el código ya se usó)
    if (codigoPreCargado){
      try{ await rpc("eliminar_prematricula", { p_clave: claveInterna, p_codigo: codigoPreCargado }); }catch(e){ console.error(e); }
      codigoPreCargado = null;
    }

    // Correo al apoderado
    let msgMail = "El apoderado no registró correo, por lo que no se envió comprobante por email.";
    const correo = fichaActual.apoderado.correo;
    if (correo){
      if (correoListo){
        const E=fichaActual.estudiante;
        const detalle =
`Estimado(a) ${fichaActual.apoderado.nombre}:
Confirmamos la matrícula 2027 en ${NOMBRE_COLEGIO}.

Ficha: ${fichaActual.folio}
Estudiante: ${E.nombre} (RUT ${E.rut})
Tipo: ${fichaActual.tipo==="nuevo"?"Estudiante nuevo":"Estudiante antiguo"}
${fichaActual.tipo==="nuevo" ? "Colegio de procedencia: "+E.procedencia : "Curso 2027: "+E.cursoMatricula}
Fecha de registro: ${fichaActual.fechaRegistro}

Documentos firmados por el apoderado:
• Autorización de uso de imagen
• Aceptación del Reglamento Interno
• Autorización de salidas pedagógicas

Se adjunta además el certificado de matrícula en PDF.

Atentamente,
${NOMBRE_COLEGIO}

--
Este es un correo automático de confirmación de matrícula.
Para consultas escriba a: ${CONTACTO_COLEGIO.correo} · Teléfono: ${CONTACTO_COLEGIO.telefono}
${NOMBRE_COLEGIO} · ${CONTACTO_COLEGIO.direccion}`;
        let comprobantePdf = null;
        try{ comprobantePdf = generarComprobantePDFBase64(fichaActual); }
        catch(err){ console.error("Comprobante PDF:", err); }
        try{
          const resp = await fetch(APPS_SCRIPT_URL, {
            method: "POST",
            body: JSON.stringify({
              secreto: APPS_SCRIPT_SECRETO,
              to: correo,
              subject: `Confirmación de matrícula 2027 - Ficha ${fichaActual.folio}`,
              body: detalle,
              replyTo: CONTACTO_COLEGIO.correo,
              pdfBase64: comprobantePdf,
              pdfName: `Certificado_matricula_ficha_${fichaActual.folio}.pdf`
            })
          });
          const data = await resp.json();
          if (!data.ok) throw new Error(data.error || "El script de Google respondió con un error desconocido.");
          msgMail = "Se envió el certificado de matrícula (con PDF adjunto) al correo " + correo + ".";
        }catch(err){
          console.error(err);
          msgMail = "Los datos se guardaron, pero el correo no pudo enviarse (revisa la configuración del script de Google).";
        }
      } else {
        msgMail = "Los datos se guardaron. Para el envío automático de correos, configura el script de Google al inicio del archivo.";
      }
    }

    document.getElementById("folioTxt").textContent = "Ficha " + fichaActual.folio;
    document.getElementById("doneMail").textContent = msgMail;
    document.getElementById("doneSpam").style.display = msgMail.startsWith("Se envió") ? "" : "none";
    cerrar("ovFirma");
    mostrar("scr-done");
  }catch(err){
    aviso("No se pudo guardar", err.message);
  }finally{
    btn.disabled=false; btn.textContent="Finalizar ✓";
  }
}

/* ---------- Panel admin ---------- */
function pedirClaveAdmin(){ document.getElementById("inputClave").value=""; abrir("ovClave"); setTimeout(()=>document.getElementById("inputClave").focus(),100); }
document.getElementById("inputClave").addEventListener("keydown",e=>{ if(e.key==="Enter") validarClave(); });
async function validarClave(){
  const clave = document.getElementById("inputClave").value;
  try{
    if (!(await rpc("verificar_clave", { p_clave: clave }))){
      aviso("Clave incorrecta","La clave ingresada no es válida."); return;
    }
  }catch(err){
    aviso("No se pudo verificar la clave", err.message); return;
  }
  claveAdmin = clave;
  cerrar("ovClave");
  cargarAdmin();
}
async function cargarAdmin(){
  mostrar("scr-admin");
  const tb = document.getElementById("tbodyAdmin");
  if (!sb){ tb.innerHTML = `<tr><td colspan="9">Supabase no está configurado.</td></tr>`; return; }
  tb.innerHTML = `<tr><td colspan="9">Cargando…</td></tr>`;
  try{
    const filas = await rpc("listar_matriculas", { p_clave: claveAdmin });
    registros = (filas || []).map(val => ({
      _key: val._key,
      folio: val.folio ?? "—",
      fechaRegistro: val.fechaRegistro ?? "—",
      tipo: val.tipo ?? "nuevo",
      estudiante: val.estudiante ?? {},
      apoderado: val.apoderado ?? {},
      suplente: val.suplente ?? null
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
    tb.innerHTML = `<tr><td colspan="9">No se pudieron cargar las matrículas: ${err.message}</td></tr>`;
  }
}

function poblarFiltroCursosAdmin(){
  const sel = document.getElementById("fCurso");
  const actual = sel.value;
  const cursos = [...new Set(registros.map(r => r.estudiante.cursoMatricula || r.estudiante.cursoAnterior || "").filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Todos los cursos</option>' + cursos.map(c=>`<option value="${c}">${c}</option>`).join("");
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
      const texto = [r.folio, r.estudiante.nombre, r.estudiante.rut, r.apoderado.nombre, r.apoderado.rut].join(" ").toLowerCase();
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
  tb.innerHTML = lista.length ? lista.map(r=>`
      <tr>
        <td>${r.folio}</td><td>${r.fechaRegistro}</td>
        <td><span class="pill ${r.tipo}">${r.tipo}</span></td>
        <td>${r.estudiante.nombre ?? "—"}</td><td>${r.estudiante.rut ?? "—"}</td>
        <td>${r.tipo==="antiguo" ? (r.estudiante.cursoMatricula ?? r.estudiante.cursoAnterior ?? "—") : (r.estudiante.procedencia ?? "—")}</td>
        <td>${r.apoderado.nombre ?? "—"}</td><td>${r.apoderado.celular ?? "—"}</td>
        <td><div class="acciones">
          <button class="btn-del" title="Imprimir ficha de matrícula" onclick="imprimirFichaMatricula('${r._key}')">🖨️</button>
          <button class="btn-del" title="Cambiar N° de ficha" onclick="abrirFolioFicha('${r._key}')">#</button>
          <button class="btn-del" title="Editar matrícula" onclick="editarMatricula('${r._key}')">✏️</button>
          <button class="btn-del" title="Eliminar matrícula" onclick="confirmarEliminar('${r._key}','${(r.estudiante.nombre ?? "este estudiante").replace(/'/g,"\\'")}')">🗑️</button>
</div>
        </td>
      </tr>`).join("") : (registros.length ? `<tr><td colspan="9">Ninguna matrícula coincide con el filtro.</td></tr>` : `<tr><td colspan="9">Aún no hay matrículas registradas.</td></tr>`);
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
    await rpc("eliminar_matricula", { p_clave: claveAdmin, p_id: claveEliminarPendiente });
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
    "Parentesco suplente": r.suplente ? r.suplente.parentesco : "", "Suplente vive con el estudiante": r.suplente ? r.suplente.viveConEstudiante : ""
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
  try{ inp.value = await rpc("ver_siguiente_folio", { p_clave: claveAdmin }); }
  catch(err){ cerrar("ovContadorFolio"); aviso("No se pudo leer el contador", err.message); return; }
  inp.focus(); inp.select();
}
async function guardarContadorFolio(){
  const valor = parseInt(document.getElementById("inputSiguienteFolio").value, 10);
  if (!Number.isInteger(valor) || valor < 1){ aviso("Número inválido","Escribe un número entero de 1 o más."); return; }
  const btn = document.getElementById("btnGuardarContador");
  btn.disabled = true; btn.textContent = "Guardando…";
  try{
    await rpc("establecer_siguiente_folio", { p_clave: claveAdmin, p_valor: valor });
    cerrar("ovContadorFolio");
    aviso("Contador actualizado", "La próxima ficha que se genere será la <b>N° " + valor + "</b>.");
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
    await rpc("cambiar_folio_matricula", { p_clave: claveAdmin, p_id: folioFichaKey, p_folio: valor });
    cerrar("ovFolioFicha");
    cargarAdmin();
  }catch(err){
    aviso("No se pudo cambiar el N° de ficha", err.message);
  }finally{
    btn.disabled = false; btn.textContent = "Guardar";
  }
}

/* ---------- Acceso del personal (clave interna) ---------- */
// Los apoderados que llegan por el QR (?apoderado) no pasan por esta pantalla.
function cerrarAcceso(){
  claveInterna = null; claveAdmin = null;
  try{ sessionStorage.removeItem("claveInterna"); }catch(e){}
  document.getElementById("inputClaveInterna").value = "";
  document.getElementById("accesoError").textContent = "";
  mostrar("scr-acceso");
}
async function entrarConClave(clave, silencioso){
  const err = document.getElementById("accesoError");
  const btn = document.getElementById("btnAcceso");
  err.textContent = "";
  btn.disabled = true; btn.textContent = "Verificando…";
  try{
    if (!(await rpc("verificar_clave_interna", { p_clave: clave }))){
      if (!silencioso) err.textContent = "Clave incorrecta.";
      return false;
    }
    claveInterna = clave;
    try{ sessionStorage.setItem("claveInterna", clave); }catch(e){}
    mostrar("scr-home");
    return true;
  }catch(e){
    if (!silencioso) err.textContent = "No se pudo verificar la clave: " + e.message;
    return false;
  }finally{
    btn.disabled = false; btn.textContent = "Entrar";
  }
}
document.getElementById("formAcceso").addEventListener("submit", e=>{
  e.preventDefault();
  const clave = document.getElementById("inputClaveInterna").value;
  if (!clave){ document.getElementById("accesoError").textContent = "Escribe la clave."; return; }
  entrarConClave(clave, false);
});
if (MODO_APODERADO){
  mostrar("scr-home");
} else if (claveInterna){
  // Había una sesión en esta pestaña: se vuelve a comprobar con el servidor
  entrarConClave(claveInterna, true).then(ok => { if (!ok) cerrarAcceso(); });
}

/* ---------- Reimprimir la ficha de una matrícula desde el panel ---------- */
function imprimirFichaMatricula(key){
  const r = registros.find(x => x._key === key);
  if (!r) return;
  const f = { folio: r.folio, fechaRegistro: r.fechaRegistro, tipo: r.tipo,
              estudiante: r.estudiante || {}, apoderado: r.apoderado || {}, suplente: r.suplente || null };
  document.getElementById("printArea").innerHTML = htmlFichaImpresa(f);
  // el nombre del archivo PDF sale del título de la página
  const tituloOriginal = document.title;
  document.title = ("Ficha " + f.folio + " - " + (f.estudiante.nombre || "")).trim();
  window.addEventListener("afterprint", () => { document.title = tituloOriginal; }, { once: true });
  window.print();
}
