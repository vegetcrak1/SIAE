// Copia de seguridad consistente de la base de datos local (segura aunque el sistema esté en uso). Uso: npm run backup
// Con Turso (Vercel) las copias las gestiona el servicio: ver la guía de despliegue.
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadEnvFile } from '../server/env.mjs';

loadEnvFile();
if (process.env.TURSO_DATABASE_URL) {
  console.log('Está usando Turso: la copia se hace allí. Ejemplo con la herramienta de Turso:\n  turso db shell NOMBRE_DE_LA_BASE .dump > copia.sql\nVea la sección "Copias de seguridad" de la guía de Vercel.');
  process.exit(0);
}
const source = process.env.DB_PATH || './data/siae.db';
mkdirSync('backups', { recursive: true });
const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
const target = `backups/siae-${stamp}.db`;
const db = new DatabaseSync(source);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();
console.log(`Copia de seguridad creada: ${target}`);
