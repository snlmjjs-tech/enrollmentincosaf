# Índice de archivos: ubicación, finalidad y cuándo se usa

## SQL (base de datos de Supabase)

| Archivo | Ubicación | Finalidad | Cuándo se ejecuta |
|---|---|---|---|
| `schema.sql` | `supabase/` | Base de seguridad completa: tablas, RLS, sesiones con token, límites de intentos, validación, auditoría, funciones | Primero. En un proyecto de pruebas nuevo y, en su día, en producción (repetible, no borra datos) |
| `002_matricula_multiple.sql` | `supabase/migraciones/` | Matrícula múltiple: tabla `solicitudes`, columnas `solicitud_id`/`orden`, folios reservados, guardado atómico, estados del correo, secreto del script | Después de `schema.sql` (repetible) |
| `cerrar_transicion.sql` | `supabase/` | Cierra el modo de compatibilidad con la página antigua y elimina las funciones que aceptaban la clave directa | En pruebas: tras instalar. En producción: solo después de publicar la página nueva |
| `programar_limpieza.sql` | `supabase/` | Programa la limpieza diaria de pre-matrículas vencidas (requiere `pg_cron`) | Opcional; en producción (ver `docs/seguridad/limpieza.md`) |
| `00_comprobar_que_es_el_proyecto_de_pruebas.sql` | `supabase/prueba/` | Solo lee. Se detiene si hay matrículas que no son de prueba | Siempre antes de ejecutar algo en el proyecto de pruebas |
| `03_claves_prueba.sql.ejemplo` | `supabase/prueba/` | **Plantilla** para guardar las 3 claves de prueba (hash). Se edita y se pega; no se guarda con claves | Después de 002 |
| `05_datos_ficticios.sql` | `supabase/prueba/` | 2 matrículas y 1 pre-matrícula ficticias «TEST» (opcional) | Tras instalar |
| `06_diagnostico.sql` | `supabase/prueba/` | Solo lee. Comprueba tablas, columnas, funciones, permisos y RLS; todas las filas deben decir OK | Tras instalar y cada vez que algo cambie |
| `07_verificar_folios.sql` | `supabase/prueba/` | Solo lee. Folios repetidos, solicitudes, huecos, una fila por estudiante | Tras matricular a los estudiantes de prueba |
| `08_verificar_envio_correo.sql` | `supabase/prueba/` | Solo lee. Estado del correo por solicitud y auditoría | Antes/después de la prueba real del correo |
| `09_limpiar_datos_ficticios.sql` | `supabase/prueba/` | Borra los datos TEST (se detiene si hay datos que no son de prueba) | Al terminar las pruebas |
| `10_retirar_credenciales_de_prueba.sql` | `supabase/prueba/` | Invalida las 3 claves de prueba y cierra las sesiones | Al terminar (después de 09) |

Los números del 00 al 10 indican el orden en el proyecto de pruebas: 00 → 01 `schema.sql` → 02 `002_…` → 03 → 04 `cerrar_transicion.sql` → 05 → 06 → (pruebas: 07, 08) → 09 → 10.

## Aplicación y herramientas

| Archivo | Ubicación | Finalidad |
|---|---|---|
| `index.html`, `css/styles.css`, `js/app.js` | raíz | La página (estática). Una sola fuente para producción y pruebas |
| `Code.gs` | `apps-script/` | Script de Google que envía el correo con los certificados (se pega a mano en `script.google.com`; un proyecto distinto para pruebas) |
| `preparar-prueba.js` | `herramientas/` | Genera `.prueba-local/`: copia de la página conectada **solo** al proyecto de pruebas (rechaza producción y claves secretas) |
| `vendor/` | raíz | Librerías de terceros alojadas en el sitio, con versiones y sumas de verificación |

## Pruebas automáticas (`tests/seguridad/`)

`ejecutar-todo.sh` corre todas. Las demás: `prueba-sql.js`, `prueba-multiple-sql.js`, `prueba-codegs.js`, `prueba-navegador.js`, `prueba-funcional.js`,
`prueba-multiple-navegador.js`, `prueba-pagina-actual.js`, `prueba-pdf.js`, `prueba-entorno-prueba.js`, `prueba-generador.js`, `prueba-proteccion-produccion.js`.
Apoyo: `prepara-postgres.sh` (base local que imita a Supabase), `rpc-local.js`/`rpc-sync.js` (llamadas a las funciones SQL como lo hace la API), `apps-script-simulado.js`
(Google simulado), `guardia-entorno.js` (impide usar producción).

## Documentación

`docs/multiple/`: `README.md` (arquitectura y funcionamiento), `LIMITES.md`, `GUIA_ENTORNO_PRUEBA.md`, `PRUEBA_CORREO_REAL.md`, `LIMPIEZA_Y_RETIRADA.md`, este índice.
`docs/seguridad/`: medidas de seguridad, credenciales, publicación y reversión.
