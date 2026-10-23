-- =====================================================================================================
-- MIGRACIÓN 002 — Matrícula de varios estudiantes en una misma solicitud + estados del correo
-- =====================================================================================================
-- Qué hace (todo es ADITIVO: no borra ni cambia datos existentes):
--   1. Crea la tabla `solicitudes` (una fila por solicitud: folios reservados, estado del correo).
--   2. Agrega a `matriculas` las columnas `solicitud_id` y `orden` (las matrículas antiguas quedan en NULL).
--   3. Agrega a `config` la columna `clave_script_hash` (secreto que solo conoce el Apps Script).
--   4. Crea las funciones: reservar_folios, guardar_solicitud, reservar_envio, registrar_envio.
--   5. Reemplaza (create or replace, misma firma): listar_matriculas, eliminar_matricula,
--      crear_prematricula (ahora acepta varios estudiantes) y limpiar_vencidos.
--
-- Cuándo ejecutarla: DESPUÉS de supabase/schema.sql (la verifica al comenzar) y antes de publicar la
-- versión de la página que usa la matrícula múltiple. Se puede ejecutar más de una vez sin problema.
-- Nunca la ejecutes en producción sin haberla probado antes en el proyecto de pruebas.
-- Esta migración NO define ningún secreto ni clave: el secreto del script se define aparte
-- (supabase/prueba/02_secreto_script.sql.ejemplo o la guía de producción).
-- =====================================================================================================

do $$
begin
  if to_regclass('public.matriculas') is null or to_regprocedure('public._validar_ficha(jsonb, boolean)') is null then
    raise exception 'Primero ejecuta supabase/schema.sql (falta la base de seguridad). No se hizo ningún cambio.';
  end if;
end $$;

-- ---------- 1. Tabla de solicitudes ----------
-- Una solicitud agrupa las matrículas de los hermanos que se inscriben juntos. Cada alumno conserva su
-- propia fila en `matriculas` y su propio folio; `solicitud_id` solo las relaciona.
create table if not exists public.solicitudes (
  id               uuid primary key,                       -- lo genera la página (permite reintentos sin duplicar)
  creada           timestamptz not null default now(),
  cantidad         integer not null check (cantidad between 1 and 5),
  folios           integer[] not null,                     -- folios reservados para esta solicitud (en orden)
  estado           text not null default 'reservada' check (estado in ('reservada', 'guardada')),
  correo_estado    text not null default 'pendiente'
                   check (correo_estado in ('sin_correo', 'pendiente', 'enviando', 'enviado', 'error')),
  correo_intentos  integer not null default 0,
  correo_reservado timestamptz,                            -- cuándo empezó el último intento de envío
  correo_enviado   timestamptz,
  correo_detalle   text                                    -- código corto del último error (sin datos personales)
);
create index if not exists solicitudes_creada_idx on public.solicitudes (creada);

alter table public.matriculas add column if not exists solicitud_id uuid references public.solicitudes (id) on delete set null;
alter table public.matriculas add column if not exists orden integer;
create unique index if not exists matriculas_solicitud_orden_uq on public.matriculas (solicitud_id, orden) where solicitud_id is not null;
create index if not exists matriculas_solicitud_idx on public.matriculas (solicitud_id);

alter table public.config add column if not exists clave_script_hash text;

alter table public.solicitudes enable row level security;
revoke all on public.solicitudes from anon, authenticated;

-- ---------- 2. Utilidades internas ----------

-- Máximo de estudiantes por solicitud (la página tiene el mismo valor en MAX_ESTUDIANTES)
create or replace function public._max_estudiantes()
returns integer language sql immutable as $$ select 5; $$;

create or replace function public._rut_limpio(p text)
returns text language sql immutable as $$ select regexp_replace(upper(coalesce(p, '')), '[^0-9K]', '', 'g'); $$;

-- ¿El secreto que presenta el Apps Script es el correcto?
create or replace function public._secreto_script_ok(p text)
returns boolean
language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce((select c.clave_script_hash is not null and c.clave_script_hash = extensions.crypt(coalesce(p, ''), c.clave_script_hash)
                     from public.config c where c.id), false);
$$;

-- Convierte una solicitud con varios estudiantes en la lista de fichas individuales (misma forma que una
-- ficha de siempre). El apoderado y el suplente se comparten; el parentesco y «vive con» pueden variar por alumno.
create or replace function public._fichas_de_solicitud(p jsonb)
returns setof jsonb
language plpgsql immutable
as $$
declare e jsonb; a jsonb;
begin
  for e in select * from jsonb_array_elements(p->'estudiantes') loop
    a := coalesce(p->'apoderado', '{}'::jsonb);
    if coalesce(e->>'parentesco', '') <> '' then a := a || jsonb_build_object('parentesco', e->'parentesco'); end if;
    if coalesce(e->>'viveConEstudiante', '') <> '' then a := a || jsonb_build_object('viveConEstudiante', e->'viveConEstudiante'); end if;
    return next jsonb_build_object('tipo', e->'tipo', 'estudiante', e->'estudiante', 'apoderado', a, 'suplente', p->'suplente');
  end loop;
end;
$$;

-- Valida una pre-matrícula con varios estudiantes (formato: {apoderado, suplente, estudiantes:[…]})
create or replace function public._validar_solicitud(p jsonb)
returns void
language plpgsql immutable
as $$
declare k text; e jsonb; i integer := 0; n integer; f jsonb; ruts text[] := '{}'; r text;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'dato_invalido: la solicitud no tiene el formato correcto'; end if;
  if octet_length(p::text) > 150000 then raise exception 'dato_invalido: la solicitud es demasiado grande'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('apoderado', 'suplente', 'estudiantes') then
      raise exception 'dato_invalido: campo no permitido: %', left(k, 40);
    end if;
  end loop;
  if jsonb_typeof(p->'estudiantes') <> 'array' then raise exception 'dato_invalido: falta la lista de estudiantes'; end if;
  n := jsonb_array_length(p->'estudiantes');
  if n < 1 then raise exception 'dato_invalido: debe haber al menos un estudiante'; end if;
  if n > public._max_estudiantes() then
    raise exception 'dato_invalido: se pueden matricular hasta % estudiantes por solicitud', public._max_estudiantes();
  end if;
  for e in select * from jsonb_array_elements(p->'estudiantes') loop
    i := i + 1;
    if jsonb_typeof(e) <> 'object' then raise exception 'dato_invalido: Estudiante %: formato incorrecto', i; end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('tipo', 'estudiante', 'parentesco', 'viveConEstudiante') then
        raise exception 'dato_invalido: Estudiante %: campo no permitido: %', i, left(k, 40);
      end if;
    end loop;
  end loop;
  i := 0;
  for f in select * from public._fichas_de_solicitud(p) loop
    i := i + 1;
    begin
      perform public._validar_ficha(f, false);
    exception when others then
      raise exception 'dato_invalido: Estudiante %: %', i, regexp_replace(sqlerrm, '^[a-z_]+: ', '');
    end;
    r := public._rut_limpio(f->'estudiante'->>'rut');
    if r = any (ruts) then raise exception 'dato_invalido: Estudiante %: el RUT está repetido en la solicitud', i; end if;
    ruts := ruts || r;
  end loop;
end;
$$;

-- ---------- 3. Reservar folios (al generar los documentos) ----------
-- Idempotente: con la misma solicitud devuelve los mismos folios (no consume otros). Los folios solo se
-- pueden usar al guardar esa misma solicitud.
create or replace function public.reservar_folios(p_clave text, p_solicitud uuid, p_cantidad integer)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_s public.solicitudes; v_folios integer[] := '{}'; i integer;
begin
  perform public._exigir_clave_interna(p_clave);
  if p_solicitud is null then raise exception 'solicitud_invalida: falta el identificador de la solicitud'; end if;
  if p_cantidad is null or p_cantidad < 1 or p_cantidad > public._max_estudiantes() then
    raise exception 'dato_invalido: se pueden matricular entre 1 y % estudiantes por solicitud', public._max_estudiantes();
  end if;
  select * into v_s from public.solicitudes where id = p_solicitud for update;
  if found then
    if v_s.cantidad <> p_cantidad then
      raise exception 'solicitud_invalida: la solicitud ya reservó % ficha(s); empieza una solicitud nueva', v_s.cantidad;
    end if;
    return jsonb_build_object('folios', to_jsonb(v_s.folios), 'estado', v_s.estado, 'repetida', true);
  end if;
  if (select count(*) from public.solicitudes where estado = 'reservada' and creada > now() - interval '10 minutes') >= 100 then
    raise exception 'demasiadas_solicitudes: Hay demasiadas solicitudes sin terminar. Espera unos minutos.';
  end if;
  for i in 1..p_cantidad loop
    v_folios := v_folios || nextval('public.folio_2027_seq')::integer;
  end loop;
  insert into public.solicitudes (id, cantidad, folios) values (p_solicitud, p_cantidad, v_folios);
  perform public._auditar(p_clave, 'reservar_folios', jsonb_build_object('solicitud', p_solicitud, 'cantidad', p_cantidad));
  return jsonb_build_object('folios', to_jsonb(v_folios), 'estado', 'reservada', 'repetida', false);
end;
$$;

-- ---------- 4. Guardar la solicitud (todas las matrículas o ninguna) ----------
-- p_fichas: lista de fichas con folio y fechaRegistro (una por estudiante, en orden).
-- Es una sola transacción: si cualquiera falla no se guarda ninguna. Con la misma solicitud devuelve lo ya
-- guardado (doble clic, recarga, reintento tras un error de red): nunca duplica matrículas ni folios.
create or replace function public.guardar_solicitud(p_clave text, p_solicitud uuid, p_fichas jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_s public.solicitudes; v_n integer; i integer; f jsonb; v_id uuid; v_ids jsonb := '[]'::jsonb;
  v_rut_apo text; v_ruts text[] := '{}'; r text; v_correo text; v_adv jsonb := '[]'::jsonb; v_otro integer;
  v_existentes jsonb;
begin
  perform public._exigir_clave_interna(p_clave);
  if p_solicitud is null then raise exception 'solicitud_invalida: falta el identificador de la solicitud'; end if;
  if jsonb_typeof(p_fichas) <> 'array' then raise exception 'dato_invalido: la solicitud no tiene el formato correcto'; end if;
  v_n := jsonb_array_length(p_fichas);
  if v_n < 1 or v_n > public._max_estudiantes() then
    raise exception 'dato_invalido: se pueden matricular entre 1 y % estudiantes por solicitud', public._max_estudiantes();
  end if;
  if octet_length(p_fichas::text) > 150000 then raise exception 'dato_invalido: la solicitud es demasiado grande'; end if;

  select * into v_s from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'solicitud_invalida: la solicitud no existe; vuelve a generar los documentos'; end if;
  if v_s.cantidad <> v_n then raise exception 'solicitud_invalida: la cantidad de estudiantes no coincide con la reservada'; end if;

  -- Reintento: ya estaba guardada → se devuelve lo guardado (después de comprobar que es la misma solicitud)
  if v_s.estado = 'guardada' then
    for i in 0..v_n - 1 loop
      if not exists (select 1 from public.matriculas m
                      where m.solicitud_id = p_solicitud and m.orden = i + 1
                        and public._rut_limpio(m.datos->'estudiante'->>'rut') = public._rut_limpio(p_fichas->i->'estudiante'->>'rut')) then
        raise exception 'solicitud_invalida: esta solicitud ya fue registrada con otros datos';
      end if;
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('orden', m.orden, 'id', m.id, 'folio', m.folio) order by m.orden), '[]'::jsonb)
      into v_existentes from public.matriculas m where m.solicitud_id = p_solicitud;
    return jsonb_build_object('ok', true, 'repetida', true, 'matriculas', v_existentes, 'correo_estado', v_s.correo_estado,
                              'advertencias', '[]'::jsonb);
  end if;

  -- Validación de cada ficha (se indica qué estudiante tiene el problema)
  for i in 0..v_n - 1 loop
    f := p_fichas->i;
    begin
      perform public._validar_ficha(f, true);
    exception when others then
      raise exception 'dato_invalido: Estudiante %: %', i + 1, regexp_replace(sqlerrm, '^[a-z_]+: ', '');
    end;
    if (f->>'folio')::integer <> v_s.folios[i + 1] then
      raise exception 'folio_invalido: Estudiante %: el N° de ficha no corresponde a esta solicitud', i + 1;
    end if;
    r := public._rut_limpio(f->'estudiante'->>'rut');
    if r = any (v_ruts) then raise exception 'dato_invalido: Estudiante %: el RUT está repetido en la solicitud', i + 1; end if;
    v_ruts := v_ruts || r;
    if i = 0 then
      v_rut_apo := public._rut_limpio(f->'apoderado'->>'rut');
      v_correo := nullif(btrim(coalesce(f->'apoderado'->>'correo', '')), '');
    elsif public._rut_limpio(f->'apoderado'->>'rut') <> v_rut_apo then
      raise exception 'dato_invalido: Estudiante %: el apoderado debe ser el mismo en toda la solicitud', i + 1;
    end if;
  end loop;

  for i in 0..v_n - 1 loop
    f := p_fichas->i;
    begin
      insert into public.matriculas (folio, fecha_registro, tipo, datos, solicitud_id, orden)
      values ((f->>'folio')::integer, coalesce(f->>'fechaRegistro', ''), f->>'tipo', f, p_solicitud, i + 1)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'folio_en_uso: Estudiante %: el N° de ficha % ya está en uso', i + 1, f->>'folio';
    end;
    v_ids := v_ids || jsonb_build_object('orden', i + 1, 'id', v_id, 'folio', (f->>'folio')::integer);
    -- Aviso (no bloquea): el RUT del estudiante ya figura en otra solicitud
    select m.folio into v_otro from public.matriculas m
     where public._rut_limpio(m.datos->'estudiante'->>'rut') = public._rut_limpio(f->'estudiante'->>'rut')
       and m.solicitud_id is distinct from p_solicitud
     order by m.folio limit 1;
    if v_otro is not null then v_adv := v_adv || jsonb_build_object('orden', i + 1, 'folio_existente', v_otro); end if;
  end loop;

  update public.solicitudes
     set estado = 'guardada', correo_estado = case when v_correo is null then 'sin_correo' else 'pendiente' end
   where id = p_solicitud;
  perform public._auditar(p_clave, 'guardar_solicitud', jsonb_build_object('solicitud', p_solicitud, 'estudiantes', v_n, 'folios', to_jsonb(v_s.folios)));
  return jsonb_build_object('ok', true, 'repetida', false, 'matriculas', v_ids,
                            'correo_estado', case when v_correo is null then 'sin_correo' else 'pendiente' end, 'advertencias', v_adv);
end;
$$;

-- ---------- 5. Envío del correo (lo usa SOLO el Apps Script) ----------
-- El Apps Script presenta (a) el secreto que solo él conoce (guardado como hash en config.clave_script_hash y en las
-- propiedades privadas del script, NUNCA en la página) y (b) el token de sesión del funcionario. El destinatario y los
-- datos del correo salen de AQUÍ (la base), no de lo que envíe el navegador.
create or replace function public.reservar_envio(p_secreto text, p_solicitud uuid, p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_s public.solicitudes; v_rol text; v_dest text; v_est jsonb; v_apo text;
begin
  if public._bloqueado('script', 5, interval '15 minutes', 50) then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;
  if not public._secreto_script_ok(p_secreto) then
    perform public._registrar_fallo('script');
    return jsonb_build_object('ok', false, 'motivo', 'secreto');
  end if;
  v_rol := public._rol(p_token);
  if v_rol is null then return jsonb_build_object('ok', false, 'motivo', 'sesion'); end if;

  select * into v_s from public.solicitudes where id = p_solicitud for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;
  -- Un funcionario solo puede enviar solicitudes recientes (24 h); el panel de encargados, cualquiera
  if v_rol <> 'admin' and v_s.creada < now() - interval '24 hours' then
    return jsonb_build_object('ok', false, 'motivo', 'sesion');
  end if;
  if v_s.estado <> 'guardada' then return jsonb_build_object('ok', false, 'motivo', 'no_guardada'); end if;
  if v_s.correo_estado = 'enviado' then return jsonb_build_object('ok', false, 'motivo', 'ya_enviado'); end if;
  if v_s.correo_estado = 'enviando' and v_s.correo_reservado > now() - interval '10 minutes' then
    return jsonb_build_object('ok', false, 'motivo', 'en_proceso');
  end if;
  if v_s.correo_intentos >= 6 then return jsonb_build_object('ok', false, 'motivo', 'demasiados_reintentos'); end if;

  select nullif(btrim(coalesce(m.datos->'apoderado'->>'correo', '')), ''), m.datos->'apoderado'->>'nombre'
    into v_dest, v_apo
    from public.matriculas m where m.solicitud_id = p_solicitud order by m.orden limit 1;
  if v_dest is null then
    update public.solicitudes set correo_estado = 'sin_correo' where id = p_solicitud;
    return jsonb_build_object('ok', false, 'motivo', 'sin_correo');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'orden', m.orden, 'folio', m.folio, 'nombre', m.datos->'estudiante'->>'nombre', 'rut', m.datos->'estudiante'->>'rut',
           'tipo', m.tipo,
           'cursoMatricula', m.datos->'estudiante'->>'cursoMatricula', 'procedencia', m.datos->'estudiante'->>'procedencia',
           'fechaRegistro', m.fecha_registro) order by m.orden), '[]'::jsonb)
    into v_est from public.matriculas m where m.solicitud_id = p_solicitud;
  if jsonb_array_length(v_est) = 0 then return jsonb_build_object('ok', false, 'motivo', 'no_encontrada'); end if;

  update public.solicitudes
     set correo_estado = 'enviando', correo_reservado = now(), correo_intentos = correo_intentos + 1
   where id = p_solicitud;
  return jsonb_build_object('ok', true, 'destinatario', v_dest, 'apoderado', v_apo, 'solicitud', p_solicitud, 'estudiantes', v_est);
end;
$$;

create or replace function public.registrar_envio(p_secreto text, p_solicitud uuid, p_resultado text, p_detalle text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if public._bloqueado('script', 5, interval '15 minutes', 50) then
    return jsonb_build_object('ok', false, 'motivo', 'bloqueado');
  end if;
  if not public._secreto_script_ok(p_secreto) then
    perform public._registrar_fallo('script');
    return jsonb_build_object('ok', false, 'motivo', 'secreto');
  end if;
  if p_resultado not in ('enviado', 'error') then return jsonb_build_object('ok', false, 'motivo', 'resultado'); end if;
  update public.solicitudes
     set correo_estado = p_resultado,
         correo_enviado = case when p_resultado = 'enviado' then now() else correo_enviado end,
         correo_detalle = left(regexp_replace(coalesce(p_detalle, ''), '[^a-zA-Z0-9_ .:-]', '', 'g'), 80)
   where id = p_solicitud and correo_estado = 'enviando';
  if not found then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
  insert into public.auditoria (accion, rol, ip, detalle)
  values ('correo_solicitud', 'script', public._ip(), jsonb_build_object('solicitud', p_solicitud, 'resultado', p_resultado));
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------- 6. Funciones existentes que cambian (misma firma) ----------

-- Panel: además de la ficha, cada fila trae la solicitud a la que pertenece y el estado del correo
create or replace function public.listar_matriculas(p_clave text)
returns setof jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._exigir_clave(p_clave);
  perform public._auditar(p_clave, 'listar_matriculas');
  return query
    select m.datos || jsonb_build_object(
             '_key', m.id,
             '_solicitud', m.solicitud_id,
             '_orden', m.orden,
             '_hermanos', case when m.solicitud_id is null then 1
                               else (select count(*) from public.matriculas x where x.solicitud_id = m.solicitud_id) end,
             '_correo', s.correo_estado)
    from public.matriculas m
    left join public.solicitudes s on s.id = m.solicitud_id
    order by m.folio;
end;
$$;

-- Eliminar una matrícula no toca a sus hermanos; si la solicitud queda vacía, se retira también
create or replace function public.eliminar_matricula(p_clave text, p_id uuid)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_folio integer; v_sol uuid;
begin
  perform public._exigir_clave(p_clave);
  delete from public.matriculas where id = p_id returning folio, solicitud_id into v_folio, v_sol;
  if v_sol is not null then
    delete from public.solicitudes s where s.id = v_sol and not exists (select 1 from public.matriculas m where m.solicitud_id = s.id);
  end if;
  perform public._auditar(p_clave, 'eliminar_matricula', jsonb_build_object('id', p_id, 'folio', v_folio));
end;
$$;

-- Pre-matrícula pública: acepta una ficha (formato anterior) o una solicitud con varios estudiantes
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

  if p_datos ? 'estudiantes' then
    perform public._validar_solicitud(p_datos);        -- varios estudiantes
  else
    perform public._validar_ficha(p_datos, false);     -- un estudiante (formato anterior)
  end if;

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

-- Limpieza automática: igual que antes, y además retira solicitudes que reservaron folios y nunca se guardaron
create or replace function public.limpiar_vencidos(p_dias_prematricula integer default 30)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_pre integer; v_ses integer; v_int integer; v_sol integer;
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
  delete from public.solicitudes where estado = 'reservada' and creada < now() - make_interval(days => p_dias_prematricula);
  get diagnostics v_sol = row_count;
  insert into public.auditoria (accion, rol, detalle)
  values ('limpieza_automatica', 'sistema',
          jsonb_build_object('prematriculas_borradas', v_pre, 'sesiones_borradas', v_ses, 'intentos_borrados', v_int,
                             'solicitudes_sin_guardar_borradas', v_sol, 'dias_conservacion', p_dias_prematricula));
  return jsonb_build_object('prematriculas', v_pre, 'sesiones', v_ses, 'intentos', v_int, 'solicitudes_sin_guardar', v_sol);
end;
$$;

-- ---------- 7. Permisos ----------
revoke all on function
  public._max_estudiantes(), public._rut_limpio(text), public._secreto_script_ok(text),
  public._fichas_de_solicitud(jsonb), public._validar_solicitud(jsonb), public.limpiar_vencidos(integer)
from public, anon, authenticated;

revoke all on function
  public.reservar_folios(text, uuid, integer), public.guardar_solicitud(text, uuid, jsonb),
  public.reservar_envio(text, uuid, text), public.registrar_envio(text, uuid, text, text)
from public;

grant execute on function
  public.reservar_folios(text, uuid, integer),
  public.guardar_solicitud(text, uuid, jsonb),
  public.reservar_envio(text, uuid, text),
  public.registrar_envio(text, uuid, text, text)
to anon, authenticated;
