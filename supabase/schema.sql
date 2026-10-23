-- =====================================================================
-- Matrícula INCOSAF 2027 — base de datos en Supabase
--
-- Cómo usarlo:
--   1. Supabase → SQL Editor → New query → pega TODO este archivo → Run.
--   2. Se puede ejecutar más de una vez y sobre una base ya existente sin perder datos.
--   3. Las claves se definen aparte (ver «Claves» más abajo). Este archivo NO contiene ninguna.
--
-- Seguridad (resumen):
--   · Las tablas no son accesibles desde el navegador (RLS activado, sin permisos para anon).
--   · Las claves de funcionarios y de encargados se guardan con hash. Al iniciar sesión se entrega un
--     TOKEN aleatorio y de corta duración; las demás funciones exigen ese token (la clave ya no viaja
--     en cada solicitud ni queda guardada en el navegador).
--   · Intentos fallidos de clave y de códigos de pre-matrícula: bloqueo temporal por dirección de red.
--   · Todo dato recibido se valida en el servidor (tamaño, campos permitidos, RUT, caracteres).
--   · Las acciones administrativas quedan en la tabla `auditoria`.
--
-- MODO DE TRANSICIÓN (solo para actualizar un sitio que ya está en uso):
--   Mientras `config.modo_transicion` sea true, las funciones también aceptan la clave en lugar del
--   token. Así la página antigua sigue funcionando hasta publicar la nueva. Después de publicar la
--   nueva versión, ejecuta supabase/cerrar_transicion.sql.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablas ----------

create sequence if not exists public.folio_2027_seq start 1;

create table if not exists public.matriculas (
  id             uuid primary key default gen_random_uuid(),
  folio          integer not null unique,
  fecha_registro text    not null,
  tipo           text    not null check (tipo in ('nuevo','antiguo')),
  datos          jsonb   not null,
  created_at     timestamptz not null default now()
);

-- Pre-matrículas enviadas por apoderados. Código: 4 dígitos (antiguos) o 6 caracteres (nuevos).
create table if not exists public.prematriculas (
  codigo     text primary key,
  creada     text,
  datos      jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.prematriculas add column if not exists ip text;
alter table public.prematriculas drop constraint if exists prematriculas_codigo_check;
alter table public.prematriculas add constraint prematriculas_codigo_check
  check (codigo ~ '^([0-9]{4}|[A-HJ-NP-Z2-9]{6})$');
create index if not exists prematriculas_created_idx on public.prematriculas (created_at);
create index if not exists prematriculas_ip_idx on public.prematriculas (ip, created_at);

create table if not exists public.config (
  id         boolean primary key default true check (id),
  clave_hash text not null
);
alter table public.config add column if not exists clave_interna_hash text;
alter table public.config add column if not exists modo_transicion boolean not null default true;

-- Sesiones: solo se guarda el hash del token.
create table if not exists public.sesiones (
  id         uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  rol        text not null check (rol in ('interna','admin')),
  creada     timestamptz not null default now(),
  expira     timestamptz not null,
  ip         text
);
create index if not exists sesiones_expira_idx on public.sesiones (expira);

-- Intentos fallidos (claves y códigos) para el límite de intentos.
create table if not exists public.intentos (
  id      bigserial primary key,
  ambito  text not null,
  ip      text not null,
  momento timestamptz not null default now()
);
create index if not exists intentos_idx on public.intentos (ambito, momento);

-- Registro de acciones. No guarda datos personales: solo acción, rol, dirección y referencias.
create table if not exists public.auditoria (
  id      bigserial primary key,
  momento timestamptz not null default now(),
  accion  text not null,
  rol     text,
  ip      text,
  detalle jsonb
);
create index if not exists auditoria_momento_idx on public.auditoria (momento);

alter table public.matriculas    enable row level security;
alter table public.prematriculas enable row level security;
alter table public.config        enable row level security;
alter table public.sesiones      enable row level security;
alter table public.intentos      enable row level security;
alter table public.auditoria     enable row level security;

-- Sin políticas y sin permisos: el navegador no puede tocar las tablas directamente.
revoke all on public.matriculas, public.prematriculas, public.config,
              public.sesiones, public.intentos, public.auditoria from anon, authenticated;
revoke all on sequence public.folio_2027_seq, public.intentos_id_seq, public.auditoria_id_seq
              from anon, authenticated;

-- ---------- Claves ----------
-- Esta sección NO define ninguna clave (así nunca queda una de ejemplo activa).
-- Para definir o cambiar las claves, ejecuta por separado (con tus claves reales, largas y distintas):
--
--   insert into public.config (id, clave_hash)
--   values (true, extensions.crypt('CLAVE_DE_ENCARGADOS', extensions.gen_salt('bf')))
--   on conflict (id) do update set clave_hash = excluded.clave_hash;
--
--   update public.config
--      set clave_interna_hash = extensions.crypt('CLAVE_DE_FUNCIONARIOS', extensions.gen_salt('bf'))
--    where id;

-- ---------- Utilidades internas (no accesibles desde el navegador) ----------

-- Dirección de red del cliente. Se usa cf-connecting-ip (la fija Cloudflare, que protege la API de
-- Supabase) y, si no existe, el último valor de x-forwarded-for.
create or replace function public._ip()
returns text
language plpgsql stable
set search_path = public
as $$
declare h json;
begin
  begin
    h := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  exception when others then
    h := '{}'::json;
  end;
  return left(coalesce(
    nullif(trim(h->>'cf-connecting-ip'), ''),
    nullif(trim(regexp_replace(coalesce(h->>'x-forwarded-for',''), '^.*,', '')), ''),
    'sin-ip'), 64);
end;
$$;

create or replace function public._hash_token(p text)
returns text
language sql immutable
set search_path = public, extensions
as $$ select encode(extensions.digest(coalesce(p, ''), 'sha256'), 'hex'); $$;

create or replace function public._transicion()
returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce((select modo_transicion from public.config where id), false); $$;

create or replace function public._clave_ok(p_clave text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select clave_hash = extensions.crypt(coalesce(p_clave, ''), clave_hash) from public.config where id),
    false);
$$;

create or replace function public._clave_interna_ok(p_clave text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select (clave_interna_hash is not null and clave_interna_hash = extensions.crypt(coalesce(p_clave, ''), clave_interna_hash))
         or clave_hash = extensions.crypt(coalesce(p_clave, ''), clave_hash)
       from public.config where id),
    false);
$$;

-- ¿El token (o, en modo de transición, la clave) da acceso al nivel pedido?
create or replace function public._acceso(p text, p_nivel text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
           select 1 from public.sesiones s
            where s.token_hash = public._hash_token(p)
              and s.expira > now()
              and (s.rol = 'admin' or (p_nivel = 'interna' and s.rol = 'interna')))
         or (public._transicion()
             and ((p_nivel = 'admin' and public._clave_ok(p))
               or (p_nivel = 'interna' and public._clave_interna_ok(p))));
$$;

create or replace function public._exigir_clave(p_clave text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._acceso(p_clave, 'admin') then
    raise exception 'clave_incorrecta' using errcode = '28000';
  end if;
end;
$$;

create or replace function public._exigir_clave_interna(p_clave text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._acceso(p_clave, 'interna') then
    raise exception 'clave_incorrecta' using errcode = '28000';
  end if;
end;
$$;

create or replace function public._rol(p text)
returns text
language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select s.rol from public.sesiones s where s.token_hash = public._hash_token(p) and s.expira > now()),
    case when public._transicion() and public._clave_ok(p) then 'admin'
         when public._transicion() and public._clave_interna_ok(p) then 'interna' end);
$$;

create or replace function public._auditar(p_token text, p_accion text, p_detalle jsonb default null)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  insert into public.auditoria (accion, rol, ip, detalle)
  values (p_accion, public._rol(p_token), public._ip(), p_detalle);
end;
$$;

-- ¿Se superó el límite de intentos fallidos? (por dirección, y un tope general de respaldo)
create or replace function public._bloqueado(p_ambito text, p_max_ip integer, p_ventana interval, p_max_total integer)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select count(*) filter (where ip = public._ip()) >= p_max_ip or count(*) >= p_max_total
       from public.intentos
      where ambito = p_ambito and momento > now() - p_ventana),
    false);
$$;

create or replace function public._registrar_fallo(p_ambito text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.intentos (ambito, ip) values (p_ambito, public._ip());
end;
$$;

-- RUT chileno: dígito verificador (misma regla que la página)
create or replace function public._rut_valido(p text)
returns boolean
language plpgsql immutable
as $$
declare
  r text := upper(regexp_replace(coalesce(p, ''), '[^0-9kK]', '', 'g'));
  cuerpo text; dv text; suma integer := 0; mult integer := 2; i integer; res integer; calc text;
begin
  if length(r) < 7 or length(r) > 9 then return false; end if;
  cuerpo := left(r, length(r) - 1);
  dv := right(r, 1);
  if cuerpo !~ '^[0-9]+$' then return false; end if;
  for i in reverse length(cuerpo)..1 loop
    suma := suma + substr(cuerpo, i, 1)::integer * mult;
    mult := case when mult = 7 then 2 else mult + 1 end;
  end loop;
  res := 11 - (suma % 11);
  calc := case res when 11 then '0' when 10 then 'K' else res::text end;
  return dv = calc;
end;
$$;

-- Valida una sección de la ficha: solo campos permitidos, solo texto, largo máximo y sin caracteres peligrosos.
create or replace function public._validar_seccion(p_seccion text, p jsonb, p_permitidas text[])
returns void
language plpgsql immutable
as $$
declare k text; v jsonb; texto text; largo integer;
begin
  if jsonb_typeof(p) <> 'object' then
    raise exception 'dato_invalido: la sección % no tiene el formato correcto', p_seccion;
  end if;
  for k, v in select * from jsonb_each(p) loop
    if not (k = any (p_permitidas)) then
      raise exception 'dato_invalido: campo no permitido en %: %', p_seccion, left(k, 40);
    end if;
    if jsonb_typeof(v) = 'null' then continue; end if;
    if jsonb_typeof(v) <> 'string' then
      raise exception 'dato_invalido: el campo % de % debe ser texto', left(k, 40), p_seccion;
    end if;
    texto := v #>> '{}';
    largo := case when k in ('observaciones', 'saludDetalle', 'pieDiagnostico') then 1000
                  when k in ('direccion', 'nivelEducacional', 'situacionLaboral') then 300
                  else 200 end;
    if length(texto) > largo then
      raise exception 'dato_invalido: el campo % es demasiado largo', left(k, 40);
    end if;
    -- sin < ni > ni caracteres de control (se permiten saltos de línea y tabulaciones)
    if texto ~ E'[<>\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]' then
      raise exception 'dato_invalido: el campo % contiene caracteres no permitidos (< > o de control)', left(k, 40);
    end if;
  end loop;
end;
$$;

-- Valida una ficha completa (la usan la pre-matrícula pública y el registro del personal).
create or replace function public._validar_ficha(p jsonb, p_con_folio boolean)
returns void
language plpgsql immutable
as $$
declare k text; e jsonb; a jsonb; s jsonb; f text;
begin
  if jsonb_typeof(p) <> 'object' then
    raise exception 'dato_invalido: la solicitud no tiene el formato correcto';
  end if;
  if octet_length(p::text) > 30000 then
    raise exception 'dato_invalido: la solicitud es demasiado grande';
  end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('tipo', 'estudiante', 'apoderado', 'suplente')
       and not (p_con_folio and k in ('folio', 'fechaRegistro')) then
      raise exception 'dato_invalido: campo no permitido: %', left(k, 40);
    end if;
  end loop;
  if (p->>'tipo') is distinct from 'nuevo' and (p->>'tipo') is distinct from 'antiguo' then
    raise exception 'dato_invalido: el tipo de estudiante no es válido';
  end if;
  if p_con_folio then
    if coalesce(p->>'folio', '') !~ '^[0-9]{1,9}$' then
      raise exception 'folio_invalido: el número de ficha no es válido';
    end if;
    if jsonb_typeof(p->'fechaRegistro') is distinct from 'string' or length(p->>'fechaRegistro') > 60 then
      raise exception 'dato_invalido: la fecha de registro no es válida';
    end if;
  end if;

  e := p->'estudiante'; a := p->'apoderado'; s := p->'suplente';
  perform public._validar_seccion('estudiante', e, array[
    'nombre','rut','fnac','direccion','comuna','nacionalidad','celular','correo','procedencia',
    'cursoMatricula','repitencia','repCurso','repAnio','pie','pieDiagnostico','pieDocumentacion',
    'salud','saludDetalle','observaciones']);
  perform public._validar_seccion('apoderado', a, array[
    'nombre','rut','edad','direccion','comuna','nacionalidad','celular','correo','parentesco',
    'viveConEstudiante','nivelEducacional','situacionLaboral','lugarTrabajo']);
  if s is not null and jsonb_typeof(s) <> 'null' then
    perform public._validar_seccion('suplente', s, array[
      'nombre','rut','edad','direccion','comuna','nacionalidad','celular','correo','parentesco','viveConEstudiante']);
  else
    s := null;
  end if;

  if length(btrim(coalesce(e->>'nombre', ''))) = 0 then raise exception 'dato_invalido: falta el nombre del estudiante'; end if;
  if not public._rut_valido(e->>'rut') then raise exception 'dato_invalido: el RUT del estudiante no es válido'; end if;
  if length(btrim(coalesce(a->>'nombre', ''))) = 0 then raise exception 'dato_invalido: falta el nombre del apoderado'; end if;
  if not public._rut_valido(a->>'rut') then raise exception 'dato_invalido: el RUT del apoderado no es válido'; end if;
  if s is not null then
    if length(btrim(coalesce(s->>'nombre', ''))) = 0 then raise exception 'dato_invalido: falta el nombre del suplente'; end if;
    if not public._rut_valido(s->>'rut') then raise exception 'dato_invalido: el RUT del suplente no es válido'; end if;
  end if;

  if coalesce(e->>'fnac', '') <> '' and (e->>'fnac') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'dato_invalido: la fecha de nacimiento no es válida';
  end if;
  foreach f in array array[e->>'correo', a->>'correo', s->>'correo'] loop
    if coalesce(f, '') <> '' and f !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'dato_invalido: un correo electrónico no es válido';
    end if;
  end loop;
  foreach f in array array[a->>'edad', s->>'edad'] loop
    if coalesce(f, '') <> '' and (f !~ '^[0-9]{1,3}$' or f::integer < 18 or f::integer > 120) then
      raise exception 'dato_invalido: la edad del apoderado no es válida';
    end if;
  end loop;
  foreach f in array array[e->>'repitencia', e->>'pie', e->>'pieDocumentacion', e->>'salud', a->>'viveConEstudiante', s->>'viveConEstudiante'] loop
    if coalesce(f, '') not in ('', 'si', 'no') then
      raise exception 'dato_invalido: una opción de sí/no no es válida';
    end if;
  end loop;
  foreach f in array array[a->>'parentesco', s->>'parentesco'] loop
    if coalesce(f, '') not in ('', 'Madre', 'Padre', 'Abuelo(a)', 'Hermano(a)', 'Tío(a)', 'Tutor(a) legal', 'Otro') then
      raise exception 'dato_invalido: el parentesco no es válido';
    end if;
  end loop;
  if coalesce(a->>'lugarTrabajo', '') not in ('', 'En el hogar', 'Fuera del hogar') then
    raise exception 'dato_invalido: el lugar de trabajo no es válido';
  end if;
end;
$$;

-- Versiones anteriores de estas funciones (sin token ni validación): se eliminan para que no se usen.
drop function if exists public.obtener_folio();
drop function if exists public.guardar_matricula(jsonb);
drop function if exists public.cargar_prematricula(text);
drop function if exists public.eliminar_prematricula(text);
drop function if exists public.obtener_matricula(text, uuid);

-- ---------- Sesión ----------

-- Cambia una clave por un token de sesión. Falla sin revelar si el rol existe. Límite de intentos.
-- p_rol: 'interna' (funcionarios; también acepta la clave de encargados) o 'admin' (panel).
create or replace function public.iniciar_sesion(p_clave text, p_rol text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_ok boolean; v_token text; v_expira timestamptz;
begin
  if p_rol not in ('interna', 'admin') then
    return jsonb_build_object('ok', false, 'motivo', 'rol');
  end if;
  if public._bloqueado('login', 10, interval '15 minutes', 300) then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado', 'espera_minutos', 15);
  end if;
  v_ok := case p_rol when 'admin' then public._clave_ok(p_clave) else public._clave_interna_ok(p_clave) end;
  if not v_ok then
    perform public._registrar_fallo('login');
    return jsonb_build_object('ok', false, 'motivo', 'clave');
  end if;
  v_expira := now() + case p_rol when 'admin' then interval '3 hours' else interval '12 hours' end;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.sesiones (token_hash, rol, expira, ip)
  values (public._hash_token(v_token), p_rol, v_expira, public._ip());
  insert into public.auditoria (accion, rol, ip) values ('inicio_sesion', p_rol, public._ip());
  return jsonb_build_object('ok', true, 'token', v_token, 'rol', p_rol, 'expira', v_expira);
end;
$$;

create or replace function public.cerrar_sesion(p_token text)
returns void
language sql security definer
set search_path = public, extensions
as $$ delete from public.sesiones where token_hash = public._hash_token(p_token); $$;

-- ¿Qué rol tiene este token? (null si no es válido o venció). Lo usa la página al recargar y el correo.
create or replace function public.validar_token(p_token text)
returns text
language sql stable security definer
set search_path = public, extensions
as $$
  select s.rol from public.sesiones s where s.token_hash = public._hash_token(p_token) and s.expira > now();
$$;

-- Funciones de la versión anterior (clave directa). Se mantienen solo durante la transición,
-- con límite de intentos. cerrar_transicion.sql las elimina.
create or replace function public.verificar_clave(p_clave text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if public._bloqueado('login', 10, interval '15 minutes', 300) then
    raise exception 'demasiados_intentos: Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.';
  end if;
  if public._clave_ok(p_clave) then return true; end if;
  perform public._registrar_fallo('login');
  return false;
end;
$$;

create or replace function public.verificar_clave_interna(p_clave text)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if public._bloqueado('login', 10, interval '15 minutes', 300) then
    raise exception 'demasiados_intentos: Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.';
  end if;
  if public._clave_interna_ok(p_clave) then return true; end if;
  perform public._registrar_fallo('login');
  return false;
end;
$$;

-- ---------- Matrículas (personal) ----------

create or replace function public.obtener_folio(p_clave text)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._exigir_clave_interna(p_clave);
  return nextval('public.folio_2027_seq')::integer;
end;
$$;

-- Guarda la matrícula al finalizar. El folio debe ser uno ya entregado por obtener_folio().
create or replace function public.guardar_matricula(p_clave text, p_ficha jsonb)
returns uuid
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_folio integer; v_id uuid;
begin
  perform public._exigir_clave_interna(p_clave);
  perform public._validar_ficha(p_ficha, true);
  v_folio := (p_ficha->>'folio')::integer;
  if v_folio < 1 or v_folio > (select last_value from public.folio_2027_seq) then
    raise exception 'folio_invalido: el número de ficha no es válido';
  end if;
  insert into public.matriculas (folio, fecha_registro, tipo, datos)
  values (v_folio, coalesce(p_ficha->>'fechaRegistro', ''), p_ficha->>'tipo', p_ficha)
  returning id into v_id;
  perform public._auditar(p_clave, 'guardar_matricula', jsonb_build_object('folio', v_folio, 'id', v_id));
  return v_id;
end;
$$;

-- Panel: lista todas las matrículas (cada fila trae _key = id)
create or replace function public.listar_matriculas(p_clave text)
returns setof jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._exigir_clave(p_clave);
  perform public._auditar(p_clave, 'listar_matriculas');
  return query
    select m.datos || jsonb_build_object('_key', m.id)
    from public.matriculas m
    order by m.folio;
end;
$$;

create or replace function public.actualizar_matricula(p_clave text, p_id uuid, p_ficha jsonb)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._exigir_clave(p_clave);
  perform public._validar_ficha(p_ficha, true);
  update public.matriculas
     set datos = p_ficha,
         tipo = coalesce(p_ficha->>'tipo', tipo),
         fecha_registro = coalesce(p_ficha->>'fechaRegistro', fecha_registro)
   where id = p_id;
  if not found then raise exception 'matricula_no_encontrada'; end if;
  perform public._auditar(p_clave, 'actualizar_matricula', jsonb_build_object('id', p_id));
end;
$$;

create or replace function public.eliminar_matricula(p_clave text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_folio integer;
begin
  perform public._exigir_clave(p_clave);
  delete from public.matriculas where id = p_id returning folio into v_folio;
  perform public._auditar(p_clave, 'eliminar_matricula', jsonb_build_object('id', p_id, 'folio', v_folio));
end;
$$;

-- Panel: ¿cuál será el próximo N° de ficha?
create or replace function public.ver_siguiente_folio(p_clave text)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_last bigint; v_called boolean;
begin
  perform public._exigir_clave(p_clave);
  select last_value, is_called into v_last, v_called from public.folio_2027_seq;
  return (case when v_called then v_last + 1 else v_last end)::integer;
end;
$$;

create or replace function public.establecer_siguiente_folio(p_clave text, p_valor integer)
returns integer
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_min integer;
begin
  perform public._exigir_clave(p_clave);
  select coalesce(max(folio), 0) + 1 into v_min from public.matriculas;
  if p_valor is null or p_valor < 1 then
    raise exception 'folio_invalido: el número debe ser 1 o mayor';
  end if;
  if p_valor < v_min then
    raise exception 'folio_en_uso: ya existen fichas hasta el N° %, el mínimo permitido es %', v_min - 1, v_min;
  end if;
  perform setval('public.folio_2027_seq', p_valor, false);
  perform public._auditar(p_clave, 'establecer_siguiente_folio', jsonb_build_object('valor', p_valor));
  return p_valor;
end;
$$;

create or replace function public.cambiar_folio_matricula(p_clave text, p_id uuid, p_folio integer)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._exigir_clave(p_clave);
  if p_folio is null or p_folio < 1 then
    raise exception 'folio_invalido: el número debe ser 1 o mayor';
  end if;
  if exists (select 1 from public.matriculas where folio = p_folio and id <> p_id) then
    raise exception 'folio_duplicado: el N° % ya lo tiene otra ficha', p_folio;
  end if;
  update public.matriculas
     set folio = p_folio,
         datos = jsonb_set(datos, '{folio}', to_jsonb(p_folio::text))
   where id = p_id;
  if not found then raise exception 'matricula_no_encontrada'; end if;
  perform public._auditar(p_clave, 'cambiar_folio_matricula', jsonb_build_object('id', p_id, 'folio', p_folio));
end;
$$;

-- Panel: últimas acciones registradas
create or replace function public.listar_auditoria(p_clave text, p_limite integer default 200)
returns setof jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._exigir_clave(p_clave);
  return query
    select to_jsonb(a) from (
      select momento, accion, rol, ip, detalle from public.auditoria
       order by id desc limit least(greatest(coalesce(p_limite, 200), 1), 1000)) a;
end;
$$;

-- ---------- Pre-matrículas ----------

-- Apoderado (QR, sin clave): valida, limita la frecuencia y devuelve el código.
-- Códigos nuevos: 6 caracteres (sin 0, 1, I ni O). Los de 4 dígitos ya emitidos siguen valiendo, y se
-- siguen emitiendo de 4 dígitos mientras dure el modo de transición.
create or replace function public.crear_prematricula(p_datos jsonb)
returns text
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_ip text := public._ip();
  v_codigo text; v_intentos integer := 0; v_i integer;
  v_alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
begin
  if jsonb_typeof(p_datos) <> 'object' then
    raise exception 'dato_invalido: la solicitud no tiene el formato correcto';
  end if;
  -- campo trampa para robots: una persona no lo ve ni lo llena
  if coalesce(p_datos->>'_hp', '') <> '' then
    raise exception 'solicitud_invalida: no se pudo procesar la solicitud';
  end if;
  p_datos := p_datos - '_hp';

  -- limpieza de vencidas como respaldo (la tarea diaria es el mecanismo principal)
  delete from public.prematriculas where created_at < now() - interval '30 days';

  if (select count(*) from public.prematriculas where ip = v_ip and created_at > now() - interval '1 hour') >= 8 then
    raise exception 'demasiadas_solicitudes: Se enviaron demasiadas pre-matrículas desde esta conexión. Espera una hora o acércate al mesón de matrícula.';
  end if;
  if (select count(*) from public.prematriculas where created_at > now() - interval '1 hour') >= 400 then
    raise exception 'demasiadas_solicitudes: El sistema está recibiendo muchas solicitudes. Inténtalo de nuevo en unos minutos.';
  end if;
  if (select count(*) from public.prematriculas) >= 5000 then
    raise exception 'demasiadas_solicitudes: No se pueden recibir más pre-matrículas por ahora. Acércate al mesón de matrícula.';
  end if;

  perform public._validar_ficha(p_datos, false);

  loop
    if public._transicion() then
      -- Durante la transición la página antigua solo sabe leer códigos de 4 dígitos
      v_bytes := extensions.gen_random_bytes(2);
      v_codigo := lpad((((get_byte(v_bytes, 0) * 256 + get_byte(v_bytes, 1)) % 9000) + 1000)::text, 4, '0');
    else
      v_bytes := extensions.gen_random_bytes(6);
      v_codigo := '';
      for v_i in 0..5 loop
        v_codigo := v_codigo || substr(v_alfabeto, (get_byte(v_bytes, v_i) % 32) + 1, 1);
      end loop;
    end if;
    begin
      insert into public.prematriculas (codigo, creada, datos, ip)
      values (v_codigo,
              to_char(now() at time zone 'America/Santiago', 'DD-MM-YYYY, HH24:MI:SS'),
              p_datos, v_ip);
      return v_codigo;
    exception when unique_violation then
      v_intentos := v_intentos + 1;
      if v_intentos >= 20 then raise exception 'sin_codigos_disponibles'; end if;
    end;
  end loop;
end;
$$;

-- Personal: carga una pre-matrícula por su código (devuelve null si no existe).
-- Los códigos que no existen se cuentan: demasiados seguidos bloquean las consultas un rato.
create or replace function public.cargar_prematricula(p_clave text, p_codigo text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[^0-9A-Za-z]', '', 'g')); v_datos jsonb;
begin
  perform public._exigir_clave_interna(p_clave);
  if public._bloqueado('codigo', 15, interval '10 minutes', 200) then
    raise exception 'demasiados_intentos: Se consultaron demasiados códigos que no existen. Espera 10 minutos e inténtalo de nuevo.';
  end if;
  select datos into v_datos from public.prematriculas where codigo = v_codigo;
  if v_datos is null then
    perform public._registrar_fallo('codigo');
    return null;
  end if;
  perform public._auditar(p_clave, 'cargar_prematricula', jsonb_build_object('codigo', v_codigo));
  return v_datos;
end;
$$;

create or replace function public.eliminar_prematricula(p_clave text, p_codigo text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._exigir_clave_interna(p_clave);
  delete from public.prematriculas where codigo = upper(regexp_replace(coalesce(p_codigo, ''), '[^0-9A-Za-z]', '', 'g'));
end;
$$;

-- ---------- Limpieza automática ----------
-- Borra SOLO: pre-matrículas pendientes vencidas, sesiones vencidas e intentos fallidos antiguos.
-- No toca `matriculas` (matrículas definitivas), `config` ni `auditoria`.
-- No es accesible desde el navegador: la ejecuta la tarea programada (supabase/programar_limpieza.sql).
create or replace function public.limpiar_vencidos(p_dias_prematricula integer default 30)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_pre integer; v_ses integer; v_int integer;
begin
  if p_dias_prematricula is null or p_dias_prematricula < 7 then
    raise exception 'El período de conservación no puede ser menor a 7 días';
  end if;
  delete from public.prematriculas where created_at < now() - make_interval(days => p_dias_prematricula);
  get diagnostics v_pre = row_count;
  delete from public.sesiones where expira < now();
  get diagnostics v_ses = row_count;
  delete from public.intentos where momento < now() - interval '2 days';
  get diagnostics v_int = row_count;
  insert into public.auditoria (accion, rol, detalle)
  values ('limpieza_automatica', 'sistema',
          jsonb_build_object('prematriculas_borradas', v_pre, 'sesiones_borradas', v_ses, 'intentos_borrados', v_int,
                             'dias_conservacion', p_dias_prematricula));
  return jsonb_build_object('prematriculas', v_pre, 'sesiones', v_ses, 'intentos', v_int);
end;
$$;

-- ---------- Permisos ----------
-- Por defecto Supabase da permiso de ejecución a anon sobre las funciones nuevas: aquí se quita todo
-- a las funciones internas y se concede explícitamente solo lo que usa la página.
revoke all on function
  public._ip(), public._hash_token(text), public._transicion(), public._clave_ok(text),
  public._clave_interna_ok(text), public._acceso(text, text), public._exigir_clave(text),
  public._exigir_clave_interna(text), public._rol(text), public._auditar(text, text, jsonb),
  public._bloqueado(text, integer, interval, integer), public._registrar_fallo(text),
  public._rut_valido(text), public._validar_seccion(text, jsonb, text[]), public._validar_ficha(jsonb, boolean),
  public.limpiar_vencidos(integer)
from public, anon, authenticated;

grant execute on function
  public.iniciar_sesion(text, text),
  public.cerrar_sesion(text),
  public.validar_token(text),
  public.verificar_clave(text),
  public.verificar_clave_interna(text),
  public.obtener_folio(text),
  public.guardar_matricula(text, jsonb),
  public.listar_matriculas(text),
  public.actualizar_matricula(text, uuid, jsonb),
  public.eliminar_matricula(text, uuid),
  public.ver_siguiente_folio(text),
  public.establecer_siguiente_folio(text, integer),
  public.cambiar_folio_matricula(text, uuid, integer),
  public.listar_auditoria(text, integer),
  public.crear_prematricula(jsonb),
  public.cargar_prematricula(text, text),
  public.eliminar_prematricula(text, text)
to anon, authenticated;

-- ---------- Si vienes de Firebase y ya tenías fichas numeradas ----------
-- Para que el siguiente folio continúe después del último usado (ej. 120):
--   select setval('public.folio_2027_seq', 120);
