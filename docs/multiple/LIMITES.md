# Límites de archivos y de correos: valores elegidos y por qué

Todos los límites están en **tres lugares que deben coincidir**: `js/app.js` (se comprueban antes de enviar y avisan de inmediato),
`apps-script/Code.gs` (el servidor los vuelve a comprobar; el navegador no es de fiar) y `supabase/migraciones/002_matricula_multiple.sql`
(máximo de estudiantes). Las pruebas automáticas verifican que los tres coincidan.

## Distinciones importantes (no son lo mismo)

| Concepto | Qué mide | Ejemplo medido |
|---|---|---|
| Tamaño del PDF original | bytes reales del archivo | 89 795 bytes (≈ 88 KB) |
| Tamaño en Base64 | caracteres con que viaja el PDF dentro de la petición (≈ 4/3 del original) | 119 728 caracteres |
| Tamaño de la petición HTTP | todo el texto que envía la página al Apps Script (todos los PDF + el JSON) | ≈ 5 × 119 728 ≈ 600 000 caracteres con 5 alumnos |
| Tamaño acumulado de adjuntos | suma de los PDF reales del correo | ≈ 450 KB con 5 alumnos |
| Límite real del servicio de correo | lo que admite Gmail por mensaje | 25 MB por mensaje (ver fuente) |

## Medición del PDF (antes y después)

Se midió el certificado real (`generarComprobantePDFBase64`) con datos ficticios, en el navegador:

| Versión | Opción | Bytes | Base64 |
|---|---|---|---|
| `main` (producción hoy): jsPDF 2.5.1 | por defecto | 85 734 | 114 312 |
| rama, jsPDF 4.2.1 | **sin** compresión (como estaba) | 279 791 | **373 056** |
| rama, jsPDF 4.2.1 | `compress: true` (**corrección aplicada**) | 89 795 | **119 728** |

Causa del problema: al actualizar jsPDF de 2.5.1 a 4.2.1, la versión nueva dejó de comprimir por defecto y el PDF (que lleva el
logo, 81 KB) se triplicó. La opción `compress: true` existe en jsPDF 4.2.1 (verificado ejecutándola) y devuelve el tamaño al de `main`.
Legibilidad: se extrajo el texto de los PDF generados y se comprobó que contienen el nombre y el folio del estudiante
(prueba `prueba-multiple-navegador.js`); la compresión de jsPDF no pierde información (es compresión Flate sin pérdida).

## Límites elegidos

| Límite | Valor | Por qué |
|---|---|---|
| Estudiantes (certificados) por solicitud | **5** | Cubre familias reales con holgura (casi siempre 1–3). Más de 5 hermanos se registran en una segunda solicitud. Con 5 el correo pesa < 0,5 MB y la página genera 5 PDF en pocos segundos. |
| Tamaño de **cada PDF** (Base64) | **250 000** caracteres (≈ 187 KB reales) | El real mide ≈ 120 000: el doble de margen. Aguanta nombres largos o un logo algo mayor, y rechaza archivos disfrazados de enorme. |
| Suma de **todos los PDF** (Base64) | **1 000 000** caracteres (≈ 750 KB reales) | 5 certificados reales suman ≈ 600 000: 1,7 veces de margen. Está 33 veces por debajo del máximo de Gmail. |
| Tamaño de **toda la petición** | **1 200 000** caracteres | Suma de PDF + JSON. Es un tope de seguridad contra peticiones gigantes; Google no documenta un límite de lo que recibe `doPost`, por eso se mantiene muy bajo (ver «pendiente»). |
| Correos **por destinatario y por día** | **5** | Ver abajo. |
| Correos **globales por día** | **100** (configurable con `LIMITE_DIARIO`, máximo 300) | Sin cambios respecto a la versión anterior. La cuota de Gmail/Apps Script es mayor; el tope propio es un freno contra abuso. |
| Reintentos de envío por solicitud | **6** | Impide insistir sin fin sobre una solicitud que falla. |
| Antigüedad para que un funcionario envíe | **24 horas** | Pasado ese tiempo solo el panel de encargados puede reenviar. |

### Por qué 5 correos por destinatario (y no 2, ni más)

* Antes era 2 y **contaba un correo por alumno**. Ahora una solicitud de 1 a 5 hermanos es **un solo correo**, así que el límite deja de
  castigar a las familias numerosas: ya no confunde «número de estudiantes» con «número de correos».
* El límite ahora se cuenta **solo cuando el correo realmente salió**: los reintentos fallidos no gastan cupo, y un reintento de una
  solicitud ya enviada no vuelve a enviar (ni a contar).
* Un mismo correo puede legítimamente recibir más de un mensaje en un día (dos solicitudes separadas, una corrección, el reenvío de otra
  familia que comparte correo). 5 deja margen para eso y sigue frenando a quien intente usar el servicio para inundar una dirección.
* Si en la práctica hiciera falta otro valor, se cambia `MAX_POR_DESTINATARIO` en `Code.gs` (una línea) y se vuelve a implementar.

## Comportamiento cuando algo excede un límite

* **Nunca se envía «una parte».** Si falta un certificado, sobra uno, no coincide un folio, un PDF es inválido o la suma es demasiado grande,
  **no sale ningún correo** y se informa el motivo.
* Las matrículas **ya están guardadas** (el guardado ocurre antes del correo) y se conservan. La solicitud queda en estado `pendiente` o
  `error` y se puede reintentar desde la pantalla final o desde el panel (✉️) **sin duplicar** matrículas, folios ni correos.
* Los tamaños se comprueban **antes de enviar** (en la página) y otra vez en el servidor.

## Fuentes y verificación pendiente

* Cuotas de Google Apps Script (adjuntos 25 MB por mensaje, 50 destinatarios por mensaje, UrlFetch POST 50 MB):
  <https://developers.google.com/apps-script/guides/services/quotas>. Google puede cambiar estos valores sin aviso: revisarlos al
  momento de la prueba real.
* **Pendiente de verificación real:** el tamaño máximo que acepta `doPost` de una aplicación web de Apps Script **no está documentado** por
  Google. Se eligió un tope bajo (1,2 M de caracteres, ≈ 0,9 MB) y debe confirmarse en la prueba controlada con Gmail real
  (solicitud de 3 y de 5 estudiantes). Si fallara con 5, se bajaría el máximo de estudiantes por solicitud.
