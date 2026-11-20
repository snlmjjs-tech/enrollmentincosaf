# Publicar el cifrado de las matrículas (solo después de autorizarlo)

> **No publiques nada en producción sin haberlo probado antes en el proyecto de pruebas de Supabase** (`docs/multiple/GUIA_ENTORNO_PRUEBA.md`).
> El orden importa: cada paso es compatible con el anterior, así la matrícula nunca se detiene.

## Antes de empezar (decisiones y respaldos)
1. **Quién guarda la llave y en cuántas copias.** Propuesta: director, inspector y encargado, **una copia por persona con su propia clave**, y además
   una copia impresa o en un pendrive **bajo llave**. Sin copias, los datos cifrados no se recuperan.
2. **Respaldo:** panel de encargados → **Descargar Excel** (todas las matrículas actuales) y guárdalo con contraseña en el servidor del colegio.
3. **Plazo de la pre-matrícula:** 2 horas (se cambia con `update public.config set prematricula_horas = 2 where id;`, entre 1 y 72).
4. Hazlo **fuera del horario de matrículas**.

## Paso 1 · Actualizar la base (no corta nada, no cifra nada todavía)
Supabase (proyecto **real**) → SQL Editor → pega **todo** `supabase/migraciones/003_cifrado.sql` → Run. Es aditiva y se puede repetir.
- La página que está publicada hoy sigue funcionando igual.
- Desde este momento la pre-matrícula dura **2 horas** (antes 30 días): las pre-matrículas antiguas pendientes dejan de poder cargarse.
- Comprobar: `select exigir_cifrado, prematricula_horas from public.config;` → `false | 2` y `select count(*) from public.matriculas;` (mismo número que antes).
- Activar la limpieza cada 15 minutos: `supabase/programar_limpieza.sql` (Database → Extensions → pg_cron).

## Paso 2 · Publicar la página con el cifrado APAGADO
Fusiona la rama en `main` (con tu autorización). `js/llave-publica.js` trae `null`, así que la página **no cambia su comportamiento**: se guarda como siempre.
- Espera 1–3 minutos, abre con Ctrl+Shift+R y haz una matrícula de prueba (RUT `2179`). Todo debe funcionar igual que antes. Bórrala del panel.

## Paso 3 · Crear la llave del colegio (en un computador de confianza, sin internet si es posible)
1. `node herramientas/armar-prototipo-cifrado.js Herramienta_de_llave.html` y abre el archivo con doble clic (o pide que te lo entreguen armado).
2. Pestaña **1 · Llave del colegio**: escribe una **clave larga** (4 o 5 palabras al azar con guiones; **no** la compartas por chat) → **Crear llave del colegio**.
3. **Descarga el archivo de llave** (y copia su texto) y guárdalo. Haz **una copia para cada persona** (sección «Hacer una copia de la llave para otra persona»), cada una con su clave.
4. Copia los **datos públicos** que aparecen (`window.LLAVE_PUBLICA_COLEGIO = {...}`): **no son secretos** y es lo único que se envía para publicar.
5. **Prueba que abre:** en la pestaña 4 abre la llave con su clave. Si no abre, no sigas.
6. Reparte las copias. Cierra la herramienta (la «base» de la demostración no se usa en producción).

## Paso 4 · Encender el cifrado
Pega los datos públicos en `js/llave-publica.js` (`window.LLAVE_PUBLICA_COLEGIO = {"kid":"…","publica":"…"};`) y publícalo en `main` (con tu autorización).
- Con Ctrl+Shift+R, haz una matrícula de prueba (RUT `2179`): debe funcionar igual, el aviso de privacidad ahora dice «se guardan cifrados» y el consentimiento lo menciona.
- Comprobar en Supabase: `select folio, tipo, left(datos::text, 80) from public.matriculas order by folio desc limit 3;` → la última fila es texto sin sentido (`{"v": 1, "alg": ...`).
- Panel: entra con la clave del panel → pide la llave → desbloquea → se ve la matrícula de prueba. Descarga el Excel y revisa que sale legible. Bórrala.

## Paso 5 · Cifrar las matrículas que ya existían
Panel (desbloqueado) → aviso «⚠️ N matrícula(s) todavía sin cifrar» → **Cifrar ahora**. Cada una se cifra, se comprueba que se puede abrir y recién entonces se reemplaza.
- Comprobar: `select count(*) from public.matriculas where not (datos ? 'ct');` → `0`.
- Las **copias de seguridad** que Supabase haya hecho antes pueden conservar datos sin cifrar por el tiempo que las guarde (revisa Database → Backups).

## Paso 6 · Exigir el cifrado (el seguro)
`update public.config set exigir_cifrado = true where id;` → desde ahora la base **rechaza** guardar cualquier ficha sin cifrar (por ejemplo, desde una página antigua
que alguien dejó abierta). Si una persona ve el aviso de «cifrado_obligatorio», debe recargar con Ctrl+F5.

## Después
- Avisa al personal: nada cambia para quien matricula; el panel pide la llave. Cada persona del panel usa **su** copia y **su** clave.
- **Excel:** ponle contraseña (Excel: Archivo → Información → Proteger libro → Cifrar con contraseña) y guárdalo en el servidor del colegio; el Excel NO está cifrado.
- Haz **Excel de respaldo periódicos** y el **«Respaldo cifrado»** del panel (no necesita la llave y se puede guardar sin riesgo).
- Si una persona deja el colegio, retira su copia. Si hay sospecha de que una copia y su clave estén comprometidas, hay que **crear una llave nueva** y volver a cifrar (pídelo).

## Marcha atrás
- `update public.config set exigir_cifrado = false where id;` y publicar `js/llave-publica.js` con `null`: las matrículas nuevas se guardan sin cifrar otra vez.
  Las ya cifradas siguen cifradas (el panel necesita la llave para leerlas): **no se pierde nada**.
- La migración 003 no se deshace; no hace falta: con el cifrado apagado todo funciona como antes.

## Si se pierde la llave
Sin el archivo de llave y su clave **no hay forma de leer las matrículas cifradas**. Se recupera con los Excel de respaldo (si los hay). Por eso las copias y los respaldos.
