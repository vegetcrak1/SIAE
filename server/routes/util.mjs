import { HttpError } from '../http.mjs';

/** Ejecuta una operación y convierte la violación de UNIQUE de SQLite en un 409 legible. */
export async function unique(fn, message) {
  try { return await fn(); } catch (err) {
    if (/UNIQUE constraint/i.test(String(err?.message))) throw new HttpError(409, 'duplicate', message);
    throw err;
  }
}
