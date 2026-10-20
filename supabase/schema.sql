-- =====================================================================
-- Matrícula INCOSAF 2027 — base de datos en Supabase
--
-- Cómo usarlo:
--   1. Supabase → SQL Editor → New query → pega TODO este archivo.
--   2. Cambia 'CAMBIA_ESTA_CLAVE' (más abajo) por la clave del panel de encargados.
--   3. Run. Se puede ejecutar más de una vez sin romper nada.
--
-- Seguridad: las tablas NO son accesibles directamente desde el navegador
-- (RLS activado y sin permisos para anon). Todo pasa por las funciones de
-- abajo, y las que leen/editan/borran matrículas exigen la clave de encargados,
-- que se valida aquí en el servidor (guardada como hash, no en el código web).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablas ----------

-- Folio (N° de ficha) secuencial: 1, 2, 3…
create sequence if not exists public.folio_2027_seq start 1;

create table if not exists public.matriculas (
  id             uuid primary key default gen_random_uuid(),
  folio          integer not null unique,
  fecha_registro text    not null,
  tipo           text    not null check (tipo in ('nuevo','antiguo')),
  datos          jsonb   not null,           -- ficha completa (estudiante, apoderado, suplente)
  created_at     timestamptz not null default now()
);

-- Pre-matrículas que envían los apoderados por QR; se identifican con un código de 4 dígitos
create table if not exists public.prematriculas (
  codigo     text primary key check (codigo ~ '^[0-9]{4}$'),
  creada     text,
  datos      jsonb not null,
  created_at timestamptz not null default now()
);

-- Clave del panel de encargados (una sola fila, guardada con hash)
create table if not exists public.config (
  id         boolean primary key default true check (id),
  clave_hash text not null
);

alter table public.matriculas    enable row level security;
alter table public.prematriculas enable row level security;
alter table public.config        enable row level security;

-- Sin políticas + sin permisos: el navegador no puede tocar las tablas directamente.
revoke all on public.matriculas, public.prematriculas, public.config from anon, authenticated;
revoke all on sequence public.folio_2027_seq from anon, authenticated;

-- ---------- Clave de encargados ----------
-- ⚠️ Cambia el texto entre comillas por tu clave. Para cambiarla después, vuelve a ejecutar solo este bloque.
insert into public.config (id, clave_hash)
values (true, extensions.crypt('CAMBIA_ESTA_CLAVE', extensions.gen_salt('bf')))
on conflict (id) do nothing;
-- (si ya existía y quieres cambiarla:)
-- update public.config set clave_hash = extensions.crypt('NUEVA_CLAVE', extensions.gen_salt('bf')) where id;

-- ---------- Funciones internas ----------

create or replace function public._clave_ok(p_clave text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select clave_hash = extensions.crypt(coalesce(p_clave, ''), clave_hash) from public.config where id),
    false);
$$;
revoke all on function public._clave_ok(text) from public, anon, authenticated;

create or replace function public._exigir_clave(p_clave text)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not public._clave_ok(p_clave) then
    raise exception 'clave_incorrecta' using errcode = '28000';
  end if;
end;
$$;
revoke all on function public._exigir_clave(text) from public, anon, authenticated;

-- ---------- Funciones que usa la app ----------

-- ¿La clave de encargados es correcta?
create or replace function public.verificar_clave(p_clave text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$ select public._clave_ok(p_clave); $$;

-- Siguiente N° de ficha (se pide al generar los documentos)
create or replace function public.obtener_folio()
returns integer
language sql security definer
set search_path = public
as $$ select nextval('public.folio_2027_seq')::integer; $$;

-- Guarda la matrícula al finalizar. El folio debe ser uno ya entregado por obtener_folio().
create or replace function public.guardar_matricula(p_ficha jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_folio integer := (p_ficha->>'folio')::integer;
  v_id    uuid;
begin
  if v_folio is null or v_folio < 1 or v_folio > (select last_value from public.folio_2027_seq) then
    raise exception 'folio_invalido';
  end if;
  insert into public.matriculas (folio, fecha_registro, tipo, datos)
  values (v_folio, coalesce(p_ficha->>'fechaRegistro', ''), p_ficha->>'tipo', p_ficha)
  returning id into v_id;
  return v_id;
end;
$$;

-- Panel de encargados: lista todas las matrículas (cada fila trae _key = id)
create or replace function public.listar_matriculas(p_clave text)
returns setof jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  perform public._exigir_clave(p_clave);
  return query
    select m.datos || jsonb_build_object('_key', m.id)
    from public.matriculas m
    order by m.folio;
end;
$$;

-- Panel de encargados: edita una matrícula existente
create or replace function public.actualizar_matricula(p_clave text, p_id uuid, p_ficha jsonb)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public._exigir_clave(p_clave);
  update public.matriculas
     set datos = p_ficha,
         tipo = coalesce(p_ficha->>'tipo', tipo),
         fecha_registro = coalesce(p_ficha->>'fechaRegistro', fecha_registro)
   where id = p_id;
  if not found then raise exception 'matricula_no_encontrada'; end if;
end;
$$;

-- Panel de encargados: elimina una matrícula
create or replace function public.eliminar_matricula(p_clave text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public._exigir_clave(p_clave);
  delete from public.matriculas where id = p_id;
end;
$$;

-- Apoderado (QR): guarda la pre-matrícula y devuelve el código de 4 dígitos
create or replace function public.crear_prematricula(p_datos jsonb)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_intentos integer := 0;
begin
  -- limpia pre-matrículas antiguas (más de 30 días) para liberar códigos
  delete from public.prematriculas where created_at < now() - interval '30 days';
  loop
    v_codigo := lpad((1000 + floor(random() * 9000))::integer::text, 4, '0');
    begin
      insert into public.prematriculas (codigo, creada, datos)
      values (v_codigo, to_char(now() at time zone 'America/Santiago', 'DD-MM-YYYY, HH24:MI:SS'), p_datos);
      return v_codigo;
    exception when unique_violation then
      v_intentos := v_intentos + 1;
      if v_intentos >= 50 then raise exception 'sin_codigos_disponibles'; end if;
    end;
  end loop;
end;
$$;

-- Profesor: carga una pre-matrícula por su código (devuelve null si no existe)
create or replace function public.cargar_prematricula(p_codigo text)
returns jsonb
language sql stable security definer
set search_path = public
as $$ select datos from public.prematriculas where codigo = p_codigo; $$;

-- Profesor: elimina la pre-matrícula una vez usada
create or replace function public.eliminar_prematricula(p_codigo text)
returns void
language sql security definer
set search_path = public
as $$ delete from public.prematriculas where codigo = p_codigo; $$;

-- Solo estas funciones quedan disponibles para el navegador (rol anon)
grant execute on function
  public.verificar_clave(text),
  public.obtener_folio(),
  public.guardar_matricula(jsonb),
  public.listar_matriculas(text),
  public.actualizar_matricula(text, uuid, jsonb),
  public.eliminar_matricula(text, uuid),
  public.crear_prematricula(jsonb),
  public.cargar_prematricula(text),
  public.eliminar_prematricula(text)
to anon, authenticated;

-- ---------- Si vienes de Firebase y ya tenías fichas numeradas ----------
-- Para que el siguiente folio continúe después del último usado (ej. 120):
--   select setval('public.folio_2027_seq', 120);
