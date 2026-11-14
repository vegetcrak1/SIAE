// Cliente de laboratorio con la misma interfaz que @libsql/client (execute / batch / transaction),
// implementado sobre node:sqlite. Permite ejecutar TODA la batería de pruebas por la ruta de base remota.
// Imita las diferencias relevantes de libSQL: filas como arreglos, lastInsertRowid BigInt, BLOB como ArrayBuffer
// y SIN claves foráneas activas (la aplicación no debe depender de ON DELETE CASCADE).
import { DatabaseSync } from 'node:sqlite';

export function fakeLibsqlClient() {
  const sqlite = new DatabaseSync(':memory:');
  let busy = Promise.resolve();

  const blobToArrayBuffer = (v) => (v instanceof Uint8Array ? v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength) : v);
  const exec = ({ sql, args = [] }) => {
    const stmt = sqlite.prepare(sql);
    if (/^\s*(select|with|pragma)/i.test(sql)) {
      const objs = stmt.all(...args);
      const columns = objs.length ? Object.keys(objs[0]) : [];
      const rows = objs.map((o) => columns.map((c) => blobToArrayBuffer(o[c])));
      return { columns, rows, rowsAffected: 0, lastInsertRowid: undefined };
    }
    const r = stmt.run(...args);
    return { columns: [], rows: [], rowsAffected: Number(r.changes), lastInsertRowid: BigInt(r.lastInsertRowid) };
  };
  const serial = (fn) => { const job = busy.then(fn); busy = job.catch(() => {}); return job; };

  return {
    execute: (stmt) => serial(async () => exec(stmt)),
    batch: (stmts) => serial(async () => {
      sqlite.exec('BEGIN');
      try { const out = stmts.map(exec); sqlite.exec('COMMIT'); return out; } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    }),
    transaction: async () => {
      let release;
      const gate = new Promise((r) => { release = r; });
      await serial(async () => { sqlite.exec('BEGIN IMMEDIATE'); });
      busy = gate; // mientras la transacción esté abierta, las demás consultas esperan
      return {
        execute: async (stmt) => exec(stmt),
        commit: async () => { sqlite.exec('COMMIT'); release(); },
        rollback: async () => { try { sqlite.exec('ROLLBACK'); } catch { /* ya cerrada */ } release(); },
        close() {},
      };
    },
    close() { sqlite.close(); },
  };
}
