#!/usr/bin/env bash
# Crea un Postgres LOCAL y desechable que imita a Supabase (roles anon/authenticated/service_role y
# los permisos por defecto que Supabase concede sobre el esquema public). No toca ningún servicio real.
#
# Uso:  tests/seguridad/prepara-postgres.sh <carpeta-de-datos> <puerto> [esquema-anterior.sql]
#   Si se entrega un esquema anterior, se instala primero (simula producción) y se cargan datos ficticios.
set -euo pipefail
DIR="$1"; PUERTO="$2"; ANTERIOR="${3:-}"
BIN="$(ls -d /usr/lib/postgresql/*/bin | tail -1)"
AQUI="$(cd "$(dirname "$0")" && pwd)"; RAIZ="$(cd "$AQUI/../.." && pwd)"
id postgres >/dev/null 2>&1 || useradd -m postgres
rm -rf "$DIR"; mkdir -p "$DIR"; chown postgres "$DIR"
p="$DIR"; while [ "$p" != "/" ]; do chmod o+x "$p" 2>/dev/null || true; p="$(dirname "$p")"; done
cat > "$DIR/iniciar.sh" <<EOS
#!/usr/bin/env bash
set -e
$BIN/initdb -D $DIR/data -A trust >/dev/null
$BIN/pg_ctl -D $DIR/data -o "-p $PUERTO -c unix_socket_directories= -c listen_addresses=127.0.0.1" -l $DIR/log start -w >/dev/null
EOS
chmod 755 "$DIR/iniciar.sh"
su postgres -c "$DIR/iniciar.sh"
P="psql -h 127.0.0.1 -p $PUERTO -U postgres -q -v ON_ERROR_STOP=1"
$P <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema if not exists extensions;
-- Permisos por defecto de Supabase: todo lo que se cree en public queda accesible para anon/authenticated
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public, extensions to anon, authenticated, service_role;
SQL
if [ -n "$ANTERIOR" ]; then
  $P -f "$ANTERIOR" 2>&1 | grep -v NOTICE || true
  $P <<'SQL'
-- Datos FICTICIOS que simulan producción: claves antiguas y matrículas con el formato anterior
insert into public.config (id, clave_hash) values (true, extensions.crypt('clave-encargados-ficticia', extensions.gen_salt('bf')))
  on conflict (id) do update set clave_hash = excluded.clave_hash;
update public.config set clave_interna_hash = extensions.crypt('clave-funcionarios-ficticia', extensions.gen_salt('bf')) where id;
select setval('public.folio_2027_seq', 2);
insert into public.matriculas (folio, fecha_registro, tipo, datos, created_at) values
 (1, '20-10-2026, 11:48:05', 'nuevo', '{"folio":"1","fechaRegistro":"20-10-2026, 11:48:05","tipo":"nuevo","estudiante":{"nombre":"Estudiante Ficticio Uno","rut":"11.111.111-1","procedencia":"Colegio Ficticio","foto":"data:image/png;base64,AAAA"},"apoderado":{"nombre":"Apoderado Ficticio Uno","rut":"12.345.678-5"},"suplente":null}', now() - interval '400 days'),
 (2, '21-10-2026, 10:30:00', 'antiguo', '{"folio":"2","fechaRegistro":"21-10-2026, 10:30:00","tipo":"antiguo","estudiante":{"nombre":"Estudiante Ficticio Dos","rut":"22.222.222-2","cursoMatricula":"2° Medio B"},"apoderado":{"nombre":"Apoderado Ficticio Dos","rut":"12.345.678-5","parentesco":"Madre"},"suplente":null}', now() - interval '399 days');
insert into public.prematriculas (codigo, creada, datos, created_at) values
 ('4821', '01-10-2026', '{"tipo":"nuevo","estudiante":{"nombre":"Pre Ficticio Vigente","rut":"11.111.111-1"},"apoderado":{"nombre":"Apo","rut":"12.345.678-5"}}', now() - interval '3 days'),
 ('1234', '01-09-2026', '{"tipo":"nuevo","estudiante":{"nombre":"Pre Ficticio Vencida","rut":"11.111.111-1"},"apoderado":{"nombre":"Apo","rut":"12.345.678-5"}}', now() - interval '45 days');
SQL
fi
echo "Postgres listo en 127.0.0.1:$PUERTO (datos en $DIR)"
