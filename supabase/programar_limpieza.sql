-- =====================================================================
-- LIMPIEZA AUTOMÁTICA DIARIA DE PRE-MATRÍCULAS VENCIDAS (Supabase Cron / pg_cron)
--
-- Qué borra la tarea (ver public.limpiar_vencidos en schema.sql):
--   · public.prematriculas con más de N días (pre-matrículas pendientes que nunca se concretaron),
--   · public.sesiones vencidas e public.intentos de más de 2 días.
-- Qué NO toca jamás: public.matriculas (matrículas definitivas), public.config, public.auditoria.
-- Deja una fila en public.auditoria con lo que borró.
--
-- Pasos (en el panel de Supabase, a mano):
--   1. Database → Extensions → buscar «pg_cron» → activar.
--   2. SQL Editor → pegar y ejecutar el bloque «PROGRAMAR».
--   3. Comprobar con el bloque «VERIFICAR» (al día siguiente) o forzar una prueba con «PROBAR AHORA».
-- =====================================================================

-- PROGRAMAR: todos los días a las 06:15 UTC (03:15 hora de Chile en horario de verano, 02:15 en invierno)
select cron.schedule(
  'limpiar-vencidos-diario',
  '15 6 * * *',
  $$ select public.limpiar_vencidos(30) $$      -- 30 = días de conservación de pre-matrículas
);

-- VERIFICAR que existe la tarea y que se ejecutó bien:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'limpiar-vencidos-diario';
--   select status, return_message, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'limpiar-vencidos-diario')
--    order by start_time desc limit 5;
--   select momento, detalle from public.auditoria where accion = 'limpieza_automatica' order by id desc limit 5;

-- PROBAR AHORA (borra de verdad las pre-matrículas de más de 30 días; no toca matrículas):
--   select public.limpiar_vencidos(30);

-- CAMBIAR EL PERÍODO (por ejemplo a 45 días): volver a ejecutar cron.schedule con el mismo nombre
-- y el nuevo número.   DESACTIVAR:  select cron.unschedule('limpiar-vencidos-diario');
