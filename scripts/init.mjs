// Prepara el archivo .env con un secreto aleatorio. Se ejecuta una sola vez: npm run init
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('Ya existe el archivo .env; no se modificó nada.');
  process.exit(0);
}
copyFileSync('.env.example', '.env');
const secret = randomBytes(48).toString('base64url');
writeFileSync('.env', readFileSync('.env', 'utf8').replace(/^APP_SECRET=.*$/m, `APP_SECRET=${secret}`));
console.log('Listo: se creó el archivo .env con una clave secreta aleatoria. No la comparta con nadie.');
