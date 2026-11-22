# Prototipo: matrícula con datos cifrados (solo datos ficticios)

**No es parte del sistema de matrículas.** Es una demostración independiente, sin conexión a ningún servidor
(su política de seguridad tiene `connect-src 'none'`: no puede enviar nada a internet). La «base de datos» es simulada en el navegador.

## Qué demuestra
1. **Llave del colegio:** se crea una vez. La llave *pública* (que va en la página) solo sirve para cifrar; la *privada* queda en un archivo protegido por una clave.
2. **Apoderado:** llena un formulario y el navegador cifra la ficha con la llave pública. El apoderado no conoce ninguna clave.
3. **Base de datos:** lo que vería un extraño (folio, fecha y texto ilegible).
4. **Panel del colegio:** con el archivo de llave y su clave se descifra, se busca y se descarga el Excel legible. Se bloquea solo a los 10 minutos.

## Cómo está hecho
- Cada ficha: llave AES-256-GCM nueva, envuelta con RSA-OAEP 3072 (llave pública). La ficha queda **atada a su folio**:
  copiar el cifrado de una fila a otra, o cambiar un solo byte, impide abrirla.
- El archivo de llave protege la llave privada con una clave estirada por PBKDF2-SHA256 (600 000 vueltas). Se rechazan claves cortas.
- La llave privada abierta vive solo en memoria y **no es exportable**.
- Solo usa la API estándar del navegador (WebCrypto). No carga nada de internet.

## Cómo probarlo
- Con doble clic: `node herramientas/armar-prototipo-cifrado.js salida.html` arma **un solo archivo** que se abre en Chrome o Edge.
- Pruebas automáticas: `node tests/seguridad/prueba-prototipo-cifrado.js` (módulo de cifrado y pantalla completa).

## Lo que falta antes de integrarlo al sistema real (no está hecho)
- Conectarlo al formulario y a Supabase (hoy el servidor valida y busca; con datos cifrados eso pasa al navegador).
- Rediseñar la verificación del correo (Apps Script compara contra datos guardados) y el índice para detectar RUT duplicados sin ver el RUT.
- Convertir las matrículas ya guardadas, definir quién custodia la llave y en cuántas copias, y un procedimiento si se pierde.
- Una vía para rotar la llave.
- Revisión por el abogado/sostenedor.

## Herramienta de llaves del colegio
Este mismo archivo (`node herramientas/armar-prototipo-cifrado.js salida.html`) sirve para **crear la llave del colegio y las copias por persona**
que usa el cifrado real de las matrículas (ver `docs/cifrado/`). En la pestaña 1: crear la llave, descargar el archivo, hacer una copia para cada persona
con su propia clave y copiar los datos públicos (`window.LLAVE_PUBLICA_COLEGIO = …`) que se pegan en `js/llave-publica.js`.
La llave privada **nunca** sale del computador donde se crea; úsalo de preferencia sin conexión.
