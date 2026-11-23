/* Llave PÚBLICA del colegio para cifrar las matrículas.
 *
 *   null  → el cifrado está APAGADO: la página funciona como siempre (las matrículas se guardan sin cifrar).
 *   {...} → el cifrado está ENCENDIDO: las matrículas se cifran en el navegador antes de guardarse.
 *
 * La llave pública NO es un secreto: solo sirve para cifrar, nunca para leer. La llave privada (la que lee) nunca está aquí.
 * El valor se obtiene del archivo de llave del colegio (campos «kid» y «publica») y se pega aquí; ver docs/cifrado/publicacion.md.
 * Importante: este archivo se publica con la página; protege la cuenta de GitHub (verificación en dos pasos).
 */
/* Llave del colegio creada el 2026-11-23 (huella 2e977756b94c6a59). Para APAGAR el cifrado, volver a dejar «null» aquí (ver docs/cifrado/publicacion.md, «Marcha atrás»). */
window.LLAVE_PUBLICA_COLEGIO = {"kid": "2e977756b94c6a59", "publica": "MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAtcA8ZWqDzhwmZ0ieifiQvb29f3eWcIfNwy36nRDVDwMzwE3SdlumE4gDgihB5rrQ1Tb9o7XA9uyE6ona2tPrIqD7lCUU+KtA9+kZEKYHrbWoZyo/3eUsLlz4wY89Fw2RKg5WBn/LTW9KZUVXiJnTWOBlUDrrOFLcvhJuIZWMhYZFeWIMxzmmnzYxCthQY9DbpWdLuyXJzz6/Gv5zto0zbZnLZ2Bp23PAik9ngcd8UtaW1uDMtKWP9joYHZmkslCLiWueZF+CZzrW8e5kTZULc9TsPYSgjWVRowI81H8X/2ElyqYxHwihzCoK2IF701SWWebkaIpoYPcxzxuJrpEQ20ZrKZkZra1KRfXs22cOV30ZSO9lljGMVnRfHmSwOd8Bm68OrrPuEBM2ayIpy1xWiYmxwi1WYAGVugI61u+ZVPMo8TxGj9YKZ5+dR+6D8fX0jzGgfpEMDAdmFeQ+1Uq5/glybbCREIY3zDWhOGJPxNP77JraKdab3BQ9FiD8SGozAgMBAAE="};
