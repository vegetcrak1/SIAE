// Punto de entrada para Vercel (función sin servidor). Todas las rutas /api/* llegan aquí (ver vercel.json).
// La configuración viene de las variables de entorno del proyecto en Vercel; los datos, de Turso (TURSO_DATABASE_URL).
import { loadConfig } from '../server/config.mjs';
import { openDb } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';

let ready; // se crea una vez por instancia en caliente y se reutiliza
const init = () => (ready ??= (async () => {
  const config = loadConfig();
  return createApp({ config, db: await openDb(config) });
})().catch((err) => { ready = undefined; throw err; }));

export default async function handler(req, res) {
  let app;
  try {
    app = await init();
  } catch (err) {
    // El detalle (por ejemplo, una variable faltante) queda en los registros de Vercel, no en la respuesta.
    console.error('[SIAE] No se pudo iniciar:', err.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ success: false, error: { code: 'config', message: 'El servidor no está configurado correctamente. Revise las variables de entorno en Vercel.' } }));
    return;
  }
  return app.handler(req, res);
}
