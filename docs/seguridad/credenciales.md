# Credenciales y secretos: propuesta

> Principio: un sitio estático (GitHub Pages) **no tiene dónde guardar secretos**. Todo lo que se escribe en
> un archivo `.js` o `.html` lo recibe el navegador de cualquier visitante, aunque venga de una variable de
> entorno en una compilación. Los secretos deben vivir **en un servicio que corra en un servidor**
> (la base de datos de Supabase o Google Apps Script) y la página solo debe mostrar pruebas de identidad
> de corta duración (tokens).

## Qué hay hoy y qué hacer

| Credencial | Para qué sirve | Dónde está expuesta | Acción | Dónde debe vivir |
|---|---|---|---|---|
| **Secreto del correo** (`APPS_SCRIPT_SECRETO`) | Autoriza a quien llame al script de Google a enviar correos desde la cuenta del colegio | `js/app.js` actual y 3 versiones del historial | **Eliminarlo del código (hecho en la rama) e instalar `apps-script/Code.gs`.** Ya no existe un secreto compartido: el script valida el token de sesión contra Supabase | No hay secreto. Solo la URL y la clave pública de Supabase, en *Propiedades del script* |
| **Clave de funcionarios** | Entrar a registrar matrículas | Estuvo escrita en el historial público (era la clave del panel) | **Cambiar por una nueva, larga y única** (SQL en `supabase/schema.sql`, sección *Claves*) | Solo en la base, como hash (`config.clave_interna_hash`) |
| **Clave de encargados** | Abrir el panel | Derivada de la anterior (fácil de adivinar) | **Cambiar por otra distinta** | Solo en la base (`config.clave_hash`) |
| **Configuración de Firebase** (`apiKey`, `databaseURL`…) | Base antigua, ya sin uso | Historial de Git | **Eliminar el proyecto de Firebase** (o dejar reglas `".read": false, ".write": false`). La `apiKey` de Firebase no es un secreto, pero identifica una base que debe cerrarse | — |
| **Clave `sb_publishable_…`** (Supabase) | Identifica el proyecto ante la API | `js/app.js` | **No se rota.** Es pública por diseño: la seguridad la dan RLS y las funciones con token | En el JavaScript (está bien) |
| **Clave secreta de Supabase** (`sb_secret_…` / `service_role`) | Acceso total a la base | **No está** en el repositorio ni en su historial | Mantenerla fuera de todo archivo. Si alguna vez se pegó en un chat o captura completa, regenerarla en *Project Settings → API Keys* | Nunca en el repositorio |
| **Token de sesión** (nuevo) | Prueba de que se ingresó con una clave | — | Se genera solo; vence en 12 h (funcionarios) o 3 h (panel); «Cerrar acceso» lo invalida | Navegador (pestaña) / memoria |

Las claves del historial de Git **no se pueden «borrar»** de forma práctica en un repositorio público (ya pudieron
ser copiadas). Lo que protege es **cambiar las credenciales**. Reescribir el historial es destructivo y no se hace sin tu autorización.

## Pasos manuales (nada de esto lo hizo la rama)

### A. Claves de funcionarios y encargados (Supabase)
1. SQL Editor → nueva consulta. Reemplaza los textos entre comillas y ejecuta:
   ```sql
   update public.config
      set clave_interna_hash = extensions.crypt('NUEVA_CLAVE_FUNCIONARIOS', extensions.gen_salt('bf')),
          clave_hash         = extensions.crypt('NUEVA_CLAVE_ENCARGADOS',  extensions.gen_salt('bf'))
    where id;
   ```
2. **Comprobar:** `select public.verificar_clave_interna('NUEVA_CLAVE_FUNCIONARIOS'), public.verificar_clave('NUEVA_CLAVE_ENCARGADOS');` → `true, true`.
   (Las funciones de verificación existen mientras dure el modo de transición; tras `cerrar_transicion.sql` se prueba entrando a la página.)
3. **Cuándo es seguro dejar de usar la anterior:** de inmediato. Cambiarla en la base la deja inservible; solo hay que avisar al personal.
   Esto se puede hacer **hoy**, sin esperar a publicar la rama.
4. Recomendación: 12 caracteres o más, sin relación con el nombre del colegio ni con el año; distintas entre sí.

### B. Script de Google (correo)
0. **Secreto propio del script** (nuevo, para la matrícula múltiple): inventa un texto largo y aleatorio (≥ 20 caracteres; por ejemplo
   `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`), guárdalo en tu gestor de contraseñas y regístralo **como hash** en Supabase
   (migración `002` ya aplicada): `update public.config set clave_script_hash = extensions.crypt('EL_SECRETO', extensions.gen_salt('bf')) where id;`
   El mismo texto va en la propiedad `SECRETO_SCRIPT` del script. Solo lo conocen la base (hash) y el script; **nunca** va en la página, el chat ni GitHub.
1. Abre `script.google.com` → el proyecto actual del correo. **Copia el código actual a un archivo aparte** (respaldo).
2. Reemplaza el código por el de `apps-script/Code.gs`.
3. Engranaje → **Propiedades del script** → agrega `ENTORNO` = `produccion`, `SUPABASE_URL`, `SUPABASE_KEY` (la clave **pública** `sb_publishable_…`), `SECRETO_SCRIPT` (paso 0),
   `NOMBRE_COLEGIO`, `CORREO_CONTACTO`, `TELEFONO_CONTACTO`, `DIRECCION_COLEGIO` y (opcional) `LIMITE_DIARIO`. Para **pruebas** usa un proyecto de Apps Script distinto con `ENTORNO` = `prueba`
   y `DESTINATARIOS_PRUEBA` (ver `docs/multiple/PRUEBA_CORREO_REAL.md`).
   Si existía una propiedad con el secreto antiguo, **bórrala**.
4. **Implementar → Administrar implementaciones →** lápiz → *Versión: Nueva versión* → Implementar. Así la dirección `/exec` no cambia.
   Ejecutar como: *Yo*; acceso: *Cualquier persona*.
5. **Orden importante:** el script nuevo deja de aceptar la página antigua (que envía el secreto). Hazlo **justo antes** de publicar la página nueva (ver `publicacion.md`).
6. **Comprobar:** registra una matrícula de prueba con tu correo y revisa que llegue el certificado. En *Ejecuciones* del script no debe haber errores.
   Prueba negativa: desde una ventana de incógnito, un envío sin sesión debe responder `sesion_invalida`.
7. **Revocar lo anterior:** al publicar la nueva versión, el secreto antiguo deja de significar algo (el código ya no lo lee). Si existe otra implementación
   antigua del mismo script, archívala en *Administrar implementaciones*.
8. Cuenta de Google: activa la verificación en dos pasos y, si es `@gmail.com`, ten presente el límite de ~100 correos al día (`LIMITE_DIARIO` ya trae 100 por defecto).

### C. Firebase
Consola de Firebase → proyecto `matricula-incosaf-2027` → *Realtime Database → Reglas*: si hace falta conservarlo unos días, deja `{ "rules": { ".read": false, ".write": false } }`;
después, *Configuración del proyecto → Eliminar proyecto*.

## Cómo comprobar que todo quedó bien
- Buscar en el repositorio publicado que no aparezcan secretos: `git grep -i -E "secreto|secret|service_role" -- index.html js` solo debe dar comentarios (las casillas `type="password"` son los campos para escribir la clave).
- La página pide la clave nueva y rechaza la anterior.
- El correo llega y no hay ningún valor fijo de autorización en `js/app.js`.
