# Librerías de terceros (alojadas en el propio sitio)

Se sirven desde el mismo dominio en vez de un CDN. Así:
- un CDN comprometido no puede inyectar código en la página,
- la política de seguridad de contenido (CSP) solo permite scripts propios,
- las versiones no cambian sin un cambio visible en el repositorio.

| Archivo | Paquete | Versión | Uso |
|---|---|---|---|
| `supabase-js-2.118.0.min.js` | `@supabase/supabase-js` | 2.118.0 | Conexión con Supabase |
| `jspdf-4.2.1.umd.min.js` | `jspdf` | 4.2.1 | Certificado de matrícula en PDF |
| `xlsx-0.18.5.full.min.js` | `xlsx` (SheetJS) | 0.18.5 | Exportación a Excel |
| `qrcode-1.0.0.js` | `qrcodejs` | 1.0.0 | Código QR para apoderados |

`SHA256SUMS` contiene la suma de verificación de cada archivo: `sha256sum -c SHA256SUMS`.
Las licencias están en `licencias/`.

## Sobre XLSX 0.18.5

Esta versión tiene dos fallos conocidos (CVE-2023-30533 y CVE-2024-22363) que se activan **al leer**
archivos de terceros. La página solo **crea** archivos Excel y nunca abre archivos externos, así que no
quedan expuestos. Aun así conviene actualizarla: la versión corregida (0.20.x) solo se distribuye desde
`https://cdn.sheetjs.com/`. Para actualizar: descargar `xlsx.full.min.js` de ahí, reemplazar este archivo,
actualizar el nombre en `index.html` y regenerar `SHA256SUMS`.

## Cómo actualizar otra librería

1. Descargar el paquete (`npm pack <paquete>@<versión>`) y copiar su archivo de `dist/` aquí.
2. Cambiar el nombre en `index.html` y regenerar `SHA256SUMS`.
3. Probar: formulario, panel, Excel, PDF, QR e impresión.
