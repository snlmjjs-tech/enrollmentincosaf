-- =====================================================================================================
-- 00 · COMPROBAR QUE ESTÁS EN EL PROYECTO DE PRUEBAS (solo lee; no cambia nada)
-- =====================================================================================================
-- Dónde: SQL Editor de TU proyecto de Supabase DE PRUEBAS.  Cuándo: SIEMPRE antes de ejecutar cualquier otro archivo.
-- Qué hace: muestra qué hay en el proyecto. Si ves matrículas que NO son de prueba, DETENTE: puede ser el proyecto real.
-- Además, compara la dirección que ves en tu navegador (barra de direcciones: supabase.com/dashboard/project/<ID>)
-- con el ID del proyecto REAL de producción, que empieza con «mtlunre…». El de pruebas NO debe parecerse a ese.
-- =====================================================================================================
select current_database() as base_de_datos, current_user as usuario,
       (select count(*) from information_schema.tables where table_schema = 'public') as tablas_en_public;

-- Si la tabla existe, muestra si hay matrículas que NO llevan la marca TEST (debe dar 0 en un proyecto de pruebas):
do $$
declare n integer;
begin
  if to_regclass('public.matriculas') is not null then
    select count(*) into n from public.matriculas where coalesce(datos->'estudiante'->>'nombre', '') !~* 'TEST';
    raise notice 'Matrículas SIN la marca TEST: %  (en un proyecto de pruebas debe ser 0)', n;
    if n > 0 then
      raise exception 'DETENTE: este proyecto tiene % matrícula(s) que no son de prueba. Puede ser el proyecto REAL. No ejecutes nada más aquí.', n;
    end if;
  else
    raise notice 'El proyecto está vacío (no tiene la tabla matriculas): es lo esperado antes de instalar.';
  end if;
end $$;
