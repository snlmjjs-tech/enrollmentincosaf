-- =====================================================================================================
-- MIGRACIÓN 003 — Matrículas cifradas + pre-matrícula de pocas horas
-- =====================================================================================================
-- Qué hace (todo es ADITIVO y compatible con la página actual: con esta migración la página de hoy sigue funcionando igual):
--   1. Agrega a `config`: exigir_cifrado (apagado) y prematricula_horas (2).
--   2. Agrega a `solicitudes` un paquete TEMPORAL con los datos del correo (se borra al enviarlo o a las 24 h).
--   3. Funciones nuevas: guardar_solicitud_cifrada, actualizar_matricula_cifrada, convertir_matricula, preparar_correo,
--      limpiar_vencidos_horas. Cambian (misma firma): listar_matriculas, cambiar_folio_matricula, reservar_envio,
--      registrar_envio, crear_prematricula, cargar_prematricula.
--   4. Un seguro en la tabla `matriculas`: cuando se enciende `exigir_cifrado`, la base RECHAZA guardar fichas sin cifrar.
--
-- La base NO puede leer una matrícula cifrada: solo ve folio, fecha, tipo y texto ilegible. Quien lee es el navegador, con la
-- llave privada del colegio (nunca llega a esta base).
--
-- Cuándo ejecutarla: después de schema.sql y de 002_matricula_multiple.sql. Se puede ejecutar más de una vez.
-- Nunca la ejecutes en producción sin haberla probado antes en el proyecto de pruebas.
-- Para ENCENDER la obligación de cifrar (solo cuando todas las matrículas ya estén convertidas):
--     update public.config set exigir_cifrado = true where id;
-- Para cambiar la duración de la pre-matrícula (horas, entre 1 y 72):
--     update public.config set prematricula_horas = 2 where id;
-- =====================================================================================================

do $$
begin
  if to_regclass('public.solicitudes') is null or to_regprocedure('public.reservar_envio(text, uuid, text)') is null then
    raise exception 'Primero ejecuta supabase/schema.sql y supabase/migraciones/002_matricula_multiple.sql. No se hizo ningún cambio.';
  end if;
end $$;

-- ---------- 1. Columnas nuevas ----------
alter table public.config add column if not exists exigir_cifrado boolean not null default false;
alter table public.config add column if not exists prematricula_horas integer not null default 2;
alter table public.config drop constraint if exists config_prematricula_horas_check;
alter table public.config add constraint config_prematricula_horas_check check (prematricula_horas between 1 and 72);

alter table public.solicitudes add column if not exists correo_paquete jsonb;          -- {destinatario, apoderado, estudiantes[…]} temporal
alter table public.solicitudes add column if not exists correo_paquete_en timestamptz;

-- ---------- 2. Utilidades internas ----------
create or replace function public._exigir_cifrado()
returns boolean
language sql stable security definer
set search_path = public
as $$ select coalesce((select c.exigir_cifrado from public.config c limit 1), false); $$;

create or replace function public._horas_prematricula()
returns integer
language sql stable security definer
set search_path = public
as $$ select coalesce((select c.prematricula_horas from public.config c limit 1), 2); $$;

-- ¿Es un paquete cifrado por la página? (las matrículas antiguas, sin cifrar, no lo son)
create or replace function public._es_cifrado(p jsonb)
returns boolean
language sql immutable
as $$
  select coalesce(jsonb_typeof(p) = 'object'
     and p->>'v' = '1'
     and p->>'alg' = 'RSA-OAEP-3072+AES-256-GCM'
     and jsonb_typeof(p->'ct') = 'string'
     and jsonb_typeof(p->'ck') = 'string', false);
$$;

-- Comprueba solo la FORMA del paquete cifrado (la base no puede ver su contenido)
create or replace function public._validar_cifrado(p jsonb)
returns void
language plpgsql immutable
as $$
declare k text;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dato_invalido: la ficha cifrada no tiene el formato correcto'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('v', 'alg', 'kid', 'ck', 'iv', 'ct') then raise exception 'dato_invalido: la ficha cifrada trae un campo no permitido'; end if;
  end loop;
  if p->>'v' is distinct from '1' or p->>'alg' is distinct from 'RSA-OAEP-3072+AES-256-GCM' then
    raise exception 'dato_invalido: la ficha cifrada no tiene el formato correcto';
  end if;
  if coalesce(p->>'kid', '') !~ '^[0-9a-f]{16}$'
     or jsonb_typeof(p->'ck') is distinct from 'string' or p->>'ck' !~ '^[A-Za-z0-9+/]+={0,2}$' or length(p->>'ck') not between 300 and 1000
     or jsonb_typeof(p->'iv') is distinct from 'string' or p->>'iv' !~ '^[A-Za-z0-9+/]{16}$'
     or jsonb_typeof(p->'ct') is distinct from 'string' or p->>'ct' !~ '^[A-Za-z0-9+/]+={0,2}$' or length(p->>'ct') not between 24 and 60000 then
    raise exception 'dato_invalido: la ficha cifrada no tiene el formato correcto';
  end if;
end;
$$;

-- Paquete temporal con los datos que necesita el correo. Los folios deben ser EXACTAMENTE los de la solicitud.
create or replace function public._validar_paquete_correo(p jsonb, p_folios integer[])
returns void
language plpgsql immutable
as $$
declare k text; e jsonb; i integer := 0; n integer := coalesce(array_length(p_folios, 1), 0); c text;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'dato_invalido: los datos del correo no tienen el formato correcto'; end if;
  if octet_length(p::text) > 20000 then raise exception 'dato_invalido: los datos del correo son demasiado grandes'; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('destinatario', 'apoderado', 'estudiantes') then raise exception 'dato_invalido: campo no permitido en los datos del correo'; end if;
  end loop;
  if jsonb_typeof(p->'destinatario') is distinct from 'string' or length(p->>'destinatario') > 120
     or p->>'destinatario' !~ '^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]+$' then
    raise exception 'dato_invalido: el correo del apoderado no es válido';
  end if;
  if jsonb_typeof(p->'apoderado') is distinct from 'string' or length(p->>'apoderado') > 200
     or p->>'apoderado' ~ '[<>]' or p->>'apoderado' ~ '[[:cntrl:]]' then
    raise exception 'dato_invalido: el nombre del apoderado no es válido';
  end if;
  if jsonb_typeof(p->'estudiantes') is distinct from 'array' or jsonb_array_length(p->'estudiantes') <> n then
    raise exception 'dato_invalido: la cantidad de estudiantes del correo no coincide con la solicitud';
  end if;
  for e in select * from jsonb_array_elements(p->'estudiantes') loop
    i := i + 1;
    if jsonb_typeof(e) is distinct from 'object' then raise exception 'dato_invalido: datos del correo incorrectos'; end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('folio', 'nombre', 'rut', 'cursoMatricula', 'procedencia') then raise exception 'dato_invalido: campo no permitido en los datos del correo'; end if;
    end loop;
    if coalesce(e->>'folio', '') <> p_folios[i]::text then raise exception 'folio_invalido: el folio de los datos del correo no corresponde a la solicitud'; end if;
    foreach c in array array['nombre', 'rut', 'cursoMatricula', 'procedencia'] loop
      if e ? c and (jsonb_typeof(e->c) is distinct from 'string' or length(e->>c) > 200 or e->>c ~ '[<>]' or e->>c ~ '[[:cntrl:]]') then
        raise exception 'dato_invalido: dato no válido en el correo (%)', c;
      end if;
    end loop;
  end loop;
end;
$$;

-- ---------- 2b. Seguro en la tabla: con exigir_cifrado encendido, la base rechaza fichas sin cifrar ----------
create or replace function public._trg_exigir_cifrado()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if public._exigir_cifrado() and not public._es_cifrado(new.datos) then
    raise exception 'cifrado_obligatorio: las matrículas deben guardarse cifradas; actualiza la página (Ctrl + F5) e inténtalo de nuevo';
  end if;
  return new;
end;
$$;
drop trigger if exists matriculas_exigir_cifrado on public.matriculas;
create trigger matriculas_exigir_cifrado before insert or update of datos on public.matriculas
  for each row execute function public._trg_exigir_cifrado();

-- ---------- 3. Funciones que cambian (misma firma) ----------

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

  -- limpieza de vencidas como respaldo (la tarea programada es el mecanismo principal): duran pocas horas
  delete from public.prematriculas where created_at < now() - make_interval(hours => public._horas_prematricula());

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
  select datos into v_datos from public.prematriculas
   where codigo = v_codigo and created_at > now() - make_interval(hours => public._horas_prematricula());   -- vencida = no existe, aunque aún no se haya borrado
  if v_datos is null then
    perform public._registrar_fallo('codigo');
    return null;
  end if;
  perform public._auditar(p_clave, 'cargar_prematricula', jsonb_build_object('codigo', v_codigo));
  return v_datos;
end;
$$;

create or replace function public.reservar_envio(p_secreto text, p_solicitud uuid, p_token text)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_s public.solicitudes; v_rol text; v_dest text; v_est jsonb; v_apo text; v_cifrada boolean;
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

  select exists (select 1 from public.matriculas m where m.solicitud_id = p_solicitud and public._es_cifrado(m.datos)) into v_cifrada;
  if v_cifrada then
    -- Matrículas cifradas: la base no puede leer los datos; usa el paquete temporal que dejó el funcionario/panel (se borra al enviar)
    if v_s.correo_paquete is null then return jsonb_build_object('ok', false, 'motivo', 'sin_paquete'); end if;
    v_dest := nullif(btrim(coalesce(v_s.correo_paquete->>'destinatario', '')), '');
    v_apo := v_s.correo_paquete->>'apoderado';
    select coalesce(jsonb_agg(jsonb_build_object(
             'orden', m.orden, 'folio', m.folio, 'nombre', pe.value->>'nombre', 'rut', pe.value->>'rut', 'tipo', m.tipo,
             'cursoMatricula', pe.value->>'cursoMatricula', 'procedencia', pe.value->>'procedencia',
             'fechaRegistro', m.fecha_registro) order by m.orden), '[]'::jsonb)
      into v_est
      from public.matriculas m
      join lateral jsonb_array_elements(v_s.correo_paquete->'estudiantes') with ordinality as pe(value, n) on pe.n = m.orden
     where m.solicitud_id = p_solicitud;
    if v_dest is null then return jsonb_build_object('ok', false, 'motivo', 'sin_paquete'); end if;
  else
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
  end if;
  if v_dest is null then
    update public.solicitudes set correo_estado = 'sin_correo' where id = p_solicitud;
    return jsonb_build_object('ok', false, 'motivo', 'sin_correo');
  end if;
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
         correo_detalle = left(regexp_replace(coalesce(p_detalle, ''), '[^a-zA-Z0-9_ .:-]', '', 'g'), 80),
         -- enviado el correo, el paquete temporal con nombres y correo se borra
         correo_paquete = case when p_resultado = 'enviado' then null else correo_paquete end,
         correo_paquete_en = case when p_resultado = 'enviado' then null else correo_paquete_en end
   where id = p_solicitud and correo_estado = 'enviando';
  if not found then return jsonb_build_object('ok', false, 'motivo', 'estado'); end if;
  insert into public.auditoria (accion, rol, ip, detalle)
  values ('correo_solicitud', 'script', public._ip(), jsonb_build_object('solicitud', p_solicitud, 'resultado', p_resultado));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.listar_matriculas(p_clave text)
returns setof jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._exigir_clave(p_clave);
  perform public._auditar(p_clave, 'listar_matriculas');
  return query
    select (case when public._es_cifrado(m.datos)
                 -- cifrada: se entrega el paquete cifrado + los pocos datos que no son personales; la página la descifra con la llave
                 then jsonb_build_object('_cifrado', m.datos, 'folio', m.folio::text, 'fechaRegistro', m.fecha_registro, 'tipo', m.tipo)
                 else m.datos end) || jsonb_build_object(
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
         datos = case when public._es_cifrado(datos) then datos else jsonb_set(datos, '{folio}', to_jsonb(p_folio::text)) end   -- en las cifradas el folio va en la columna
   where id = p_id;
  if not found then raise exception 'matricula_no_encontrada'; end if;
  perform public._auditar(p_clave, 'cambiar_folio_matricula', jsonb_build_object('id', p_id, 'folio', p_folio));
end;
$$;

-- ---------- 4. Funciones nuevas ----------

-- Guardar las matrículas de una solicitud YA CIFRADAS por el navegador. Misma lógica que guardar_solicitud (folios reservados,
-- una sola operación, reintentos sin duplicar), pero la base solo comprueba la forma: no puede leer los datos.
-- Reintento: la página reenvía los MISMOS identificadores de matrícula; si la solicitud ya estaba guardada se devuelve lo guardado.
create or replace function public.guardar_solicitud_cifrada(p_clave text, p_solicitud uuid, p_matriculas jsonb, p_paquete jsonb default null)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_s public.solicitudes; v_n integer; i integer; m jsonb; k text; v_id uuid; v_ids jsonb := '[]'::jsonb;
  v_dest text; v_existentes jsonb; v_hay_paquete boolean;
begin
  perform public._exigir_clave_interna(p_clave);
  if p_solicitud is null then raise exception 'solicitud_invalida: falta el identificador de la solicitud'; end if;
  if jsonb_typeof(p_matriculas) is distinct from 'array' then raise exception 'dato_invalido: la solicitud no tiene el formato correcto'; end if;
  v_n := jsonb_array_length(p_matriculas);
  if v_n < 1 or v_n > public._max_estudiantes() then
    raise exception 'dato_invalido: se pueden matricular entre 1 y % estudiantes por solicitud', public._max_estudiantes();
  end if;
  if octet_length(p_matriculas::text) > 400000 then raise exception 'dato_invalido: la solicitud es demasiado grande'; end if;

  select * into v_s from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'solicitud_invalida: la solicitud no existe; vuelve a generar los documentos'; end if;
  if v_s.cantidad <> v_n then raise exception 'solicitud_invalida: la cantidad de estudiantes no coincide con la reservada'; end if;

  -- Reintento: ya estaba guardada → se comprueba que sea la misma solicitud (mismos identificadores) y se devuelve lo guardado
  if v_s.estado = 'guardada' then
    for i in 0..v_n - 1 loop
      if not exists (select 1 from public.matriculas x
                      where x.solicitud_id = p_solicitud and x.orden = i + 1 and x.id::text = lower(coalesce(p_matriculas->i->>'id', ''))) then
        raise exception 'solicitud_invalida: esta solicitud ya fue registrada con otros datos';
      end if;
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('orden', x.orden, 'id', x.id, 'folio', x.folio) order by x.orden), '[]'::jsonb)
      into v_existentes from public.matriculas x where x.solicitud_id = p_solicitud;
    return jsonb_build_object('ok', true, 'repetida', true, 'matriculas', v_existentes, 'correo_estado', v_s.correo_estado,
                              'advertencias', '[]'::jsonb);
  end if;

  for i in 0..v_n - 1 loop
    m := p_matriculas->i;
    if jsonb_typeof(m) is distinct from 'object' then raise exception 'dato_invalido: Estudiante %: formato incorrecto', i + 1; end if;
    for k in select jsonb_object_keys(m) loop
      if k not in ('id', 'folio', 'tipo', 'fechaRegistro', 'cifrado') then
        raise exception 'dato_invalido: Estudiante %: campo no permitido', i + 1;
      end if;
    end loop;
    if coalesce(m->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'dato_invalido: Estudiante %: identificador no válido', i + 1;
    end if;
    if coalesce(m->>'folio', '') !~ '^[0-9]{1,9}$' or (m->>'folio')::integer <> v_s.folios[i + 1] then
      raise exception 'folio_invalido: Estudiante %: el N° de ficha no corresponde a esta solicitud', i + 1;
    end if;
    if (m->>'tipo') is distinct from 'nuevo' and (m->>'tipo') is distinct from 'antiguo' then
      raise exception 'dato_invalido: Estudiante %: el tipo de estudiante no es válido', i + 1;
    end if;
    if jsonb_typeof(m->'fechaRegistro') is distinct from 'string' or length(m->>'fechaRegistro') > 60 then
      raise exception 'dato_invalido: Estudiante %: la fecha de registro no es válida', i + 1;
    end if;
    begin
      perform public._validar_cifrado(m->'cifrado');
    exception when others then
      raise exception 'dato_invalido: Estudiante %: %', i + 1, regexp_replace(sqlerrm, '^[a-z_]+: ', '');
    end;
  end loop;

  v_hay_paquete := p_paquete is not null and jsonb_typeof(p_paquete) <> 'null';
  if v_hay_paquete then
    perform public._validar_paquete_correo(p_paquete, v_s.folios);
    v_dest := p_paquete->>'destinatario';
  end if;

  for i in 0..v_n - 1 loop
    m := p_matriculas->i;
    begin
      insert into public.matriculas (id, folio, fecha_registro, tipo, datos, solicitud_id, orden)
      values ((m->>'id')::uuid, (m->>'folio')::integer, m->>'fechaRegistro', m->>'tipo', m->'cifrado', p_solicitud, i + 1)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'folio_en_uso: Estudiante %: el N° de ficha % (o esta matrícula) ya está registrado', i + 1, m->>'folio';
    end;
    v_ids := v_ids || jsonb_build_object('orden', i + 1, 'id', v_id, 'folio', (m->>'folio')::integer);
  end loop;

  update public.solicitudes
     set estado = 'guardada',
         correo_estado = case when v_dest is null then 'sin_correo' else 'pendiente' end,
         correo_paquete = case when v_dest is null then null else p_paquete end,
         correo_paquete_en = case when v_dest is null then null else now() end
   where id = p_solicitud;
  perform public._auditar(p_clave, 'guardar_solicitud', jsonb_build_object('solicitud', p_solicitud, 'estudiantes', v_n,
                          'folios', to_jsonb(v_s.folios), 'cifrada', true));
  return jsonb_build_object('ok', true, 'repetida', false, 'matriculas', v_ids,
                            'correo_estado', case when v_dest is null then 'sin_correo' else 'pendiente' end, 'advertencias', '[]'::jsonb);
end;
$$;

-- Panel: guardar los cambios de una matrícula (la página descifra, el encargado edita y la vuelve a cifrar)
create or replace function public.actualizar_matricula_cifrada(p_clave text, p_id uuid, p_tipo text, p_fecha text, p_cifrado jsonb)
returns void
language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._exigir_clave(p_clave);
  if p_tipo is distinct from 'nuevo' and p_tipo is distinct from 'antiguo' then raise exception 'dato_invalido: el tipo de estudiante no es válido'; end if;
  if p_fecha is null or length(p_fecha) > 60 then raise exception 'dato_invalido: la fecha de registro no es válida'; end if;
  perform public._validar_cifrado(p_cifrado);
  update public.matriculas set datos = p_cifrado, tipo = p_tipo, fecha_registro = p_fecha where id = p_id;
  if not found then raise exception 'matricula_no_encontrada'; end if;
  perform public._auditar(p_clave, 'actualizar_matricula', jsonb_build_object('id', p_id, 'cifrada', true));
end;
$$;

-- Convertir UNA matrícula antigua (sin cifrar) a cifrada. Solo si todavía está sin cifrar; nunca pisa una ya cifrada.
-- La página comprueba que lo cifrado se puede abrir ANTES de llamar a esta función.
create or replace function public.convertir_matricula(p_clave text, p_id uuid, p_cifrado jsonb)
returns boolean
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_datos jsonb;
begin
  perform public._exigir_clave(p_clave);
  perform public._validar_cifrado(p_cifrado);
  select datos into v_datos from public.matriculas where id = p_id for update;
  if not found then raise exception 'matricula_no_encontrada'; end if;
  if public._es_cifrado(v_datos) then return false; end if;
  update public.matriculas set datos = p_cifrado where id = p_id;
  perform public._auditar(p_clave, 'convertir_matricula', jsonb_build_object('id', p_id));
  return true;
end;
$$;

-- Dejar (o volver a dejar) el paquete TEMPORAL del correo de una solicitud ya guardada. Lo usa el funcionario si falló el envío
-- (solo solicitudes de las últimas 24 h) y el panel para reenviar. El paquete se borra al enviarse el correo, o a las 24 h.
create or replace function public.preparar_correo(p_clave text, p_solicitud uuid, p_paquete jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_s public.solicitudes; v_rol text; v_folios integer[];
begin
  perform public._exigir_clave_interna(p_clave);
  v_rol := public._rol(p_clave);
  select * into v_s from public.solicitudes where id = p_solicitud for update;
  if not found then raise exception 'solicitud_invalida: la solicitud no existe'; end if;
  if v_s.estado <> 'guardada' then raise exception 'solicitud_invalida: la solicitud todavía no está guardada'; end if;
  if v_rol is distinct from 'admin' and v_s.creada < now() - interval '24 hours' then
    raise exception 'clave_incorrecta' using errcode = '28000';
  end if;
  if v_s.correo_estado = 'enviado' then return jsonb_build_object('ok', true, 'ya_enviado', true); end if;
  select array_agg(m.folio order by m.orden) into v_folios from public.matriculas m where m.solicitud_id = p_solicitud;
  if v_folios is null then raise exception 'solicitud_invalida: la solicitud no tiene matrículas'; end if;
  perform public._validar_paquete_correo(p_paquete, v_folios);
  update public.solicitudes
     set correo_paquete = p_paquete, correo_paquete_en = now(),
         correo_estado = case when correo_estado = 'sin_correo' then 'pendiente' else correo_estado end
   where id = p_solicitud;
  perform public._auditar(p_clave, 'preparar_correo', jsonb_build_object('solicitud', p_solicitud));
  return jsonb_build_object('ok', true);
end;
$$;

-- Limpieza automática (se programa cada 15 minutos; ver supabase/programar_limpieza.sql): pre-matrículas vencidas (pocas horas),
-- sesiones e intentos antiguos, solicitudes que reservaron folios y nunca se guardaron, y paquetes de correo de más de 24 h.
create or replace function public.limpiar_vencidos_horas()
returns jsonb
language plpgsql security definer
set search_path = public, extensions
as $$
declare v_pre integer; v_ses integer; v_int integer; v_sol integer; v_paq integer;
begin
  delete from public.prematriculas where created_at < now() - make_interval(hours => public._horas_prematricula());
  get diagnostics v_pre = row_count;
  delete from public.sesiones where expira < now();
  get diagnostics v_ses = row_count;
  delete from public.intentos where momento < now() - interval '2 days';
  get diagnostics v_int = row_count;
  delete from public.solicitudes where estado = 'reservada' and creada < now() - interval '30 days';
  get diagnostics v_sol = row_count;
  update public.solicitudes set correo_paquete = null, correo_paquete_en = null
   where correo_paquete is not null and correo_paquete_en < now() - interval '24 hours';
  get diagnostics v_paq = row_count;
  if v_pre + v_ses + v_sol + v_paq > 0 then
    insert into public.auditoria (accion, rol, detalle)
    values ('limpieza_automatica', 'sistema',
            jsonb_build_object('prematriculas_borradas', v_pre, 'sesiones_borradas', v_ses, 'intentos_borrados', v_int,
                               'solicitudes_sin_guardar_borradas', v_sol, 'paquetes_correo_borrados', v_paq));
  end if;
  return jsonb_build_object('prematriculas', v_pre, 'sesiones', v_ses, 'intentos', v_int, 'solicitudes_sin_guardar', v_sol, 'paquetes_correo', v_paq);
end;
$$;

-- ---------- 5. Permisos ----------
revoke all on function
  public._exigir_cifrado(), public._horas_prematricula(), public._es_cifrado(jsonb), public._validar_cifrado(jsonb),
  public._validar_paquete_correo(jsonb, integer[]), public._trg_exigir_cifrado(), public.limpiar_vencidos_horas()
from public, anon, authenticated;

revoke all on function
  public.guardar_solicitud_cifrada(text, uuid, jsonb, jsonb), public.actualizar_matricula_cifrada(text, uuid, text, text, jsonb),
  public.convertir_matricula(text, uuid, jsonb), public.preparar_correo(text, uuid, jsonb)
from public;

grant execute on function
  public.guardar_solicitud_cifrada(text, uuid, jsonb, jsonb),
  public.actualizar_matricula_cifrada(text, uuid, text, text, jsonb),
  public.convertir_matricula(text, uuid, jsonb),
  public.preparar_correo(text, uuid, jsonb)
to anon, authenticated;
