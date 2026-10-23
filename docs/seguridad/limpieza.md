# Eliminación automática de pre-matrículas antiguas

## Cómo era
`crear_prematricula` hacía `delete from prematriculas where created_at < now() - 30 días` **cada vez que llegaba una nueva solicitud**.
Si nadie enviaba pre-matrículas, los datos personales de familias que nunca se matricularon quedaban guardados indefinidamente.

## Qué tablas intervienen
| Tabla | Qué contiene | ¿La limpieza la toca? |
|---|---|---|
| `public.prematriculas` (`codigo`, `datos`, `created_at`, `ip`) | Pre-matrículas **pendientes** enviadas por apoderados. Se borran solas al finalizar la matrícula en el mesón (`eliminar_prematricula`) | **Sí**, las de más de N días |
| `public.matriculas` | Matrículas **definitivas** | **Nunca** |
| `public.sesiones` | Tokens de sesión | Solo los vencidos |
| `public.intentos` | Fallos de clave/código | Solo los de más de 2 días |
| `public.config`, `public.auditoria` | Claves (hash) y registro de acciones | Nunca |

## Cómo funciona ahora
`public.limpiar_vencidos(dias)` (en `schema.sql`) borra únicamente lo de la tabla anterior. Garantías:
- El código de la función **no contiene** ninguna instrucción sobre `matriculas` (la prueba lo comprueba), y las pruebas confirman que matrículas de más de 2 años siguen intactas.
- Rechaza períodos menores a **7 días** (protección contra un error de tecleo que borre todo).
- No es ejecutable desde el navegador (solo por la tarea programada o por un administrador de la base).
- Deja una fila en `auditoria` (`limpieza_automatica`) con cuántos registros borró.
- Se mantiene el borrado oportunista dentro de `crear_prematricula` como respaldo, por si la tarea programada dejara de funcionar.

## Programarla (a mano, no se ejecuta desde la rama)
Archivo: `supabase/programar_limpieza.sql`.
1. Supabase → **Database → Extensions** → busca `pg_cron` → actívala.
2. **SQL Editor** → ejecuta el bloque *PROGRAMAR* (todos los días 06:15 UTC = 02:15–03:15 hora de Chile).
3. **Cómo comprobar que se ejecuta:**
   - `select jobname, schedule, active from cron.job;` → debe aparecer `limpiar-vencidos-diario` con `active = true`.
   - Al día siguiente: `select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;` → `status = succeeded`.
   - `select momento, detalle from public.auditoria where accion = 'limpieza_automatica' order by id desc limit 5;` → cuántas pre-matrículas borró.
   - Prueba inmediata (borra de verdad las de más de 30 días): `select public.limpiar_vencidos(30);`

## Período de conservación (30 días)
Se mantuvo en **30 días** (el que ya existía). **No lo cambié.** Antes de modificarlo conviene revisar con la dirección del colegio y, si corresponde, asesoría jurídica:
- **Más corto** (p. ej. 7–15 días): menos datos personales almacenados, pero una familia que envía la pre-matrícula y viene al mesón semanas después tendría que repetirla.
- **Más largo:** más comodidad, pero se conservan más tiempo datos de menores que no llegaron a matricularse.
- La normativa chilena de protección de datos personales (Ley 19.628 y su modernización) exige conservar datos solo el tiempo necesario para la finalidad. Esto es una orientación, no asesoría legal.
- Para cambiarlo: volver a ejecutar `cron.schedule` con el mismo nombre y el nuevo número de días.
