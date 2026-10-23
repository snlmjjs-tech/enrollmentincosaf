# Matrícula INCOSAF 2027

Sistema de matrícula del Instituto Comercial Alberto Valenzuela Llanos (San Fernando).

```
index.html              estructura de las pantallas
css/styles.css          estilos (tokens, componentes, impresión)
js/app.js               lógica: formulario, Supabase, PDF, correo, Excel, QR
js/ui.js                detalles de interfaz (brillo del hero)
assets/logo.png         logo institucional
supabase/schema.sql     base de datos (tablas, sesiones, límites de intentos, validación, auditoría y funciones)
supabase/*.sql          cerrar_transicion.sql y programar_limpieza.sql (se ejecutan a mano, ver docs/seguridad/)
vendor/                 librerías de terceros alojadas en el sitio (con versiones y sumas de verificación)
apps-script/Code.gs     script de Google para el correo (se instala a mano en script.google.com)
tests/seguridad/        pruebas de seguridad (base de datos y navegador)
docs/seguridad/         documentación de seguridad y procedimiento de publicación
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
