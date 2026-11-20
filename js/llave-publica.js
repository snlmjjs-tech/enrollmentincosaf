/* Llave PÚBLICA del colegio para cifrar las matrículas.
 *
 *   null  → el cifrado está APAGADO: la página funciona como siempre (las matrículas se guardan sin cifrar).
 *   {...} → el cifrado está ENCENDIDO: las matrículas se cifran en el navegador antes de guardarse.
 *
 * La llave pública NO es un secreto: solo sirve para cifrar, nunca para leer. La llave privada (la que lee) nunca está aquí.
 * El valor se obtiene del archivo de llave del colegio (campos «kid» y «publica») y se pega aquí; ver docs/cifrado/publicacion.md.
 * Importante: este archivo se publica con la página; protege la cuenta de GitHub (verificación en dos pasos).
 */
window.LLAVE_PUBLICA_COLEGIO = null;
