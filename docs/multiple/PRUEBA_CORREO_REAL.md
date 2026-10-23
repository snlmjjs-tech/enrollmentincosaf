# Prueba controlada con Gmail real (opcional; requiere tu autorización expresa)

> **Esto NO se ejecuta por sí solo ni lo ejecuta Claude.** Ningún correo real se envía durante las pruebas automáticas (usan un simulador de Gmail).
> Esta prueba la haces tú, en tu cuenta de Google, con una dirección que tú controlas, y solo después de escribir tu autorización.
> Un Apps Script de pruebas **independiente** del de producción. No se toca el de producción.

## Autorización (se escribe antes de empezar)

Para que se considere autorizada, escribe en el chat algo como: **«Autorizo la prueba real de correo a `<tu-direccion>`»**. Sin esa frase, no se realiza.
Cuando la escribas, la prueba la ejecutas tú siguiendo estos pasos (Claude no tiene acceso a tu Gmail ni a tu Apps Script).

## Qué se va a comprobar

Una solicitud ficticia de **2 o 3 estudiantes** genera **un único correo** a **tu** dirección con **todos** los certificados PDF adjuntos.

## Preparación (una sola vez)

### A. Crear el Apps Script de pruebas (separado de producción)

1. Entra a <https://script.google.com> con tu cuenta y pulsa **Nuevo proyecto**. Nómbralo **«INCOSAF - Certificados (PRUEBA)»**. *No abras ni modifiques el proyecto de producción.*
2. Borra el contenido de `Código.gs` y pega **todo** el archivo `apps-script/Code.gs` del repositorio (rama `seguridad-matriculas`). Guarda.
3. **Configuración del proyecto** (engranaje) → **Propiedades del script** → **Agregar propiedad** (una por fila):

| Propiedad | Valor |
|---|---|
| `ENTORNO` | `prueba` |
| `SUPABASE_URL` | `https://<ID-DE-PRUEBAS>.supabase.co` (la URL de tu proyecto **de pruebas**) |
| `SUPABASE_KEY` | la clave **publishable** del proyecto de pruebas (`sb_publishable_…`). **Nunca** una clave secreta |
| `SECRETO_SCRIPT` | 🔒 el mismo texto que usaste como `SECRETO_SCRIPT_PRUEBA` en el SQL 03 (cópialo desde tu gestor de contraseñas) |
| `DESTINATARIOS_PRUEBA` | **tu** correo de prueba (si son varios, sepáralos con coma). En modo prueba solo se envía a estas direcciones |
| `NOMBRE_COLEGIO` | `Colegio TEST` (o el nombre que quieras mostrar) |
| `CORREO_CONTACTO` | tu correo (opcional; es el «responder a») |
| `LIMITE_DIARIO` | `10` (opcional; tope bajo para pruebas) |

   Si `ENTORNO` no es `prueba`/`produccion`, falta alguna propiedad, el secreto tiene menos de 20 caracteres, `DESTINATARIOS_PRUEBA` está vacío en modo prueba, o la
   URL de Supabase es la de producción, **el script se niega a enviar** (devuelve «configuracion»).
4. **Implementar** → **Nueva implementación** → tipo **Aplicación web** → *Ejecutar como:* **Yo** · *Quién tiene acceso:* **Cualquier persona** → **Implementar**.
   Google pide autorizar permisos (enviar correo como tú, conectarse a servicios externos): acéptalos en **tu** cuenta.
5. Copia la **URL de la aplicación web** (termina en `/exec`).

### B. Regenerar la página de pruebas con esa URL

```bash
node herramientas/preparar-prueba.js \
  --supabase-url https://<ID-DE-PRUEBAS>.supabase.co \
  --supabase-key sb_publishable_<CLAVE-PUBLICA-DE-PRUEBAS> \
  --apps-script-url https://script.google.com/macros/s/<ID-DEL-SCRIPT>/exec
cd .prueba-local && python3 -m http.server 8080
```

## Lista de verificación **antes** de enviar (todas deben cumplirse)

| # | Comprobación | Cómo verificarlo |
|---|---|---|
| 1 | Supabase apunta al proyecto de **pruebas** | La franja roja de la página muestra el ID de pruebas; `06_diagnostico.sql` da todo OK en ese proyecto |
| 2 | El Apps Script es **independiente** de producción | Es el proyecto «(PRUEBA)» que creaste; su URL `/exec` **no** es la de `js/app.js` de producción (el generador lo comprueba) |
| 3 | Las credenciales son de pruebas | `SUPABASE_URL`/`KEY` del script son los de pruebas; `ENTORNO = prueba` |
| 4 | El destinatario es una dirección **autorizada que controlas** | El correo del apoderado de la ficha = uno de `DESTINATARIOS_PRUEBA` |
| 5 | Todos los datos son **ficticios** | Nombres con «TEST»; RUT de la guía; ningún dato real |
| 6 | Los certificados corresponden a esas matrículas | Se comprueba solo: el script exige que los PDF coincidan **exactamente** con las matrículas guardadas |
| 7 | El correo debe incluir todos los PDF | Al recibirlo: 2 o 3 adjuntos, uno por estudiante |
| 8 | El tamaño total cumple los límites | Se comprueba solo (≈ 90 KB por PDF; límites en `LIMITES.md`) |
| 9 | Los controles de seguridad están activos | `06_diagnostico.sql` sin FALLA; modo transición cerrado; el script exige token y secreto |

## Ejecución

1. En la página de pruebas, matricula **2 o 3** estudiantes ficticios (ver `GUIA_ENTORNO_PRUEBA.md` §4). En el **correo del apoderado** escribe **tu dirección autorizada**.
2. «Finalizar». Debe decir: *«Se envió UN correo con los N certificados de matrícula (PDF adjuntos) al correo …»*.
3. Revisa tu bandeja (y **spam**). Debes ver **un solo mensaje**:
   * Asunto: `[PRUEBA] Confirmación de matrícula 2027 - Fichas 1, 2 y 3 (3 estudiantes)` (los números serán los tuyos).
   * Cuerpo: aviso de «mensaje de prueba», el código de solicitud y la lista de estudiantes con condición y curso.
   * **N adjuntos PDF**, `Certificado_matricula_Ficha_<folio>_<nombre>.pdf`. Ábrelos: cada uno con su estudiante y su folio.
4. En Supabase ejecuta `supabase/prueba/08_verificar_envio_correo.sql`: la solicitud debe estar `enviado`, con `correo_intentos = 1`, y **sin** filas duplicadas.

## Pruebas adicionales (opcionales, siempre a tu dirección autorizada)

| Prueba | Qué hacer | Resultado esperado |
|---|---|---|
| Sin duplicar | En el panel, pulsa ✉️ en una solicitud ya enviada (si el botón no aparece, es porque ya está enviada: es lo correcto) | No llega un segundo correo |
| Fallo y reintento | En el Apps Script cambia `ENTORNO` a `otro`, matricula, y verás «no se envió»; vuelve a `prueba` y pulsa «Reintentar el envío» | Las matrículas siguen guardadas; llega un único correo |
| Destinatario no autorizado | Matricula con un correo que no esté en `DESTINATARIOS_PRUEBA` | El script lo rechaza (`destinatario_no_autorizado`); no se envía |
| 5 estudiantes | Matricula 5 hermanos | Un correo con 5 adjuntos (confirma el límite de tamaño de `doPost`) |

## Si el correo no llega

1. Revisa **spam** y «Todos los mensajes».
2. En la página: ¿dijo «Se envió…» o «NO se envió…»? El mensaje indica el motivo.
3. Apps Script → **Ejecuciones**: ahí aparecen los errores del script (el script no registra a propósito nombres ni correos).
4. Supabase → `08_verificar_envio_correo.sql`: `correo_estado` y `ultimo_error`.
5. Cuotas diarias de Gmail/Apps Script: <https://developers.google.com/apps-script/guides/services/quotas>.

## Resultado

Registra el resultado (qué se probó, qué llegó, tamaños) para decidir si el sistema pasa a la siguiente etapa. **Hasta que esta prueba se haga y salga bien, el envío por Gmail real
queda «pendiente de verificación real»**: lo comprobado hasta ahora es con un simulador.
