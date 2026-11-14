import { loadConfig } from './config.mjs';
import { loadEnvFile } from './env.mjs';
import { openDb } from './db.mjs';
import { createApp } from './app.mjs';

loadEnvFile();

let config;
try { config = loadConfig(); } catch (err) { console.error(`Configuración inválida: ${err.message}`); process.exit(1); }

const db = await openDb(config);
if (!(await db.get("SELECT 1 AS ok FROM users WHERE role = 'admin' AND status = 'activo' LIMIT 1"))) {
  console.warn('Aviso: todavía no hay un administrador. Cree el primero con: npm run create-admin');
}
if (!config.googleClientId) console.log('Ingreso con Google: desactivado (GOOGLE_CLIENT_ID vacío). Se ingresa con correo/documento y contraseña.');
if (!config.cookieSecure) console.log('Modo sin HTTPS (COOKIE_SECURE=0): válido en red local. La cámara del celular y Google exigen HTTPS.');
console.log(config.tursoUrl ? 'Base de datos: Turso (remota)' : `Base de datos: archivo local ${config.dbPath}`);

const app = createApp({ config, db });
app.server.listen(config.port, config.host, () => console.log(`SIAE funcionando en el puerto ${config.port}`));

const shutdown = async () => { await app.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
