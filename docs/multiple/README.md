# Matrícula de varios estudiantes en una sola solicitud

Esta carpeta documenta la matrícula múltiple, el envío de **un solo correo con un certificado PDF por estudiante**, los límites y cómo
validar todo en un proyecto de Supabase **de pruebas** sin tocar producción.

| Documento | Para qué sirve |
|---|---|
| **este archivo** | Arquitectura, cómo funciona la matrícula múltiple, datos compartidos e individuales, folios, certificados, correo, fallos y reintentos |
| [`LIMITES.md`](LIMITES.md) | Tamaños y cantidades máximas, con mediciones reales y su justificación |
| [`GUIA_ENTORNO_PRUEBA.md`](GUIA_ENTORNO_PRUEBA.md) | Guía paso a paso para instalar y validar en tu proyecto de Supabase de pruebas |
| [`PRUEBA_CORREO_REAL.md`](PRUEBA_CORREO_REAL.md) | Prueba controlada con Gmail real (requiere tu autorización expresa) |
| [`LIMPIEZA_Y_RETIRADA.md`](LIMPIEZA_Y_RETIRADA.md) | Limpiar los datos de prueba, retirar credenciales y eliminar el proyecto |
| [`INDICE_DE_ARCHIVOS.md`](INDICE_DE_ARCHIVOS.md) | Cada archivo: ubicación, finalidad y cuándo se usa |
| [`../seguridad/`](../seguridad/README.md) | Medidas de seguridad previas (XSS, sesiones con token, límites de intentos…) |

## 1. Arquitectura (resumen)

```
Navegador (sitio estático en GitHub Pages: index.html + js/app.js + css + vendor/)
   │  clave pública «publishable» (segura: las tablas no se pueden leer directamente)
   ├──► Supabase (Postgres)  ── solo funciones RPC, RLS activo en todas las tablas
   │       matriculas · solicitudes · prematriculas · config · sesiones · intentos · auditoria
   └──► Google Apps Script (apps-script/Code.gs) ──► Gmail
            │  secreto propio del script (solo en sus propiedades privadas y como hash en Supabase)
            └──► Supabase (reservar_envio / registrar_envio)
```

* **Personal** → inicia sesión con una clave que el servidor cambia por un **token** (se guarda solo su hash). Funcionarios: 12 h; encargados: 3 h.
* **Folios** → un contador en la base (`folio_2027_seq`). Los folios se **reservan** al generar los documentos y solo se pueden usar al guardar esa misma solicitud.
* **Panel de encargados** → lista las matrículas (con su solicitud y estado del correo), filtra, edita, elimina, cambia folios y exporta a Excel.
* **Correo** → lo envía el Apps Script (Gmail). La página no puede enviar correos directamente.
* **Sin servidor propio**: todo lo que está en el JavaScript es público. La seguridad real vive en Supabase y en el Apps Script.

## 2. Cómo funciona la matrícula múltiple

1. El funcionario elige «Estudiante nuevo» o «antiguo» (solo fija la condición del primero) y completa la ficha del **Estudiante 1**.
2. Pulsa **«+ Añadir otro estudiante»**: aparece una ficha nueva con los mismos campos, vacía y claramente rotulada («Estudiante 2»…). Cada ficha
   tiene su **condición obligatoria (nuevo / antiguo)**, independiente de las demás. Hasta **5** estudiantes (ver `LIMITES.md`).
3. Cada ficha adicional tiene un botón **«Quitar este estudiante»** que pide confirmación (protege contra clics accidentales).
4. El apoderado y el suplente se piden **una sola vez**, más abajo en el mismo formulario.
5. Con 2 o más estudiantes, al pulsar «Revisar la solicitud» se muestra un **resumen** (cada estudiante con nombre, curso, condición, validación y
   documentos requeridos; el apoderado una sola vez). Se puede **volver a editar** sin perder nada. Con un solo estudiante el flujo es el de siempre.
6. Si hay errores, el aviso dice **qué estudiante y qué campos** corregir; los datos de los demás no se borran.
7. «Confirmar y generar documentos» reserva los folios y genera, por cada estudiante, 3 autorizaciones + la ficha de antecedentes (4 hojas por alumno).
8. «Finalizar» guarda **todas las matrículas o ninguna** y envía **un solo correo** con un certificado PDF por estudiante.

### Datos compartidos y datos individuales

| Compartidos por toda la solicitud (se piden una vez) | Individuales por estudiante |
|---|---|
| Apoderado titular: nombre, RUT, edad, dirección, comuna, nacionalidad, celular, **correo**, nivel educacional, situación laboral, lugar de trabajo | Condición (nuevo / antiguo) |
| Apoderado suplente (opcional) | Nombre, RUT, fecha de nacimiento, dirección, comuna, nacionalidad, celular, correo |
| Parentesco «general» del apoderado | Colegio de procedencia (nuevo) · curso y letra (antiguo) · **curso al que ingresa** (nuevo, opcional) |
| | Repitencia, PIE (diagnóstico y documentación), salud, observaciones |
| | **Parentesco con ese estudiante** y «¿vive con él?» (opcionales; si se dejan en blanco rige el del apoderado) |

> Decisión: se agregó el campo **opcional «Curso al que ingresa (2027)»** para estudiantes **nuevos**, porque la matrícula múltiple y los filtros
> del panel por curso necesitan un curso por alumno y antes solo los antiguos lo tenían. Es opcional para no alterar el flujo individual; si no se
> desea, se elimina el campo `e_cursoNuevo` de `index.html`.

### Cómo se guarda y se relaciona

* **Una fila de `matriculas` por estudiante**, con su propio folio y su propia ficha completa (la misma forma de siempre, por lo que el panel, las
  exportaciones, la impresión y la edición funcionan sin cambios).
* La tabla **`solicitudes`** agrupa los hermanos: `matriculas.solicitud_id` (mismo valor para todos) y `matriculas.orden` (1, 2, 3…). El identificador
  común **no sustituye** a los folios.
* `solicitudes` también guarda los **folios reservados** y el **estado del correo** (`pendiente`, `enviando`, `enviado`, `error`, `sin_correo`).
* Las matrículas anteriores no tienen solicitud (`NULL`) y siguen funcionando igual.
* Migración: [`supabase/migraciones/002_matricula_multiple.sql`](../../supabase/migraciones/002_matricula_multiple.sql) (aditiva e idempotente; no borra nada).

### Folios, duplicados y errores parciales

* `reservar_folios(solicitud, n)` entrega n folios **y los asocia a esa solicitud**. Repetir la llamada devuelve los mismos folios (no consume otros).
* `guardar_solicitud(solicitud, fichas)` es **una sola transacción**: se guardan todas las matrículas o ninguna. Valida cada ficha (RUT, formatos, caracteres
  no permitidos…) e indica **qué estudiante** falla (`Estudiante 3: el RUT del estudiante no es válido`). Rechaza folios que no sean los reservados, un mismo
  RUT dos veces en la solicitud y apoderados distintos dentro de la solicitud.
* **Reintentos seguros**: doble clic, recarga o un error de red **no duplican** matrículas ni folios. Si ya estaba guardada, el servidor devuelve lo guardado.
  Probado, incluso con la respuesta perdida después de guardar.
* Si un estudiante ya figura en **otra** solicitud (mismo RUT), no se bloquea pero se **avisa** con el número de ficha existente.

## 3. Certificados y correo

* Se genera **un PDF por estudiante** (`Certificado_matricula_Ficha_<folio>_<nombre>.pdf`), cada uno con su folio, nombre, curso y datos institucionales.
  No se combinan en un solo archivo. Se comprimen (`compress: true`): ≈ 90 KB cada uno.
* Se envía **UN solo correo por solicitud** (1 a 5 certificados). El asunto y el cuerpo identifican las fichas y a cada estudiante (condición, curso).
* **El servidor decide**: el destinatario, los nombres, los folios y los cursos salen de Supabase (`reservar_envio`), nunca de lo que envíe el navegador.
  El navegador solo aporta los PDF, que deben corresponder **exactamente** a las matrículas guardadas (mismo conjunto de folios).
* **Nunca se envía «una parte»**: si falta, sobra o no coincide un certificado, o un PDF es inválido o excede los límites, no sale ningún correo.
* Estados en la base: `pendiente` → `enviando` → `enviado` (o `error`). `enviado` solo se marca cuando el servicio de correo aceptó el envío.
* **Reintentos sin duplicar**: una solicitud ya enviada no se vuelve a enviar (lo impiden la base y la memoria del script). Si el script envía y luego
  falla el aviso a la base, el script recuerda el envío y tampoco lo repite.
* Si el correo falla, **las matrículas se conservan**. La pantalla final muestra el botón «Reintentar el envío», y el panel muestra el estado y un botón ✉️
  para reenviar (también tras recargar la página).

### Qué valida el Apps Script antes de enviar

Formato del token y de la solicitud · sesión de funcionario/encargados vigente (en Supabase) · secreto propio del script · solicitud guardada ·
estado y reintentos · tamaño y estructura de cada PDF (`%PDF-` … `%%EOF`) · cantidad (máx. 5), folios sin repetir y coincidencia exacta con la base ·
destinatario con formato válido (sin saltos de línea, comas ni `< >`) · en modo prueba, destinatario dentro de la lista autorizada ·
límites diario y por destinatario · si Supabase no responde, **no envía** (falla cerrada).

Limitación conocida: el script comprueba la **estructura** del PDF y su correspondencia con el folio, pero no su contenido visual (el PDF lo genera el navegador
del funcionario autenticado). Generarlo en el servidor sería una mejora futura.

## 4. Panel de encargados

* Dos columnas nuevas: **Solicitud** (código corto y posición, p. ej. `A1B2C3 · 2/3`) y **Correo** (Enviado / Pendiente / Error / Sin correo, con ✉️ para reenviar).
* Búsqueda también por código de solicitud. Filtros por **curso** y por **condición (nuevo/antiguo)** como siempre.
* Editar, eliminar, imprimir la ficha o cambiar el N° de ficha actúan sobre **un solo estudiante**; sus hermanos no se alteran.
  Si se elimina al último de la solicitud, la solicitud también se retira.
* El Excel principal agrega: Solicitud, N° en la solicitud, Estudiantes en la solicitud y Estado del correo. El Excel «libro digital» mantiene la plantilla del colegio.

## 5. Pre-matrícula del apoderado (`?apoderado`)

El apoderado también puede añadir hijos. Recibe **un solo código** que contiene a todos; el funcionario lo carga y aparecen todos los estudiantes con sus
datos y condición. Con un solo hijo, el formato es el de siempre. Los límites de la pre-matrícula (8 por hora por conexión, campo trampa, códigos de 6 caracteres)
se mantienen.

## 6. Seguridad: qué se conservó y qué se agregó

Se conservan todas las medidas previas (CSP estricta, sin `innerHTML` con datos de personas, sesiones con token, límites de intentos, validación en el servidor,
RLS, permisos mínimos en funciones, auditoría sin datos personales) y sus pruebas. Se agregó: validación por estudiante en el servidor, folios ligados a la solicitud,
guardado atómico e idempotente, destinatario y textos del correo decididos por la base, secreto propio del Apps Script, tope de reintentos, modo prueba con lista de
destinatarios autorizados que **nunca** acepta el proyecto de producción, y validación en el formulario de los símbolos `< >` antes de generar documentos.

**No se declara la plataforma «completamente segura»**: las pruebas automáticas usan servicios simulados. Ver riesgos pendientes en el informe final.

## 7. Servicios, variables y secretos que necesita el sistema

| Elemento | Valor / secreto | Dónde vive | ¿Público? |
|---|---|---|---|
| Supabase: URL del proyecto | `https://<ID>.supabase.co` | `js/app.js` (`SUPABASE_URL`), propiedad `SUPABASE_URL` del Apps Script | Sí |
| Supabase: clave publishable | `sb_publishable_…` | `js/app.js` (`SUPABASE_ANON_KEY`), propiedad `SUPABASE_KEY` del Apps Script | Sí (por diseño) |
| Supabase: clave secreta / `service_role` | — | **No se usa en ninguna parte** | **Nunca** |
| Clave de funcionarios y de encargados | textos largos que solo conoce el personal | Solo como hash en `config` (Supabase) | No |
| Secreto del Apps Script | texto largo y aleatorio | Hash en `config.clave_script_hash` y propiedad `SECRETO_SCRIPT` del script | No |
| Apps Script: URL `/exec` | `https://script.google.com/macros/s/<ID>/exec` | `js/app.js` (`APPS_SCRIPT_URL`) | Sí |
| Modo del script | `ENTORNO` = `prueba` o `produccion`; `DESTINATARIOS_PRUEBA` (solo prueba) | Propiedades del Apps Script | No |
| Datos del correo | `NOMBRE_COLEGIO`, `CORREO_CONTACTO`, `TELEFONO_CONTACTO`, `DIRECCION_COLEGIO`, `LIMITE_DIARIO` | Propiedades del Apps Script | No |
| Servicios externos | Supabase (base de datos), Google Apps Script + Gmail (correo), GitHub Pages (hosting) | — | — |

## 8. Riesgos y limitaciones conocidos

* **El Apps Script es una dirección pública.** Cualquiera puede enviarle peticiones; sin token + secreto no obtiene nada ni envía nada, pero un atacante podría
  gastar la cuota diaria de llamadas del script (denegación de servicio del correo, sin fuga de datos). Mitigaciones: validaciones baratas antes de llamar a Supabase,
  tope diario de correos, secreto propio. Corrección futura posible: CAPTCHA o una función de borde con límite por IP.
* **El PDF lo genera el navegador** del funcionario (ya autenticado). El servidor valida estructura, tamaño y correspondencia con el folio, no el aspecto del contenido.
* **El destinatario es el correo del apoderado de la matrícula de menor orden** de la solicitud (normalmente el estudiante 1). Si se editan los correos de los hermanos
  por separado en el panel, el correo sale al del primero vigente.
* **Los folios reservados que no se usan no se reutilizan** (hay huecos en la numeración si se abandona una solicitud). La limpieza diaria retira las reservas abandonadas
  de más de 30 días, pero no devuelve los números.
* **Gmail/Apps Script** tienen cuotas diarias (ver `LIMITES.md`); el tamaño máximo que acepta `doPost` no está documentado y debe confirmarse en la prueba real.
* **Un mismo RUT en dos solicitudes** no se bloquea (solo se avisa): hay reinscripciones legítimas. El personal debe revisar el aviso.
* **Todo lo anterior se verificó con servicios simulados.** La validación con Supabase y Gmail reales está pendiente (ver las guías).

## 9. Pruebas automáticas

Ver «Ejecución de las pruebas» en el [README principal](../../README.md#pruebas-automatizadas).
