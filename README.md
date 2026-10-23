# Matrícula INCOSAF 2027

Sistema de matrícula del Instituto Comercial Alberto Valenzuela Llanos (San Fernando).

```
index.html              estructura de las pantallas
css/styles.css          estilos (tokens, componentes, impresión)
js/app.js               lógica: formulario, Supabase, PDF, correo, Excel, QR
js/ui.js                detalles de interfaz (brillo del hero)
assets/logo.png         logo institucional
supabase/schema.sql     base de datos (tablas, sesiones, límites de intentos, validación, auditoría y funciones)
supabase/migraciones/   002_matricula_multiple.sql: varios estudiantes por solicitud, folios reservados, estado del correo (después de schema.sql)
supabase/prueba/        archivos para instalar y validar en un proyecto de Supabase DE PRUEBAS (diagnóstico, datos ficticios, limpieza)
supabase/*.sql          cerrar_transicion.sql y programar_limpieza.sql (se ejecutan a mano, ver docs/seguridad/)
herramientas/           preparar-prueba.js: genera una copia local de la página conectada solo al proyecto de pruebas
vendor/                 librerías de terceros alojadas en el sitio (con versiones y sumas de verificación)
apps-script/Code.gs     script de Google para el correo (se instala a mano en script.google.com)
tests/seguridad/        pruebas automáticas (base de datos, navegador, Apps Script simulado, PDF, entorno de pruebas)
docs/seguridad/         documentación de seguridad y procedimiento de publicación
docs/multiple/          matrícula de varios estudiantes, límites, guía del entorno de pruebas, prueba de correo y limpieza
.claude/                skills de diseño y agentes
docs/vendor-licenses/   licencias de las skills instaladas
```

Es un sitio estático: sírvelo con cualquier servidor (`python3 -m http.server`) o súbelo tal cual a tu hosting.

## Base de datos (Supabase)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, pega `supabase/schema.sql` y pulsa **Run** (se puede repetir sin perder datos).
3. Define las claves **una sola vez** con la consulta que aparece en la sección *Claves* de `schema.sql` (claves largas y distintas). El archivo no contiene ninguna.
4. **Project Settings → API Keys**: copia la *Project URL* y la clave **publishable** (`sb_publishable_…`) y pégalas en `SUPABASE_URL` y `SUPABASE_ANON_KEY` al inicio de `js/app.js`. Nunca uses una clave secreta (`sb_secret_…`, `service_role`) en la web.
5. Si ya tenías fichas numeradas (por ejemplo hasta la 120), ejecuta `select setval('public.folio_2027_seq', 120);` para que el folio continúe.
6. Para una instalación nueva, ejecuta además `supabase/cerrar_transicion.sql` (el modo de transición es solo para actualizar un sitio que ya está en uso).

Cómo queda protegida la información: el navegador **no puede leer ni escribir las tablas**; solo llama a funciones.
- **Abierta**: enviar una pre-matrícula (la usan los apoderados por QR), con validación en el servidor y límites de frecuencia.
- **Con sesión de funcionario**: pedir folio, guardar una matrícula, cargar y eliminar pre-matrículas por código.
- **Con sesión de encargado**: listar, editar y eliminar matrículas, cambiar folios, ver el registro de actividad, y por tanto el panel y las descargas de Excel.

Hay **dos claves**, guardadas con hash en el servidor (nunca en el código). Al ingresar, la página recibe un **token de sesión** de corta duración; la clave no se guarda ni se vuelve a enviar.
Los intentos fallidos de clave y de códigos se limitan por dirección de red. Detalles en [`docs/seguridad/`](docs/seguridad/README.md).

Cambiar las claves: ver `docs/seguridad/credenciales.md`.

## Matrícula de varios estudiantes

Un apoderado puede matricular hasta **5 hijos en una sola solicitud** («+ Añadir otro estudiante»): los datos del apoderado se piden una vez, cada estudiante
tiene su propia ficha, folio y certificado PDF, y el apoderado recibe **un solo correo con todos los certificados**. La base debe tener aplicada la migración
`supabase/migraciones/002_matricula_multiple.sql` (después de `schema.sql`). Detalles, límites y fallos/reintentos: [`docs/multiple/`](docs/multiple/README.md).

## Entorno de pruebas (Supabase y Apps Script independientes)

Para validar con servicios reales **sin tocar producción**, usa un proyecto de Supabase y un Apps Script **de pruebas** siguiendo
[`docs/multiple/GUIA_ENTORNO_PRUEBA.md`](docs/multiple/GUIA_ENTORNO_PRUEBA.md). La herramienta `herramientas/preparar-prueba.js` genera una copia local de la página
conectada solo al proyecto de pruebas y se niega a usar las direcciones o claves de producción.

## Pruebas automatizadas

Usan una base PostgreSQL **local** y servicios simulados (Supabase y Gmail no se tocan; no se envía ningún correo). Se niegan a ejecutarse si detectan una variable que apunte a producción.

```bash
# Requisitos: Node.js 18+, PostgreSQL (initdb, pg_ctl, psql), Chromium de Playwright y los paquetes npm pg, playwright y xlsx
tests/seguridad/ejecutar-todo.sh /ruta/a/una/carpeta/desechable [esquema-anterior.sql]
```

| Archivo | Qué prueba |
|---|---|
| `prueba-sql.js` | Seguridad de la base: permisos, RLS, sesiones, límites, validación, limpieza, actualización sobre datos existentes |
| `prueba-multiple-sql.js` | Matrícula múltiple en la base: folios, solicitudes, guardado atómico e idempotente, estados del correo, panel, pre-matrícula múltiple |
| `prueba-codegs.js` | `Code.gs` real (Google simulado) + funciones SQL reales: un correo con varios PDF, límites, tokens, reintentos, fallos |
| `prueba-navegador.js` | Página real con la CSP activa: sesiones, flujo individual, XSS, panel, apoderado, QR |
| `prueba-funcional.js` | Flujo individual completo (matrícula, panel, edición, Excel, impresión, pre-matrícula) y comparación con `main` |
| `prueba-multiple-navegador.js` | Matrícula múltiple de extremo a extremo (navegador → Code.gs → SQL): fichas, resumen, certificados, fallos y reintentos, panel, móvil |
| `prueba-pagina-actual.js` | La página publicada hoy sigue funcionando con la base nueva (modo de transición) |
| `prueba-pdf.js` | Tamaño, compresión, contenido y aspecto de los certificados PDF |
| `prueba-entorno-prueba.js` | Los archivos SQL de `supabase/prueba/` en una base vacía, su diagnóstico y sus protecciones |
| `prueba-generador.js` | `herramientas/preparar-prueba.js`: conecta solo al proyecto de pruebas y rechaza producción y claves secretas |
| `prueba-proteccion-produccion.js` | Los scripts de prueba no pueden modificar producción; no hay claves secretas en el repositorio |

Lo que **no** se puede probar de forma automática y queda como validación controlada: Supabase real (cabecera de IP, `pg_cron`, comportamiento de supabase-js contra el
proyecto), Gmail real (entrega, adjuntos, tamaño máximo aceptado por `doPost`) y la impresión en papel.
