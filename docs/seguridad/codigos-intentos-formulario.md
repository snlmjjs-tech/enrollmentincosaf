# Límite de intentos, códigos de pre-matrícula y formulario público

Todo está en `supabase/schema.sql` (no se ejecuta en producción hasta que tú lo hagas) y se probó en un Postgres local (`tests/seguridad/prueba-sql.js`).

## Cómo funcionaba antes
- Las claves se comprobaban en cada solicitud y se podían probar sin límite.
- El código de pre-matrícula eran 4 dígitos (9.000 combinaciones). Quien tuviera la clave de funcionarios podía consultarlos todos.
- El formulario público aceptaba cualquier contenido, de cualquier tamaño y a cualquier ritmo.

## Cómo funciona ahora

### Sesiones (en vez de enviar la clave cada vez)
`iniciar_sesion(clave, rol)` comprueba la clave y devuelve un **token aleatorio de 256 bits**. En la base solo se guarda su hash.
Las demás funciones exigen el token: no se puede adivinar probando, vence solo y se invalida con «Cerrar acceso».
Los funcionarios reciben un token de rol *interna* (12 h); el panel exige uno de rol *admin* (3 h) que solo da la clave de encargados.

### Límite de intentos de clave
| Qué | Límite | Qué pasa |
|---|---|---|
| Claves incorrectas desde una misma dirección | 10 en 15 minutos | `iniciar_sesion` responde «bloqueado» aunque la clave sea correcta |
| Claves incorrectas desde todas las direcciones | 300 en 15 minutos | Tope de respaldo ante ataques distribuidos |
| Códigos de pre-matrícula inexistentes | 15 en 10 minutos por dirección (200 en total) | Las consultas se bloquean un rato |

- Los fallos se guardan en la tabla `intentos` (se limpia sola). Un acierto no se bloquea por intentos de otras direcciones: el colegio entero no queda fuera por culpa de un atacante.
- **Importante:** los fallos solo se pueden contar si la función *termina normalmente* (si lanzara un error, Postgres desharía el registro). Por eso la verificación de claves está hecha para devolver un resultado y no un error.
- La dirección se toma de la cabecera `cf-connecting-ip` (la fija Cloudflare, que protege la API de Supabase). **No pude comprobar en tu proyecto real que esa cabecera llegue**; si no llegara, el sistema usa la última dirección de `x-forwarded-for` y, como último recurso, un identificador único (el límite entonces sería global, no por dirección). Ver «Cómo verificar» abajo.

### Códigos de pre-matrícula
- **Nuevos:** 6 caracteres de un alfabeto sin `0`, `1`, `I` ni `O` (~1.000 millones de combinaciones), p. ej. `K7M-4P9`.
  Se aceptan en mayúsculas o minúsculas, con o sin guion o espacio.
- **Existentes:** los de 4 dígitos ya emitidos **siguen siendo válidos** hasta que venzan (30 días). Nada se invalida.
- **Mientras dure el «modo de transición»** (ver `publicacion.md`) los códigos nuevos siguen siendo de 4 dígitos, para que la página antigua pueda leerlos.
- Solo el personal con sesión puede consultar códigos, y las consultas de códigos inexistentes tienen el límite de arriba.

### Formulario público (`crear_prematricula`)
Es la única función abierta, así que valida todo en el servidor:
- Solo campos conocidos; todos deben ser texto; largo máximo por campo (200, o 300/1000 según el campo); tamaño total ≤ 30 KB.
- Rechaza `<`, `>` y caracteres de control: un nombre, dirección u observación no necesita código HTML.
- Comprueba el RUT (dígito verificador), formato de correo, fecha, edad (18–120) y las opciones fijas (sí/no, parentesco, lugar de trabajo).
- **Frecuencia:** máximo 8 pre-matrículas por hora desde una dirección, 400 por hora en total y 5.000 pendientes.
- **Campo trampa** (`_hp`): invisible para las personas; si un robot lo llena, la solicitud se rechaza.
- Los mensajes de error son claros para el apoderado («el campo nombre contiene caracteres no permitidos») y no revelan detalles internos.
- El mismo control de datos protege el registro del personal (`guardar_matricula`, `actualizar_matricula`).

### Qué NO resuelve
- Un robot con muchas direcciones distintas puede superar el límite por dirección; el tope general limita el daño, pero no lo evita del todo. Si llegara a ocurrir, el siguiente paso es un CAPTCHA (por ejemplo Cloudflare Turnstile), que requiere una cuenta externa y no se incluye.
- No hay cuentas individuales: los funcionarios comparten una clave. Con cuentas individuales (Supabase Auth con correo institucional) se sabría quién hizo qué y se podría revocar a una persona. Es el siguiente paso recomendado; la tabla `auditoria` ya registra rol y dirección.

## Cómo verificar (con datos ficticios, sin afectar producción)
1. **Límite de intentos:** ejecuta `PGPORT=… node tests/seguridad/prueba-sql.js` (secciones 4 y 7).
2. **Que la dirección llegue en tu proyecto:** en el SQL Editor, `select public._ip();` mostrará `sin-ip` (no hay cabeceras en el editor). Para verlo de verdad, después de publicar,
   haz 2 intentos de clave incorrectos desde la página y ejecuta `select ip, count(*) from public.intentos group by ip;`: debe aparecer **tu dirección pública**, no `sin-ip`.
   Si aparece `sin-ip`, avísame y se ajusta la lectura de la cabecera.
