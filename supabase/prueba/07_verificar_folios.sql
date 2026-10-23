-- =====================================================================================================
-- 07 · VERIFICAR FOLIOS Y SOLICITUDES (solo lee; no cambia nada)
-- =====================================================================================================
-- Dónde: SQL Editor del proyecto de PRUEBAS.  Cuándo: después de matricular a los estudiantes de prueba.
-- Ejecuta cada bloque por separado (selecciona el bloque y pulsa Run), o todos juntos y revisa cada resultado.
-- =====================================================================================================

-- A. Folios repetidos: DEBE DEVOLVER 0 FILAS
select folio, count(*) as veces from public.matriculas group by folio having count(*) > 1;

-- B. Cada solicitud guardada: cuántos estudiantes, sus folios y el estado del correo
select left(s.id::text, 8)                                  as solicitud,
       s.cantidad                                           as estudiantes_reservados,
       count(m.id)                                          as matriculas_guardadas,
       array_agg(m.folio order by m.orden)                  as folios,
       s.correo_estado                                      as correo,
       s.correo_intentos                                    as intentos_de_correo
  from public.solicitudes s left join public.matriculas m on m.solicitud_id = s.id
 where s.estado = 'guardada'
 group by s.id, s.cantidad, s.correo_estado, s.correo_intentos, s.creada
 order by s.creada desc;

-- C. Solicitudes con matrículas faltantes o con folios que no coinciden con los reservados: DEBE DEVOLVER 0 FILAS
--    (si alguien elimina o cambia el folio de una matrícula desde el panel, aparecerá aquí a propósito)
select left(s.id::text, 8) as solicitud, s.folios as reservados, array_agg(m.folio order by m.orden) as guardados
  from public.solicitudes s join public.matriculas m on m.solicitud_id = s.id
 where s.estado = 'guardada'
 group by s.id, s.folios
having s.folios is distinct from array_agg(m.folio order by m.orden);

-- D. Folios consecutivos y huecos (los huecos son normales: un folio reservado que no se usó no se reutiliza)
select min(folio) as primero, max(folio) as ultimo, count(*) as total, (max(folio) - min(folio) + 1) - count(*) as huecos
  from public.matriculas where folio < 9000;

-- E. Una fila por estudiante de las pruebas, con su solicitud y orden
select m.folio, left(m.solicitud_id::text, 8) as solicitud, m.orden, m.tipo,
       m.datos->'estudiante'->>'nombre'          as estudiante,
       m.datos->'estudiante'->>'cursoMatricula'  as curso,
       m.datos->'apoderado'->>'parentesco'       as parentesco
  from public.matriculas m
 where m.datos->'estudiante'->>'nombre' ~* 'TEST'
 order by m.solicitud_id nulls first, m.orden, m.folio;
