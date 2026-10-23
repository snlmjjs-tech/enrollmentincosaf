-- =====================================================================================================
-- 08 · VERIFICAR EL ENVÍO DEL CORREO EN LA BASE (solo lee; no cambia nada)
-- =====================================================================================================
-- Dónde: SQL Editor del proyecto de PRUEBAS.  Cuándo: antes y después de la prueba real del correo.
-- Qué mirar tras UNA solicitud de 2 o 3 estudiantes:
--   · correo_estado = 'enviado'  y  correo_intentos = 1 (o más si hubo reintentos)
--   · una sola fila por solicitud (un solo correo por solicitud)
--   · en la auditoría: una línea «correo_solicitud» con resultado «enviado» (sin nombres ni correos)
-- =====================================================================================================
select left(id::text, 8) as solicitud, estado, cantidad as estudiantes, correo_estado, correo_intentos,
       correo_enviado at time zone 'America/Santiago' as enviado_en, correo_detalle as ultimo_error
  from public.solicitudes order by creada desc limit 10;

select momento at time zone 'America/Santiago' as momento, accion, rol, detalle
  from public.auditoria where accion in ('reservar_folios', 'guardar_solicitud', 'correo_solicitud') order by id desc limit 20;

-- Cada correo se cuenta una sola vez: no debe haber solicitudes «enviado» con más de 1 envío registrado
select left(solicitud, 8) as solicitud, count(*) as envios_registrados
  from (select detalle->>'solicitud' as solicitud from public.auditoria where accion = 'correo_solicitud' and detalle->>'resultado' = 'enviado') x
 group by solicitud having count(*) > 1;        -- DEBE DEVOLVER 0 FILAS
