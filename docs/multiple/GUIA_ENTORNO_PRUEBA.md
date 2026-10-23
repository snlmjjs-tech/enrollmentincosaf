# Guía: instalar y validar el sistema en tu proyecto de Supabase **de pruebas**

> **Regla de oro:** todo lo que hagas aquí es en el proyecto de **pruebas**. Nunca pegues estos archivos en el proyecto real de producción.
> Nada de esta guía necesita claves secretas en el chat, en GitHub ni en el JavaScript del navegador.

Tiempo estimado: 45–60 minutos (sin la prueba de correo, que se hace aparte y requiere tu autorización).

## 0. Qué necesitas

| Qué | Para qué |
|---|---|
| El **proyecto de Supabase de pruebas** que creaste | Base de datos de pruebas |
| **Node.js 18 o superior** (`node --version`) | Generar la página de pruebas y ejecutar las pruebas automáticas |
| **Python 3** (`python3 --version`) | Servir la página en tu computador (`python3 -m http.server`) |
| Este repositorio, rama `seguridad-matriculas` | `git checkout seguridad-matriculas` |
| (Solo para la prueba de correo) una cuenta de Google | Un proyecto de Apps Script **distinto** del de producción |

### Comprueba que el proyecto es el de pruebas (obligatorio)

1. Abre tu proyecto de pruebas en Supabase. La barra de direcciones muestra `supabase.com/dashboard/project/<ID>/…`. Ese **<ID>** (20 letras) identifica el proyecto.
2. **El ID del proyecto real de producción empieza con `mtlunre…` y termina `…hvvw`.** El de pruebas debe ser **distinto**. (Según la captura que enviaste, tu proyecto de pruebas
   empieza con `aoehdtr…`; confírmalo tú mirando tu pantalla.)
3. La etiqueta verde «PRODUCTION» junto a `main` en la parte superior de Supabase es el nombre de la *rama de base de datos* por defecto de cualquier proyecto; **no** significa que sea tu
   sistema real.
4. El primer archivo SQL (`00_…`) se detiene solo si encuentra matrículas que no son de prueba.

## 1. Orden de ejecución del SQL

Dónde pegar: Supabase → tu proyecto de pruebas → **SQL Editor** → **New query** → pegar el contenido del archivo → **Run**.
Ejecuta **un archivo por consulta** (consulta nueva para cada uno) y en este orden. En un proyecto nuevo, Supabase puede avisar que la consulta
«contiene operaciones destructivas» (por los `drop … if exists` de limpieza): en un proyecto vacío es seguro aceptar.

| N.º | Archivo (en el repositorio) | Para qué | Cuándo |
|---|---|---|---|
| 00 | `supabase/prueba/00_comprobar_que_es_el_proyecto_de_pruebas.sql` | Solo lee. Se detiene si encuentra matrículas que no son de prueba | **Siempre antes de todo** |
| 01 | `supabase/schema.sql` | Base de seguridad: tablas, RLS, sesiones con token, límites de intentos, funciones | Una vez (se puede repetir sin perder datos) |
| 02 | `supabase/migraciones/002_matricula_multiple.sql` | Matrícula múltiple: solicitudes, folios reservados, estados del correo, secreto del script | Después de 01 |
| 03 | `supabase/prueba/03_claves_prueba.sql.ejemplo` | Guarda las 3 claves de prueba (como hash). **Plantilla: reemplaza los textos entre `<< >>`** | Después de 02 |
| 04 | `supabase/cerrar_transicion.sql` | Cierra el modo de compatibilidad con la página antigua (en el proyecto de pruebas solo existe la página nueva) | Después de 03 |
| 05 | `supabase/prueba/05_datos_ficticios.sql` | (Opcional) 2 matrículas y 1 pre-matrícula ficticias «TEST» para ver el panel con datos anteriores | Después de 04 |
| 06 | `supabase/prueba/06_diagnostico.sql` | Comprueba tablas, columnas, funciones, permisos y RLS. **Todas las filas deben decir OK** | Después de instalar y cada vez que algo cambie |

Otros archivos que usarás más adelante: `07_verificar_folios.sql`, `08_verificar_envio_correo.sql`, `09_limpiar_datos_ficticios.sql`, `10_retirar_credenciales_de_prueba.sql`.

### Cómo completar el archivo 03 sin exponer claves

1. Inventa **3 textos distintos, largos y aleatorios** (mínimo 20 caracteres). Puedes generarlos en tu computador:
   `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` (ejecútalo 3 veces).
2. Pégalos en tu **gestor de contraseñas**: `CLAVE_ENCARGADOS_PRUEBA`, `CLAVE_FUNCIONARIOS_PRUEBA`, `SECRETO_SCRIPT_PRUEBA`.
3. Copia el contenido de `03_claves_prueba.sql.ejemplo` en una consulta nueva del SQL Editor y reemplaza solo lo que está entre `<< >>`.
4. Run. Cierra la pestaña **sin guardar la consulta**. (El SQL guarda solo el *hash*; el texto no queda en la base.)
5. No compartas estas claves en el chat. Las necesitas tú: las dos primeras para entrar a la página de pruebas; la tercera para el Apps Script de pruebas.

### Resultado esperado del diagnóstico (06)

Una tabla con columnas `comprobacion`, `estado`, `detalle`. **No debe haber ninguna fila `FALLA` ni `REVISAR`.** Las filas `INFO` son informativas
(por ejemplo, «pg_cron no está activo: la limpieza diaria es opcional en pruebas»). Si algo dice FALLA, copia **solo esa fila** (no hay secretos en ella) y revisamos.

## 2. Variables y dónde obtener cada valor

Ninguno de estos valores es secreto **excepto** los marcados 🔒, que nunca debes pegar en el chat, en GitHub ni en el navegador.

| Variable | Dónde se usa | De dónde sale |
|---|---|---|
| `PRUEBA_SUPABASE_URL` | Generador de la página de pruebas | Supabase → Project Settings → **API** (o Data API) → **Project URL** (`https://<ID>.supabase.co`) |
| `PRUEBA_SUPABASE_KEY` | Generador (es la clave **pública**) | Supabase → Project Settings → **API Keys** → clave **publishable** (`sb_publishable_…`). **Nunca** la `secret`/`service_role` |
| `PRUEBA_APPS_SCRIPT_URL` | Generador (solo para la prueba de correo) | Apps Script → **Implementar** → **Administrar implementaciones** → URL de la aplicación web (`…/exec`) |
| 🔒 Clave de funcionarios de prueba | La escribes al abrir la página | La inventaste en el paso 03 |
| 🔒 Clave de encargados de prueba | La escribes para abrir el panel | La inventaste en el paso 03 |
| 🔒 `SECRETO_SCRIPT` | Propiedad del Apps Script de pruebas | La inventaste en el paso 03 (el mismo texto, en el Apps Script) |
| `ENTORNO` = `prueba` | Propiedad del Apps Script | Escribe `prueba` |
| `SUPABASE_URL` / `SUPABASE_KEY` | Propiedades del Apps Script | Los mismos valores públicos de arriba |
| `DESTINATARIOS_PRUEBA` | Propiedad del Apps Script | **Tu** correo de prueba autorizado (solo a esas direcciones podrá enviar en modo prueba) |

Las pruebas automáticas (`tests/seguridad/`) **no** necesitan ninguno de estos valores: usan una base local y servicios simulados, y **se niegan a ejecutarse** si detectan
una variable que apunte a producción.

## 3. Conectar la rama de desarrollo **solo** al proyecto de pruebas

La página publicada (`index.html`) **no se modifica**. Para probar, se genera una **copia local** conectada al proyecto de pruebas:

```bash
git checkout seguridad-matriculas
node herramientas/preparar-prueba.js \
  --supabase-url https://<ID-DE-PRUEBAS>.supabase.co \
  --supabase-key sb_publishable_<TU_CLAVE_PUBLICA_DE_PRUEBAS>
cd .prueba-local && python3 -m http.server 8080
```

Abre `http://localhost:8080`. Verás una **franja roja «ENTORNO DE PRUEBAS · proyecto <ID>»** arriba: si no la ves, no estás en la copia de pruebas.
La herramienta **se niega** a generar la copia si: la dirección es la de producción, la clave parece secreta (`sb_secret_…` o `service_role`), o la dirección del Apps Script es
la de producción; y borra el resultado si queda alguna referencia a producción. La carpeta `.prueba-local/` está en `.gitignore` (no se sube a GitHub).

El correo no se enviará hasta que agregues `--apps-script-url` (ver `PRUEBA_CORREO_REAL.md`). Sin eso, todo lo demás se puede probar.

## 4. Matricular dos o tres estudiantes ficticios

Datos ficticios válidos (los RUT tienen dígito verificador correcto pero no corresponden a personas reales). Todos los nombres llevan **TEST**:

| | Nombre | RUT | Condición | Curso |
|---|---|---|---|---|
| Estudiante 1 | Ana TEST Uno | 41.000.001-6 | Antiguo | 1° Medio A |
| Estudiante 2 | Beto TEST Dos | 41.000.002-4 | Antiguo | 3° Medio B (parentesco «Tío(a)», no vive con él) |
| Estudiante 3 | Carla TEST Tres | 41.000.003-2 | Nuevo | 2° Medio (colegio de procedencia: «Colegio TEST») |
| Apoderado | Apoderado TEST | 22.222.222-2 | | correo: **el tuyo autorizado** (o `apoderado.test@example.invalid` si aún no pruebas el correo) |

Para el resto de los campos escribe cualquier texto ficticio (dirección «Calle Ficticia 1», comuna «Comuna TEST», celular `+56 9 0000 0000`). **No uses datos reales.**

1. Abre `http://localhost:8080`, escribe la **clave de funcionarios de prueba**.
2. Elige «Estudiante antiguo» → completa el **Estudiante 1**.
3. Pulsa **«+ Añadir otro estudiante»** → completa el 2 (elige **condición** y, si quieres, el parentesco). Repite para el 3.
4. Completa los datos del **apoderado** (una sola vez). Pulsa **«Revisar la solicitud →»**.
5. En el **resumen** comprueba: 3 estudiantes, curso, condición, validación ✔, apoderado una vez. Prueba «← Volver a editar» y vuelve a «Revisar».
6. **«Confirmar y generar documentos →»**: verás los documentos de cada estudiante (4 hojas por alumno).
7. **«🖨️ Imprimir documentos»** (puedes cancelar el diálogo) → **«Finalizar»**.
8. La pantalla final lista las 3 fichas. Si no configuraste el Apps Script, el mensaje dirá que el correo no está configurado: es lo esperado.

## 5. Verificar folio, registro y certificado de cada estudiante

**Folios y registros** (SQL Editor): ejecuta `supabase/prueba/07_verificar_folios.sql`.
* Bloque A (folios repetidos) y C (solicitudes inconsistentes): **0 filas**.
* Bloque B: una fila por solicitud, con 3 matrículas guardadas y 3 folios distintos.
* Bloque E: una fila por estudiante, con la misma solicitud y el orden 1, 2, 3.

**Panel**: botón «Panel de matrículas registradas», con la clave de encargados. Verás las 3 filas con el mismo código de solicitud (`XXXXXX · 1/3`, `2/3`, `3/3`), su curso, su
condición y el estado del correo. Prueba los filtros por curso y por «nuevo/antiguo».

**Certificado PDF de cada estudiante (sin enviar correo)**: en la pantalla final abre la consola del navegador (F12 → pestaña Console) y pega:

```js
solicitudGuardada.fichas.forEach(f => { const a = document.createElement('a'); a.href = 'data:application/pdf;base64,' + generarComprobantePDFBase64(f); a.download = 'Certificado_Ficha_' + f.folio + '.pdf'; a.click(); });
```

Se descargan **3 archivos**. Ábrelos y comprueba que cada uno muestra **su** estudiante (nombre, RUT, folio, curso/procedencia), el logo y el texto institucional, y que no mezcla hermanos.
Pueden pesar ≈ 90 KB cada uno. Impresión: ábrelos y prueba «Imprimir» (el diseño es de una página carta).

## 6. Prueba del correo (única, controlada, con tu autorización)

Ver [`PRUEBA_CORREO_REAL.md`](PRUEBA_CORREO_REAL.md). **No se ejecuta nada sin tu autorización expresa.**

## 7. Terminar

Ver [`LIMPIEZA_Y_RETIRADA.md`](LIMPIEZA_Y_RETIRADA.md): borrar los datos ficticios (`09_…`), invalidar las claves (`10_…`), retirar el Apps Script de pruebas y, si quieres,
eliminar el proyecto de Supabase de pruebas.

## 8. Si algo no sale

| Síntoma | Qué hacer |
|---|---|
| 00 dice «DETENTE… matrículas que no son de prueba» | Estás en el proyecto equivocado. **No ejecutes nada más.** |
| 06 muestra FALLA | Copia solo esa fila. Suele faltar un paso (02 sin ejecutar, 03 sin reemplazar los `<< >>`, o 04 pendiente) |
| La página dice «Ocurrió un problema al comunicarse con el servidor» | Falta ejecutar 01/02, o la URL/clave no son las del proyecto de pruebas. Revisa la franja roja y `Network` en F12 |
| «La sesión no es válida o venció» | Cierra el acceso y vuelve a entrar con la clave de funcionarios |
| «Clave incorrecta» repetida | Tras 10 intentos fallidos la conexión se bloquea 15 minutos (es una protección). Espera y reintenta con la clave correcta |
| La página no carga estilos o scripts | Abre `http://localhost:8080` desde la carpeta `.prueba-local` (no abras `index.html` con doble clic) |
