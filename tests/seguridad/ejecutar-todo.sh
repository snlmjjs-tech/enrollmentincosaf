#!/usr/bin/env bash
# Ejecuta TODAS las pruebas automáticas, una tras otra, y muestra un resumen. Usa solo bases locales y servicios simulados.
# No necesita ninguna clave ni conexión a Supabase/Google. Tarda unos 10-15 minutos.
#
# Requisitos: Node.js 18+, PostgreSQL (psql, initdb, pg_ctl), Chromium de Playwright, y los paquetes npm «pg», «playwright» y «xlsx»
#             (NODE_PATH debe encontrarlos). Opcional: poppler-utils (pdftotext…) para revisar el contenido de los PDF.
# Uso:  tests/seguridad/ejecutar-todo.sh <carpeta-de-trabajo> [esquema-de-produccion-anterior.sql]
#   <carpeta-de-trabajo>: carpeta vacía y desechable donde se crean las bases locales (por ejemplo /tmp/incosaf-pruebas)
#   El esquema anterior (opcional) simula la base de producción actual para probar la actualización sobre datos existentes.
#   Variables opcionales: PAGINA_ACTUAL y LIBS_ANTIGUAS (copia de `main` y sus librerías) para las comparaciones con la página publicada hoy.
set -uo pipefail
TRABAJO="${1:?indica una carpeta de trabajo desechable}"; ANTERIOR="${2:-}"
AQUI="$(cd "$(dirname "$0")" && pwd)"; RAIZ="$(cd "$AQUI/../.." && pwd)"
mkdir -p "$TRABAJO"; RESUMEN="$TRABAJO/resumen.txt"; : > "$RESUMEN"
export PGPORT=5499
detener() { for pid in $(pgrep -u postgres 2>/dev/null); do kill -9 "$pid" 2>/dev/null; done; sleep 1; }
base() { detener; "$AQUI/prepara-postgres.sh" "$TRABAJO/pg" "$1" ${2:+"$2"} >/dev/null 2>&1; }
correr() {   # correr <nombre> <comando…>
  local nombre="$1"; shift
  echo "▶ $nombre"; "$@" > "$TRABAJO/$nombre.txt" 2>&1; local est=$?
  local res; res="$(grep -E "^Resultado" "$TRABAJO/$nombre.txt" | tail -1)"
  printf '%-34s %s  (código %s)\n' "$nombre" "${res:-sin resultado}" "$est" | tee -a "$RESUMEN"
  grep -E "✘" "$TRABAJO/$nombre.txt" | head -5
}
cd "$RAIZ"
base 5499 "$ANTERIOR";  correr prueba-sql              node tests/seguridad/prueba-sql.js
base 5499 "$ANTERIOR";  correr prueba-multiple-sql     node tests/seguridad/prueba-multiple-sql.js
base 5499 "$ANTERIOR";  correr prueba-codegs           node tests/seguridad/prueba-codegs.js
base 5499 "$ANTERIOR";  correr prueba-navegador        node tests/seguridad/prueba-navegador.js
base 5499 "$ANTERIOR";  correr prueba-funcional        node tests/seguridad/prueba-funcional.js
base 5499 "$ANTERIOR";  correr prueba-multiple-navegador node tests/seguridad/prueba-multiple-navegador.js
if [ -n "${PAGINA_ACTUAL:-}" ] && [ -n "${LIBS_ANTIGUAS:-}" ]; then
  base 5499 "$ANTERIOR"; correr prueba-pagina-actual   node tests/seguridad/prueba-pagina-actual.js
else echo "prueba-pagina-actual               OMITIDA (define PAGINA_ACTUAL y LIBS_ANTIGUAS)" | tee -a "$RESUMEN"; fi
export PGPORT=5498; base 5498 "";  correr prueba-entorno-prueba node tests/seguridad/prueba-entorno-prueba.js
detener
correr prueba-pdf                  node tests/seguridad/prueba-pdf.js
correr prueba-generador            node tests/seguridad/prueba-generador.js
correr prueba-proteccion-produccion node tests/seguridad/prueba-proteccion-produccion.js
echo; echo "=== RESUMEN (también en $RESUMEN) ==="; cat "$RESUMEN"
! grep -qE "[1-9][0-9]* (fallidas|pruebas fallidas)|[1-9][0-9]* fallidas" "$RESUMEN"
