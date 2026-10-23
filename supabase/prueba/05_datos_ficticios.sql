-- =====================================================================================================
-- 05 · DATOS FICTICIOS MÍNIMOS (opcional) — todos llevan la marca TEST y correos @example.invalid
-- =====================================================================================================
-- Dónde: SQL Editor del proyecto de PRUEBAS.  Cuándo: después de instalar (01–04). Sirve para comprobar que el panel y las
-- exportaciones funcionan con matrículas anteriores a la matrícula múltiple (sin solicitud) y con un código de pre-matrícula.
-- Se puede ejecutar más de una vez: no duplica. Se retira con 09_limpiar_datos_ficticios.sql.
-- No usa RUT, teléfonos ni correos reales.
-- =====================================================================================================
do $$
begin
  if exists (select 1 from public.matriculas where coalesce(datos->'estudiante'->>'nombre', '') !~* 'TEST') then
    raise exception 'DETENTE: hay matrículas que no son de prueba. No se inserta nada.';
  end if;
end $$;

-- Dos matrículas «antiguas» (sin solicitud), con folios altos para no chocar con los de las pruebas
insert into public.matriculas (folio, fecha_registro, tipo, datos) values
 (9001, '01-01-2027, 10:00:00', 'antiguo', '{"tipo":"antiguo","folio":"9001","fechaRegistro":"01-01-2027, 10:00:00",
   "estudiante":{"nombre":"Alumno TEST Anterior Uno","rut":"11.111.111-1","fnac":"2011-04-02","direccion":"Calle Ficticia 1","comuna":"Comuna TEST","nacionalidad":"Chilena","celular":"+56 9 0000 0000","correo":"","procedencia":"","cursoMatricula":"1° Medio A","repitencia":"no","pie":"no","salud":"no"},
   "apoderado":{"nombre":"Apoderado TEST Anterior","rut":"12.345.678-5","edad":"40","direccion":"Calle Ficticia 1","comuna":"Comuna TEST","nacionalidad":"Chilena","celular":"+56 9 0000 0001","correo":"apoderado.anterior@example.invalid","parentesco":"Madre","viveConEstudiante":"si"},
   "suplente":null}'::jsonb),
 (9002, '01-01-2027, 10:05:00', 'nuevo', '{"tipo":"nuevo","folio":"9002","fechaRegistro":"01-01-2027, 10:05:00",
   "estudiante":{"nombre":"Alumno TEST Anterior Dos","rut":"22.222.222-2","fnac":"2012-08-09","direccion":"Calle Ficticia 2","comuna":"Comuna TEST","nacionalidad":"Chilena","celular":"+56 9 0000 0002","correo":"","procedencia":"Colegio TEST","cursoMatricula":"","repitencia":"no","pie":"no","salud":"no"},
   "apoderado":{"nombre":"Apoderado TEST Anterior Dos","rut":"13.131.313-6","edad":"41","direccion":"Calle Ficticia 2","comuna":"Comuna TEST","nacionalidad":"Chilena","celular":"+56 9 0000 0003","correo":"apoderado.anterior2@example.invalid","parentesco":"Padre","viveConEstudiante":"si"},
   "suplente":null}'::jsonb)
on conflict (folio) do nothing;

-- Una pre-matrícula de 1 estudiante (formato anterior) con el código fijo TST234
insert into public.prematriculas (codigo, creada, datos, ip) values
 ('TST234', '01-01-2027, 09:00:00', '{"tipo":"nuevo",
   "estudiante":{"nombre":"Pre TEST Ficticia","rut":"14.141.414-3","fnac":"2012-01-01","direccion":"Calle Ficticia 3","comuna":"Comuna TEST","nacionalidad":"Chilena","celular":"+56 9 0000 0004","correo":"","procedencia":"Colegio TEST","cursoMatricula":"","repitencia":"no","pie":"no","salud":"no"},
   "apoderado":{"nombre":"Apoderado TEST Pre","rut":"15.151.515-0","edad":"42","direccion":"Calle Ficticia 3","comuna":"Comuna TEST","nacionalidad":"Chilena","celular":"+56 9 0000 0005","correo":"","parentesco":"Madre","viveConEstudiante":"si"},
   "suplente":null}'::jsonb, 'datos-ficticios')
on conflict (codigo) do nothing;

select 'Matrículas ficticias' as dato, count(*) as cantidad from public.matriculas where datos->'estudiante'->>'nombre' ~* 'TEST'
union all select 'Pre-matrículas ficticias', count(*) from public.prematriculas where datos->'estudiante'->>'nombre' ~* 'TEST';
