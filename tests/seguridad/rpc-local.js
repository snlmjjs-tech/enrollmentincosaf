// Ejecuta una función de la base igual que lo hace PostgREST (la API de Supabase):
//  · una transacción por solicitud, con el rol «anon» y las cabeceras de la solicitud disponibles,
//  · COMMIT si la función termina bien, ROLLBACK si lanza un error.
// Se usa en las pruebas de SQL y en el servidor local que reemplaza a Supabase en las pruebas del navegador.
const { Pool } = require('pg');

function crearRpc(opciones) {
  const pool = new Pool(opciones);
  const cache = new Map();
  async function firma(nombre) {
    if (cache.has(nombre)) return cache.get(nombre);
    const r = await pool.query(
      `select p.proargnames as nombres,
              array(select format_type(t, null) from unnest(string_to_array(p.proargtypes::text, ' ')::oid[]) t) as tipos,
              p.proretset as conjunto, format_type(p.prorettype, null) as retorno
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [nombre]);
    cache.set(nombre, r.rows);
    return r.rows;
  }
  async function rpc(nombre, args = {}, { ip = '203.0.113.10', rol = 'anon' } = {}) {
    cache.delete(nombre);
    const sobrecargas = await firma(nombre);
    const claves = Object.keys(args).sort().join(',');
    const f = sobrecargas.find(s => (s.nombres || []).slice().sort().join(',') === claves);
    if (!f) throw Object.assign(new Error(`función no encontrada: ${nombre}(${claves})`), { codigo: 'PGRST202' });
    const params = f.nombres.map((n, i) => `${n} => $${i + 1}::${f.tipos[i]}`).join(', ');
    const valores = f.nombres.map(n => (args[n] !== null && typeof args[n] === 'object') ? JSON.stringify(args[n]) : args[n]);
    const cliente = await pool.connect();
    try {
      await cliente.query('begin');
      await cliente.query(`set local role ${rol}`);
      await cliente.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'cf-connecting-ip': ip })]);
      const q = f.conjunto ? `select * from public.${nombre}(${params})` : `select public.${nombre}(${params}) as r`;
      const res = await cliente.query(q, valores);
      await cliente.query('commit');
      if (f.conjunto) return res.rows.map(r => r[nombre]);
      return res.rows[0].r === undefined ? null : res.rows[0].r;
    } catch (e) {
      await cliente.query('rollback').catch(() => {});
      throw e;
    } finally { cliente.release(); }
  }
  // Consulta directa como administrador de la base (solo para preparar y comprobar datos en las pruebas)
  const admin = (sql, p) => pool.query(sql, p);
  // Consulta directa con el rol anon (para comprobar que NO puede leer tablas)
  async function comoAnon(sql) {
    const c = await pool.connect();
    try { await c.query('begin'); await c.query('set local role anon'); const r = await c.query(sql); await c.query('rollback'); return r; }
    catch (e) { await c.query('rollback').catch(() => {}); throw e; } finally { c.release(); }
  }
  return { rpc, admin, comoAnon, cerrar: () => pool.end() };
}
module.exports = { crearRpc };
