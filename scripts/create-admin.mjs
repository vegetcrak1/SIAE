// Crea (o restablece) un administrador con una contraseña temporal. Uso: npm run create-admin
// Usa la misma base de datos que la aplicación: archivo local o Turso (si TURSO_DATABASE_URL está definida).
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadEnvFile } from '../server/env.mjs';
import { loadConfig } from '../server/config.mjs';
import { openDb } from '../server/db.mjs';
import { hashPassword, randomPassword } from '../server/security.mjs';
import * as v from '../server/domain.mjs';

loadEnvFile();
let config;
try { config = loadConfig(); } catch (e) { console.error(`${e.message}\nEjecute primero: npm run init`); process.exit(1); }

const rl = createInterface({ input: stdin, terminal: false });
const lines = rl[Symbol.asyncIterator]();
// Lee una línea por pregunta; funciona tanto escribiendo como con entrada redirigida.
const ask = async (prompt) => { stdout.write(prompt); const { value } = await lines.next(); return value ?? ''; };
try {
  const name = v.text(await ask('Nombre completo del administrador: '), 'El nombre', { min: 3, max: 120 });
  const email = v.email(await ask('Correo del administrador: '));
  const db = await openDb(config);
  const temporary = randomPassword();
  const hash = await hashPassword(temporary, config.scryptCost);
  const existing = await db.get('SELECT id, role FROM users WHERE email = ?', email);
  if (existing) {
    const ok = (await ask('Ese correo ya existe. ¿Convertirlo en administrador y restablecer su contraseña? (s/n): ')).trim().toLowerCase();
    if (ok !== 's') { console.log('No se hizo ningún cambio.'); process.exit(0); }
    await db.run("UPDATE users SET role = 'admin', status = 'activo', name = ?, password_hash = ?, password_is_default = 1, failed_logins = 0, locked_until = 0 WHERE id = ?", name, hash, existing.id);
    await db.run('DELETE FROM sessions WHERE user_id = ?', existing.id);
  } else {
    await db.run("INSERT INTO users (role, name, email, status, password_hash, password_is_default, created_at) VALUES ('admin', ?, ?, 'activo', ?, 1, ?)", name, email, hash, Date.now());
  }
  await db.run('INSERT INTO audit_log (at, user_id, action, detail, ip) VALUES (?, NULL, ?, ?, ?)', Date.now(), 'admin.cli', email, 'consola');
  await db.close();
  console.log('\n==========================================');
  console.log(' Administrador listo');
  console.log(` Usuario (correo):      ${email}`);
  console.log(` Contraseña temporal:   ${temporary}`);
  console.log('==========================================');
  console.log('Anótela ahora: no se vuelve a mostrar. El sistema le pedirá cambiarla al primer ingreso.');
} catch (e) {
  console.error(`\nNo se pudo crear el administrador: ${e.message}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
