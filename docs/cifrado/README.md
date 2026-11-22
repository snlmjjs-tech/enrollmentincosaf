# Matrículas cifradas: cómo funciona

> Estado: **código listo y probado, cifrado APAGADO por defecto** (`js/llave-publica.js` = `null`). Mientras esté apagado, la página funciona
> exactamente como antes. Para publicarlo sin cortar el servicio, sigue `docs/cifrado/publicacion.md`.

## En una frase
Los datos de cada matrícula se **cifran en el navegador** antes de guardarse. La base de datos (Supabase) solo ve texto sin sentido. Para
leerlos hace falta la **llave del colegio**, que está en un archivo protegido con una clave y que nunca llega a la base ni a GitHub.

## Qué cambia para cada persona
| Quién | Qué cambia |
|---|---|
| **Apoderado** | Nada. Mismo formulario, mismo código de pre-matrícula (que dura 2 horas). |
| **Funcionario que matricula** | Nada. Entra con su clave, carga el código y finaliza. Al guardar, el navegador cifra la ficha (no necesita la llave). |
| **Panel (director, inspector, encargado)** | Entra con la clave del panel y **desbloquea con el archivo de llave + su clave**. Después ve todo igual que antes: buscar, editar, reimprimir, Excel. Se vuelve a bloquear solo a los 10 minutos sin usarlo y al salir. |

## Qué ve un extraño que llegue a la base de datos
- **Cifrado (ilegible):** nombre, RUT, dirección, teléfono, correo, diagnóstico PIE, salud, apoderado, suplente… toda la ficha.
- **A la vista:** folio, fecha de registro, tipo (nuevo/antiguo), a qué solicitud pertenece, estado del correo y cuántas matrículas hay.
- **Durante pocos minutos:** el paquete temporal con el nombre, RUT, curso y correo que necesita el correo de confirmación. Se borra al enviarse el correo
  (o a las 24 horas si el envío falló).
- **Durante 2 horas:** la pre-matrícula del apoderado, sin cifrar, hasta que el funcionario la carga (se borra sola; pasadas las 2 horas el código deja de funcionar).

## Cómo está hecho
- Cada ficha usa una llave AES-256-GCM nueva, que se «envuelve» con la llave pública del colegio (RSA-OAEP 3072). La ficha queda atada a su
  identificador (`matricula:<id>`): cambiarle un byte, o copiarla a otra fila, impide abrirla. Cambiar el folio no afecta.
- El archivo de llave protege la llave privada con una clave estirada con PBKDF2-SHA256 (600 000 vueltas). Cada persona puede tener **su propia copia con su
  propia clave**; todas abren lo mismo (`herramientas/armar-prototipo-cifrado.js` arma la herramienta para crearlas).
- La llave privada abierta vive solo en la memoria de esa pestaña y no es exportable.
- La **llave pública** va en `js/llave-publica.js` (no es secreto). Si alguien con acceso a GitHub la cambia, podría leer las matrículas futuras:
  por eso importan la verificación en dos pasos y proteger `main`.
- La base lo refuerza: `config.exigir_cifrado = true` hace que **rechace** cualquier ficha sin cifrar (una página antigua guardada en el navegador no puede
  saltarse el cifrado).

## Lo que NO protege
- El **Excel**, las hojas impresas y el **correo con el PDF** salen en claro (se protege el Excel con contraseña; ver la guía).
- Las **copias de seguridad** que Supabase haya hecho antes de cifrar pueden conservar datos sin cifrar por el tiempo que las guarde.
- Si se pierden **todas** las copias de la llave (o su clave), los datos cifrados **no se pueden recuperar**. Por eso: dos copias de cada llave en lugares distintos
  y Excel de respaldo periódicos. El botón «Respaldo cifrado» del panel descarga las fichas tal como están (sirven solo con la llave).
- Si alguien altera el código de la página en GitHub (o cambia la llave pública) puede leer lo que se guarde después.

## Qué hace el panel con lo cifrado
- Lista las matrículas y las **descifra en el navegador**; por eso la búsqueda, el filtro y el Excel funcionan igual.
- Avisa si hay matrículas **sin cifrar** (las anteriores al cambio) y ofrece **«Cifrar ahora»**: cada una se cifra, se comprueba que se puede abrir y recién entonces se reemplaza.
- Avisa de **RUT repetidos** entre solicitudes (la base ya no puede hacerlo porque no ve los datos).
- Si hay matrículas que no abren con esta llave (otra llave, o datos alterados), lo dice.

## Archivos
- `js/cifrado.js`: el cifrado (el mismo módulo usa la página y la herramienta de llaves).
- `js/llave-publica.js`: la llave pública (null = apagado).
- `supabase/migraciones/003_cifrado.sql`: funciones nuevas, seguro `exigir_cifrado`, pre-matrícula de 2 horas, paquete temporal del correo.
- `supabase/programar_limpieza.sql`: limpieza cada 15 minutos.
- `prototipo-cifrado/`: la herramienta para crear la llave del colegio y las copias por persona (y una demostración). `herramientas/armar-prototipo-cifrado.js`
  la arma como **un solo archivo** que se abre con doble clic.
- Pruebas: `tests/seguridad/prueba-cifrado-sql.js`, `prueba-cifrado-navegador.js`, `prueba-prototipo-cifrado.js`.
