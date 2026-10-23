-- =====================================================================================================
-- 06 · DIAGNÓSTICO: tablas, columnas, funciones, permisos y RLS (solo lee; no cambia nada)
-- =====================================================================================================
-- Dónde: SQL Editor del proyecto de PRUEBAS.  Cuándo: después de instalar (01–04) y cada vez que cambies algo.
-- Resultado: una tabla con una fila por comprobación. Las que fallan salen PRIMERO: si la primera fila dice OK o INFO, no hay problemas.
-- Todas deben decir OK; «INFO» es solo información.
-- No muestra claves, hashes ni datos personales.
-- =====================================================================================================
with tablas(t) as (values ('matriculas'), ('prematriculas'), ('config'), ('sesiones'), ('intentos'), ('auditoria'), ('solicitudes')),
publicas(f) as (values ('iniciar_sesion'), ('cerrar_sesion'), ('validar_token'), ('obtener_folio'), ('guardar_matricula'), ('listar_matriculas'),
  ('actualizar_matricula'), ('eliminar_matricula'), ('ver_siguiente_folio'), ('establecer_siguiente_folio'), ('cambiar_folio_matricula'),
  ('listar_auditoria'), ('crear_prematricula'), ('cargar_prematricula'), ('eliminar_prematricula'),
  ('reservar_folios'), ('guardar_solicitud'), ('reservar_envio'), ('registrar_envio'))
select * from (
  -- 1. Tablas
  select 1 as orden, 'Tabla public.' || t as comprobacion,
         case when to_regclass('public.' || t) is not null then 'OK' else 'FALLA' end as estado, 'debe existir' as detalle from tablas
  union all
  -- 2. Columnas de la matrícula múltiple y de seguridad
  select 2, 'Columna ' || c, case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name || '.' || column_name = c) then 'OK' else 'FALLA' end, 'debe existir'
    from (values ('matriculas.solicitud_id'), ('matriculas.orden'), ('config.clave_interna_hash'), ('config.clave_script_hash'), ('config.modo_transicion'),
                 ('solicitudes.folios'), ('solicitudes.correo_estado'), ('prematriculas.ip')) v(c)
  union all
  -- 3. RLS activo
  select 3, 'RLS activo en ' || t, case when coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t)), false) then 'OK' else 'FALLA' end, 'debe estar activo' from tablas
  union all
  -- 4. Sin políticas: con RLS y sin políticas, anon y authenticated no pueden leer ni escribir nada
  select 4, 'Políticas RLS en public', case when (select count(*) from pg_policies where schemaname = 'public') = 0 then 'OK' else 'REVISAR' end,
         (select count(*) from pg_policies where schemaname = 'public')::text || ' política(s); lo esperado es 0 (todo el acceso es por funciones)'
  union all
  -- 5. Ningún permiso directo sobre las tablas para anon / authenticated
  select 5, 'Sin acceso directo de ' || r || ' a ' || t,
         case when has_table_privilege(r, 'public.' || t, 'select,insert,update,delete') or has_table_privilege(r, 'public.' || t, 'select')
                or has_table_privilege(r, 'public.' || t, 'insert') or has_table_privilege(r, 'public.' || t, 'update') or has_table_privilege(r, 'public.' || t, 'delete')
              then 'FALLA' else 'OK' end, 'no debe poder leer ni escribir directamente'
    from tablas cross join (values ('anon'), ('authenticated')) roles(r) where to_regclass('public.' || t) is not null
  union all
  -- 6. Funciones públicas esperadas: existen y anon puede ejecutarlas
  select 6, 'Función pública ' || f, case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f and has_function_privilege('anon', p.oid, 'execute')) then 'OK' else 'FALLA' end, 'debe existir y ser ejecutable por la página' from publicas
  union all
  -- 7. Ninguna otra función pública es ejecutable por anon (las internas, de limpieza y de envío interno quedan cerradas)
  select 7, 'Función NO esperada ejecutable por anon: ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'FALLA', 'debe estar cerrada a anon'
    from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select f from publicas) and p.proname not in ('verificar_clave', 'verificar_clave_interna')
  union all
  select 7, 'Funciones internas cerradas a anon', 'OK', 'ninguna función fuera de la lista pública es ejecutable por anon'
   where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select f from publicas) and p.proname not in ('verificar_clave', 'verificar_clave_interna'))
  union all
  -- 8. Transición cerrada: las funciones antiguas que aceptaban la clave directamente ya no existen
  select 8, 'Modo transición cerrado', case when coalesce((select not modo_transicion from public.config where id), false) then 'OK' else 'REVISAR' end,
         'ejecuta 04_cerrar_transicion.sql (supabase/cerrar_transicion.sql) si dice REVISAR'
  union all
  select 8, 'Funciones de verificación antiguas eliminadas', case when not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('verificar_clave', 'verificar_clave_interna')) then 'OK' else 'REVISAR' end,
         'verificar_clave y verificar_clave_interna no deben existir tras cerrar la transición'
  union all
  -- 9. Claves definidas (solo si están definidas, nunca su valor) y no son los textos de la plantilla
  select 9, 'Clave de encargados definida', case when exists (select 1 from public.config where id and clave_hash is not null) then 'OK' else 'FALLA' end, 'ejecuta 03_claves_prueba'
  union all
  select 9, 'Clave de funcionarios definida', case when exists (select 1 from public.config where id and clave_interna_hash is not null) then 'OK' else 'FALLA' end, 'ejecuta 03_claves_prueba'
  union all
  select 9, 'Secreto del script definido', case when exists (select 1 from public.config where id and clave_script_hash is not null) then 'OK' else 'FALLA' end, 'ejecuta 03_claves_prueba'
  union all
  select 9, 'Las claves no son los textos de la plantilla', case when exists (select 1 from public.config where id
         and (clave_hash = extensions.crypt('<<CLAVE_ENCARGADOS_PRUEBA>>', clave_hash) or clave_interna_hash = extensions.crypt('<<CLAVE_FUNCIONARIOS_PRUEBA>>', clave_interna_hash)
              or clave_script_hash = extensions.crypt('<<SECRETO_SCRIPT_PRUEBA>>', clave_script_hash))) then 'FALLA' else 'OK' end, 'reemplaza los textos entre << >> por claves propias'
  union all
  select 9, 'Las 3 claves son distintas entre sí', case when exists (select 1 from public.config where id and clave_hash is not null and clave_interna_hash is not null and clave_script_hash is not null
         and clave_hash <> clave_interna_hash and clave_hash <> clave_script_hash and clave_interna_hash <> clave_script_hash) then 'OK' else 'REVISAR' end, 'los hashes difieren (los textos deben ser distintos)'
  union all
  -- 10. Extensiones y objetos de apoyo
  select 10, 'Extensión pgcrypto', case when exists (select 1 from pg_extension where extname = 'pgcrypto') then 'OK' else 'FALLA' end, 'necesaria para guardar las claves como hash'
  union all
  select 10, 'Folio único por matrícula', case when exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'matriculas' and indexdef ilike '%unique%' and indexdef ilike '%(folio)%') then 'OK' else 'FALLA' end, 'impide folios repetidos'
  union all
  select 10, 'Orden único dentro de una solicitud', case when to_regclass('public.matriculas_solicitud_orden_uq') is not null then 'OK' else 'FALLA' end, 'impide duplicar al mismo estudiante en una solicitud'
  union all
  select 10, 'Máximo de estudiantes por solicitud', case when public._max_estudiantes() = 5 then 'OK' else 'REVISAR' end, 'valor actual: ' || public._max_estudiantes()::text || ' (la página usa 5)'
  union all
  select 10, 'pg_cron (limpieza diaria programada)', 'INFO', case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'pg_cron activo' else 'pg_cron no está activo: la limpieza diaria es opcional en pruebas' end
  union all
  -- 11. Datos (informativo)
  select 11, 'Matrículas registradas', 'INFO', (select count(*) from public.matriculas)::text
  union all select 11, 'Solicitudes registradas', 'INFO', (select count(*) from public.solicitudes)::text
  union all select 11, 'Próximo folio', 'INFO', (select case when is_called then last_value + 1 else last_value end from public.folio_2027_seq)::text
) r
order by case estado when 'FALLA' then 0 when 'REVISAR' then 1 when 'INFO' then 3 else 2 end, orden, comprobacion;   -- los problemas salen primero
