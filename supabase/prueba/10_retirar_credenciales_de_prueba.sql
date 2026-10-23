-- =====================================================================================================
-- 10 · RETIRAR LAS CREDENCIALES DE PRUEBA (SOLO en el proyecto de PRUEBAS)
-- =====================================================================================================
-- Dónde: SQL Editor del proyecto de PRUEBAS.  Cuándo: cuando termines de probar (después de 09).
-- Qué hace: invalida las 3 claves de prueba y cierra todas las sesiones. Con esto, las claves que usaste dejan de servir.
-- Después (fuera de SQL): borra las propiedades del Apps Script de pruebas y, si ya no lo necesitas, elimina el proyecto
-- de Supabase de pruebas (ver docs/multiple/LIMPIEZA_Y_RETIRADA.md).
-- =====================================================================================================
update public.config
   set clave_hash = extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
       clave_interna_hash = extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf')),
       clave_script_hash = extensions.crypt(encode(extensions.gen_random_bytes(24), 'hex'), extensions.gen_salt('bf'))
 where id;
delete from public.sesiones;
select 'Claves de prueba invalidadas' as resultado, (select count(*) from public.sesiones) as sesiones_abiertas;
