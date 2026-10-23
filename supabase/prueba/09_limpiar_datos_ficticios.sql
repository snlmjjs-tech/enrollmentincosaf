-- =====================================================================================================
-- 09 · LIMPIAR LOS DATOS FICTICIOS (SOLO en el proyecto de PRUEBAS)
-- =====================================================================================================
-- Dónde: SQL Editor del proyecto de PRUEBAS.  Cuándo: al terminar las pruebas.
-- Qué BORRA: matrículas, pre-matrículas y solicitudes de prueba (las que llevan «TEST» en el nombre del estudiante),
--            sesiones, intentos fallidos y la auditoría de las pruebas.
-- Qué NO toca: la estructura (tablas y funciones), las claves y el contador de folio (ver el último paso opcional).
-- PROTECCIÓN: se detiene SIN borrar nada si encuentra una matrícula o pre-matrícula que NO lleve la marca TEST
--             (así no puede borrar datos reales por error si lo ejecutaras en el proyecto equivocado).
-- =====================================================================================================
do $$
declare n_mat integer; n_pre integer;
begin
  select count(*) into n_mat from public.matriculas where coalesce(datos->'estudiante'->>'nombre', '') !~* 'TEST';
  select count(*) into n_pre from public.prematriculas where coalesce(datos->'estudiante'->>'nombre', '') !~* 'TEST';
  if n_mat > 0 or n_pre > 0 then
    raise exception 'DETENIDO: hay % matrícula(s) y % pre-matrícula(s) que NO llevan la marca TEST. Puede que no sea el proyecto de pruebas. No se borró nada.', n_mat, n_pre;
  end if;
end $$;

delete from public.matriculas    where datos->'estudiante'->>'nombre' ~* 'TEST';
delete from public.prematriculas where datos->'estudiante'->>'nombre' ~* 'TEST'
                                    or datos->'estudiantes'->0->'estudiante'->>'nombre' ~* 'TEST';
delete from public.solicitudes   s where not exists (select 1 from public.matriculas m where m.solicitud_id = s.id);
delete from public.sesiones;
delete from public.intentos;
delete from public.auditoria;

-- Resultado: todo debe quedar en 0
select (select count(*) from public.matriculas)    as matriculas,
       (select count(*) from public.prematriculas) as prematriculas,
       (select count(*) from public.solicitudes)   as solicitudes;

-- OPCIONAL (solo si quieres que el próximo folio vuelva a ser 1; ejecútalo aparte):
--   select setval('public.folio_2027_seq', 1, false);
