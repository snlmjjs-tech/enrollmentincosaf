# Minificación del JavaScript: evaluación

**Conclusión: es posible y opcional; no mejora la seguridad. No se activó.**

| | Legible | Minificado (esbuild) |
|---|---|---|
| `js/app.js` | 58,7 KB | 45,0 KB (−23 %) |
| Comprimido (gzip, lo que viaja por la red) | 17,1 KB | 13,4 KB |

- Probé el `app.js` minificado con las **66 comprobaciones** del navegador (formulario, documentos, PDF, Excel, QR, panel, impresión, inyección de código): **todas pasan**.
- Ahorra ~4 KB por visita. Es irrelevante frente a las librerías (`vendor/` pesa 1,6 MB).
- **No es una medida de seguridad.** Cualquiera puede volver a formatear el código con una herramienta gratuita. La seguridad de esta plataforma no depende de que el código sea difícil de leer: no hay ningún secreto en él (ver `credenciales.md`).
- Costo: hay que mantener dos archivos (fuente y minificado) y acordarse de regenerar el segundo en cada cambio; GitHub Pages no compila por sí solo, así que el archivo minificado tendría que subirse al repositorio.

Si más adelante se quiere usar:
```bash
npx esbuild js/app.js --minify --target=es2019 --outfile=js/app.min.js
```
y cambiar en `index.html` la línea `js/app.js` por `js/app.min.js`. Conserva siempre `js/app.js` como fuente legible y repite las pruebas
(`APP_JS=js/app.min.js node tests/seguridad/prueba-navegador.js`).
