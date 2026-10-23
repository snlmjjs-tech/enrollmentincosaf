# Limpieza de los datos de prueba, retirada de credenciales y eliminación del proyecto

Todo esto es **solo en el proyecto de pruebas**. Nada toca producción.

## 1. Borrar los datos ficticios (Supabase de pruebas)

SQL Editor → pega `supabase/prueba/09_limpiar_datos_ficticios.sql` → Run.

* Borra las matrículas, pre-matrículas y solicitudes **TEST**, y limpia sesiones, intentos y auditoría.
* **Se detiene sin borrar nada** si encuentra una matrícula o pre-matrícula que **no** lleve la marca TEST (así no puede borrar datos reales si lo ejecutaras en el proyecto equivocado).
* No borra tablas, funciones ni claves.
* Verás al final tres números en `0`: `matriculas`, `prematriculas`, `solicitudes`.
* Opcional (si quieres que el próximo folio vuelva a ser 1): `select setval('public.folio_2027_seq', 1, false);`

Consultas manuales para comprobar (solo leen):

```sql
select count(*) from public.matriculas;      -- 0
select count(*) from public.solicitudes;     -- 0
select count(*) from public.prematriculas;   -- 0
select count(*) from public.sesiones;        -- 0
```

## 2. Desconectar y retirar las credenciales de prueba

| Dónde | Qué hacer |
|---|---|
| Supabase de pruebas | SQL Editor → `supabase/prueba/10_retirar_credenciales_de_prueba.sql`: reemplaza las 3 claves por valores aleatorios que nadie conoce y cierra todas las sesiones |
| Apps Script de pruebas | Configuración del proyecto → **Propiedades del script** → borra `SECRETO_SCRIPT`, `SUPABASE_KEY`, `SUPABASE_URL`, `DESTINATARIOS_PRUEBA`, `ESTADO_ENVIOS`, `ENVIADOS`. Luego **Implementar → Administrar implementaciones → Archivar** (la URL `/exec` deja de funcionar) y, si quieres, elimina el proyecto desde <https://script.google.com> |
| Tu computador | Borra la carpeta `.prueba-local/` (`rm -rf .prueba-local`). Cierra la pestaña de la página de pruebas (la sesión vive solo en esa pestaña) |
| Gestor de contraseñas | Elimina las 3 claves de prueba |
| Google | Si quieres, en <https://myaccount.google.com/permissions> revoca el acceso del script de pruebas a tu cuenta |
| GitHub | Nada que retirar: **ninguna clave se guardó en el repositorio** (`.prueba-local/` y los archivos `.env*` están en `.gitignore`) |

La clave **publishable** del proyecto de pruebas es pública por diseño; aun así, al eliminar el proyecto deja de tener efecto.

## 3. Eliminar el proyecto de Supabase de pruebas

Cuando ya no lo necesites: Supabase → tu proyecto de pruebas → **Project Settings** → **General** → **Delete project** (escribe el nombre para confirmar).
**Verifica dos veces el nombre y el ID**: debe ser el de pruebas, nunca el de producción (`mtlunre…`). Eliminarlo borra todo lo que contiene y no se puede deshacer.

## 4. Comprobación final

- [ ] `09_…` ejecutado: todo en 0.
- [ ] `10_…` ejecutado (o el proyecto eliminado).
- [ ] Apps Script de pruebas archivado/eliminado y sin propiedades.
- [ ] `.prueba-local/` borrada.
- [ ] Claves de prueba eliminadas de tu gestor.
- [ ] Producción intacta: la página publicada y su Supabase nunca se tocaron durante las pruebas.
