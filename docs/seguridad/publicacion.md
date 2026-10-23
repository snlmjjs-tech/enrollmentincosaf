# Publicar los cambios de seguridad y la matrícula múltiple (solo después de autorizarlo)

> **Antes de publicar nada en producción**, la rama debe haberse validado en el proyecto de Supabase **de pruebas** y, si se desea, con una
> prueba real de correo (`docs/multiple/GUIA_ENTORNO_PRUEBA.md` y `docs/multiple/PRUEBA_CORREO_REAL.md`). Esas pruebas aún están **pendientes**.

La rama `seguridad-matriculas` **no está publicada**. GitHub Pages publica únicamente `main`, así que mientras no se fusione, el sitio sigue como está.
Ver los cambios: <https://github.com/snlmjjs-tech/enrollmentincosaf/compare/main...seguridad-matriculas>

## Por qué el orden importa
La página nueva usa funciones SQL nuevas y la página actual usa las antiguas. Para no cortar el servicio, el esquema SQL nuevo trae un
**modo de transición** (`config.modo_transicion = true`): acepta a la vez la clave directa (página actual) y el token (página nueva).
Se comprobó con la página real publicada hoy (`tests/seguridad/prueba-pagina-actual.js`): sigue funcionando con el SQL nuevo.

## Procedimiento

Hazlo **fuera del horario de matrículas**. Tiempo total: 20–30 minutos.

**0. Revisar.** Lee el diff, `docs/seguridad/` y el informe. Si algo no te convence, no continúes.

**1. Respaldar.**
- Panel de encargados → **Descargar Excel** (las matrículas actuales).
- Copia el código actual del script de Google a un archivo aparte.
- Anota las claves actuales que usa el personal.

**2. Actualizar la base (no corta nada).** Supabase → SQL Editor → pega **todo** `supabase/schema.sql` de la rama → Run. Después, en una consulta nueva,
pega `supabase/migraciones/002_matricula_multiple.sql` → Run (matrícula múltiple y estados del correo; es aditiva y se puede repetir).
- Es seguro repetirlo y no borra datos. Deja el modo de transición activo. La migración 002 **debe ir después** de `schema.sql`.
- La página publicada hoy sigue funcionando con ambos archivos (comprobado en `prueba-pagina-actual.js`).
- Define el **secreto del Apps Script** (una sola vez; texto largo y aleatorio que solo conocerán la base y el script, nunca el chat ni GitHub):
  `update public.config set clave_script_hash = extensions.crypt('TU_SECRETO_LARGO', extensions.gen_salt('bf')) where id;`
- Comprobar: `select count(*) from public.matriculas;` (mismo número que antes) y `select modo_transicion from public.config where id;` → `true`.
- Entra a la página **actual** (`matriculas.incosafoficial.cl`) y comprueba que sigue funcionando: clave de funcionarios, un registro de prueba (RUT `2179`) y el panel. Borra la prueba.

**3. Cambiar las claves** (puedes hacerlo ya, funciona con las dos versiones de la página): ver `credenciales.md`, sección A. Avisa al personal.

**4. Ventana de publicación (≈10 minutos).** En este orden y seguidos:
1. *Script de Google (método usado):* se crea un **proyecto de Apps Script NUEVO y aparte** (`apps-script/Code.gs` + propiedades, `ENTORNO` = `produccion` y `SECRETO_SCRIPT`) y su dirección `/exec` queda escrita en `APPS_SCRIPT_URL` de `js/app.js` **dentro de la rama**. El script viejo sigue funcionando mientras tanto, así que **no hay ningún momento sin correos**. Si se prefiere reemplazar el código del script viejo, la página actual no podrá enviar correos hasta publicar (las matrículas se guardan igual).
2. *GitHub:* abre un Pull Request `seguridad-matriculas → main` y fusiónalo (o pídemelo con tu autorización).
3. Espera 1–3 minutos a que Pages publique. Abre la página con **Ctrl+Shift+R** (o en ventana de incógnito).

**5. Probar la página nueva** (con datos ficticios):
- [ ] Pide la clave interna al abrir; la clave incorrecta no entra; la correcta sí.
- [ ] Registrar una matrícula (RUT `2179`), imprimir (vista previa: 4 hojas) y finalizar. **Llega el correo con el certificado.**
- [ ] Panel de encargados con su clave: lista, 🖨️ imprimir ficha, `#` folio, ✏️ editar, 🗑️ eliminar (borra la prueba), Excel y Excel libro digital.
- [ ] La clave de funcionarios **no** abre el panel.
- [ ] Desde otra ventana, `?apoderado`: enviar una pre-matrícula (RUT `2179`) → código con aviso rojo → cargarla como funcionario.
- [ ] Un nombre con `<` en el formulario de apoderado se rechaza con un mensaje claro.
- [ ] **Matrícula múltiple:** «+ Añadir otro estudiante» (2 estudiantes con datos ficticios): resumen, documentos (8 hojas), finalizar → **llega UN solo correo con 2 certificados PDF**. El panel muestra los 2 con el mismo código de solicitud y el correo «Enviado».
- [ ] Contador de folio: déjalo en el número que corresponda.
- [ ] **Dirección de red registrada:** haz 2 claves incorrectas y ejecuta `select ip, count(*) from public.intentos group by ip;` → debe mostrar tu dirección pública (no `sin-ip`). Si dice `sin-ip`, avísame.

**6. Cerrar la transición.** Solo cuando el paso 5 salga bien: ejecuta `supabase/cerrar_transicion.sql`. Desde ese momento la clave directa deja de aceptarse
y se eliminan las funciones antiguas. Vuelve a entrar a la página para confirmar que todo sigue funcionando.

**7. Limpieza automática.** `supabase/programar_limpieza.sql` (ver `limpieza.md`): activar `pg_cron`, programar y comprobar.

**7b. Apagar el script viejo.** Cuando la página nueva ya envía correos bien, en el proyecto de Apps Script **viejo**: *Implementar → Administrar implementaciones → Archivar* (o reemplazar su código por uno vacío). Así el secreto antiguo, que estuvo en el código público, deja de servir.

**8. Después.** Eliminar Firebase, activar la verificación en dos pasos (GitHub, Supabase, Google) y proteger la rama `main` (GitHub → Settings → Branches).

## Si algo sale mal (volver atrás)
- **Antes del paso 6:** en GitHub, *Revert* del Pull Request fusionado (deja `main` como estaba) y reinstala el código antiguo del script de Google (el respaldo del paso 1). La base es compatible con las dos páginas.
- **Después del paso 6:** vuelve a ejecutar `supabase/schema.sql` (recrea las funciones antiguas) y luego `update public.config set modo_transicion = true where id;`; después haz el *Revert* de GitHub y reinstala el script antiguo.
- Si una clave nueva no funciona: vuelve a ejecutar el `update public.config …` de `credenciales.md` con una clave que sepas.
- **Nunca** hace falta tocar las tablas `matriculas` ni `prematriculas`: ninguno de estos pasos las modifica.
