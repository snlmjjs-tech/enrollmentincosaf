-- =====================================================================================================
-- MIGRACIÓN 004 — Promedio de egreso de 8° básico (estudiantes nuevos, opcional)
-- =====================================================================================================
-- Qué hace: la validación del servidor (public._validar_ficha) acepta el campo «promedio8» en la ficha del estudiante y,
-- si viene con un valor, exige una nota de 1,0 a 7,0 (con coma y hasta 2 decimales). Es ADITIVA: las matrículas y
-- pre-matrículas existentes no se tocan y la página actual sigue funcionando igual.
--
-- Cuándo ejecutarla: después de schema.sql y de las migraciones 002 y 003, y ANTES de publicar la página que pide el promedio
-- (si la página nueva se publica antes, el servidor rechazaría las pre-matrículas con «campo no permitido: promedio8»).
-- Se puede ejecutar más de una vez sin problema. Nunca la ejecutes en producción sin haberla probado antes.
-- =====================================================================================================

do $$
begin
  if to_regprocedure('public._validar_ficha(jsonb, boolean)') is null then
    raise exception 'Primero ejecuta supabase/schema.sql y las migraciones 002 y 003. No se hizo ningún cambio.';
  end if;
end $$;

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
    'nombre','rut','fnac','direccion','comuna','nacionalidad','celular','correo','procedencia','promedio8',
    'cursoMatricula','repitencia','repCurso','repAnio','pie','pieDiagnostico','pieDocumentacion',
    'salud','saludDetalle','observaciones']);
  -- Promedio de egreso de 8° básico (opcional): una nota de 1,0 a 7,0, con coma y hasta 2 decimales
  if coalesce(e->>'promedio8', '') <> '' then
    if e->>'promedio8' !~ '^[1-7](,[0-9]{1,2})?$' or replace(e->>'promedio8', ',', '.')::numeric > 7 then
      raise exception 'dato_invalido: el promedio de egreso de 8° debe ser una nota de 1,0 a 7,0';
    end if;
  end if;
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

-- Las funciones internas no son accesibles desde el navegador (igual que antes)
revoke all on function public._validar_ficha(jsonb, boolean) from public, anon, authenticated;
