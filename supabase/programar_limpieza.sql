-- =====================================================================
-- LIMPIEZA AUTOMÁTICA CADA 15 MINUTOS (Supabase Cron / pg_cron)
-- Requiere haber ejecutado supabase/migraciones/003_cifrado.sql.
--
-- Qué borra la tarea (ver public.limpiar_vencidos_horas en 003_cifrado.sql):
--   · public.prematriculas más viejas que config.prematricula_horas (2 horas por defecto),
--   · public.sesiones vencidas y public.intentos de más de 2 días,
--   · public.solicitudes que reservaron folios y nunca se guardaron (más de 30 días),
--   · el paquete TEMPORAL de datos del correo (public.solicitudes.correo_paquete) con más de 24 horas.
-- Qué NO toca jamás: public.matriculas (matrículas definitivas), public.config, public.auditoria.
-- Deja una fila en public.auditoria con lo que borró (solo cantidades).
--
-- Aunque esta tarea no esté activa, una pre-matrícula vencida deja de poder cargarse (el código deja de funcionar a las 2 horas)
-- y se borra cuando alguien crea otra; la tarea solo asegura que se borre aunque nadie más use el formulario.
--
-- Pasos (en el panel de Supabase, a mano):
--   1. Database → Extensions → buscar «pg_cron» → activar.
--   2. SQL Editor → pegar y ejecutar el bloque «PROGRAMAR».
--   3. Comprobar con el bloque «VERIFICAR» o forzar una prueba con «PROBAR AHORA».
-- =====================================================================

-- Si antes programaste la limpieza diaria, retírala (no falla si no existe):
select cron.unschedule(jobid) from cron.job where jobname = 'limpiar-vencidos-diario';

-- PROGRAMAR: cada 15 minutos
select cron.schedule(
  'limpiar-vencidos-15min',
  '*/15 * * * *',
  $$ select public.limpiar_vencidos_horas() $$
);

-- VERIFICAR que existe la tarea y que se ejecutó bien:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'limpiar-vencidos-15min';
--   select status, return_message, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'limpiar-vencidos-15min')
--    order by start_time desc limit 5;
--   select momento, detalle from public.auditoria where accion = 'limpieza_automatica' order by id desc limit 5;

-- PROBAR AHORA (borra de verdad lo vencido; no toca matrículas):
--   select public.limpiar_vencidos_horas();

-- CAMBIAR LA DURACIÓN DE LA PRE-MATRÍCULA (horas, entre 1 y 72):
--   update public.config set prematricula_horas = 2 where id;
-- DESACTIVAR:  select cron.unschedule('limpiar-vencidos-15min');
