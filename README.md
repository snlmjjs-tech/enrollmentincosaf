# Matrícula INCOSAF 2027

Sistema de matrícula del Instituto Comercial Alberto Valenzuela Llanos (San Fernando).

```
index.html              estructura de las pantallas
css/styles.css          estilos (tokens, componentes, impresión)
js/app.js               lógica: formulario, Supabase, PDF, correo, Excel, QR
js/ui.js                detalles de interfaz (brillo del hero)
assets/logo.png         logo institucional
supabase/schema.sql     base de datos (tablas, folio, seguridad y funciones)
.claude/                skills de diseño y agentes
docs/vendor-licenses/   licencias de las skills instaladas
```

Es un sitio estático: sírvelo con cualquier servidor (`python3 -m http.server`) o súbelo tal cual a tu hosting.

## Base de datos (Supabase)

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, pega `supabase/schema.sql`, cambia `CAMBIA_ESTA_CLAVE` por la clave del panel de encargados y pulsa **Run**.
3. **Project Settings → API**: copia la *Project URL* y la clave **anon public**, y pégalas en `SUPABASE_URL` y `SUPABASE_ANON_KEY` al inicio de `js/app.js`. Nunca uses la clave `service_role` en la web.
4. Si ya tenías fichas numeradas (por ejemplo hasta la 120), ejecuta `select setval('public.folio_2027_seq', 120);` para que el folio continúe.

Cómo queda protegida la información: el navegador no puede leer ni escribir las tablas directamente. Solo puede llamar a funciones:
- **Abierta**: crear una pre-matrícula (la usan los apoderados por QR).
- **Con clave interna**: pedir folio, guardar una matrícula, cargar y eliminar pre-matrículas por código.
- **Con clave de encargados**: listar, editar y eliminar matrículas, cambiar folios, y por tanto el panel y las descargas de Excel.

Hay **dos claves**, ambas guardadas con hash en el servidor:
- **Clave interna** (inspectores y profesores): se pide al abrir la página y permite registrar matrículas. Los apoderados que entran por el QR (`?apoderado`) no la necesitan y solo pueden enviar una pre-matrícula.
- **Clave de encargados**: da acceso al panel (ver, editar y eliminar matrículas, Excel, folios). También sirve para entrar a la página.

Definir o cambiar la clave interna: `update public.config set clave_interna_hash = extensions.crypt('TU_CLAVE_INTERNA', extensions.gen_salt('bf')) where id;`

Para cambiar la clave de encargados: `update public.config set clave_hash = extensions.crypt('NUEVA_CLAVE', extensions.gen_salt('bf')) where id;`
