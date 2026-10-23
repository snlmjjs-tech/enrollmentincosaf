# Seguridad de la plataforma de matrículas

Esta carpeta documenta las correcciones de seguridad de la rama `seguridad-matriculas`.
**Nada de esto está publicado**: la versión en producción es la de `main` hasta que se autorice la publicación.

| Documento | Contenido |
|---|---|
| [`publicacion.md`](publicacion.md) | **Procedimiento paso a paso para publicar** sin interrumpir el servicio, y cómo volver atrás |
| [`credenciales.md`](credenciales.md) | Qué credenciales están expuestas, cuáles hay que cambiar y cómo |
| [`codigos-intentos-formulario.md`](codigos-intentos-formulario.md) | Límite de intentos, códigos de pre-matrícula y protección del formulario público |
| [`limpieza.md`](limpieza.md) | Eliminación automática de pre-matrículas vencidas |
| [`minificacion.md`](minificacion.md) | Evaluación de minificar el JavaScript |

## Qué cambia

| Riesgo detectado | Corrección | Dónde |
|---|---|---|
| Código malicioso en nombres, observaciones, etc. se ejecutaba en el navegador del personal (`innerHTML`) | Todo dato se inserta como texto (`esc()`, plantilla `h` y `textContent`); la tabla del panel se arma con elementos DOM; los botones ya no llevan `onclick` con datos | `js/app.js` |
| Sin política de contenido | CSP estricta (`script-src 'self'`) y sin manejadores en línea; ningún script externo | `index.html` |
| Librerías de CDN sin verificación y desactualizadas | Alojadas en `vendor/`, con versiones actualizadas y `SHA256SUMS` | `vendor/` |
| Secreto del correo en el código público | Se elimina. El script de Google comprueba una sesión de funcionario contra Supabase y arma él mismo el texto | `js/app.js`, `apps-script/Code.gs` |
| La clave viajaba en cada solicitud y se guardaba en el navegador | Al ingresar se entrega un token aleatorio de corta duración (12 h funcionarios, 3 h panel), revocable | `supabase/schema.sql`, `js/app.js` |
| Intentos de clave ilimitados | Bloqueo por dirección de red tras 10 fallos en 15 min (y tope general de respaldo) | `supabase/schema.sql` |
| Códigos de 4 dígitos fáciles de recorrer | Códigos nuevos de 6 caracteres; consulta de códigos limitada (15 inexistentes / 10 min); los de 4 dígitos vigentes siguen valiendo | `supabase/schema.sql` |
| Formulario público sin controles | Validación en el servidor (campos permitidos, tamaño, RUT, correo, sin `<` `>`), límite por dirección (8/hora), campo trampa y tope de pendientes | `supabase/schema.sql`, `index.html` |
| Pre-matrículas viejas dependían de que llegara otra solicitud | Tarea diaria (`pg_cron`) que borra solo pre-matrículas vencidas, sesiones e intentos; nunca matrículas | `supabase/programar_limpieza.sql` |
| Sin registro de acciones | Tabla `auditoria` (sin datos personales) y función `listar_auditoria` | `supabase/schema.sql` |
| Errores internos visibles | Solo se muestran mensajes escritos para el usuario; el resto va a la consola | `js/app.js` |

## Pruebas (`tests/seguridad/`)

Se ejecutan en un Postgres **local** y un navegador **headless**, con datos ficticios. No tocan ningún servicio real.

```bash
npm install pg playwright                 # una vez
tests/seguridad/prepara-postgres.sh /tmp/pg 5499 <esquema-de-produccion.sql>
PGPORT=5499 node tests/seguridad/prueba-sql.js          # base de datos: 106 pruebas
PGPORT=5499 node tests/seguridad/prueba-navegador.js    # página real con la CSP: 66 comprobaciones
```

`prueba-pagina-actual.js` comprueba que la versión publicada hoy siga funcionando con el SQL nuevo.
Cada archivo explica en su cabecera cómo usarlo. Las pruebas **no** sustituyen una revisión en el entorno real: ver «Riesgos pendientes» en el informe.

## Nota de mantenimiento
La CSP de `index.html` (`connect-src`) permite hablar solo con el proyecto de Supabase actual y con Google Apps Script. Si algún día
cambia la dirección del proyecto de Supabase o se agrega otro servicio, hay que actualizar esa lista; de lo contrario el navegador bloqueará la conexión
(se vería como «Ocurrió un problema al comunicarse con el servidor»).
