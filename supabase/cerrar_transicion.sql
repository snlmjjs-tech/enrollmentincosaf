-- =====================================================================
-- CERRAR LA TRANSICIÓN
--
-- Ejecuta este archivo SOLO DESPUÉS de publicar la versión nueva de la página (la que inicia sesión
-- con token). Desde ese momento:
--   · las funciones dejan de aceptar la clave directamente (solo tokens de sesión),
--   · se eliminan las funciones antiguas de verificación de clave.
--
-- Si lo ejecutas antes de publicar la página nueva, la página antigua dejará de funcionar.
-- Para volver atrás:  update public.config set modo_transicion = true where id;
-- =====================================================================
update public.config set modo_transicion = false where id;
drop function if exists public.verificar_clave(text);
drop function if exists public.verificar_clave_interna(text);
select modo_transicion from public.config where id;   -- debe mostrar false
