import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../server/config.mjs';
import { initDb, RemoteDb, openDb } from '../server/db.mjs';
import { createApp } from '../server/app.mjs';
import { createGoogleVerifier } from '../server/google.mjs';
import { securityHeaders } from '../server/http.mjs';
import { Client, CLIENT_ID, idToken, publicJwk } from './helpers.mjs';
import { fakeLibsqlClient } from './fake-libsql.mjs';

const SECRET = randomBytes(32).toString('hex');
const baseEnv = { APP_SECRET: SECRET, GOOGLE_CLIENT_ID: CLIENT_ID, ADMIN_EMAILS: 'rectora@colegio.edu', NODE_ENV: 'test', SCRYPT_COST: '10', LOGIN_RATE_LIMIT: '5' };
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}`)));

describe('varias instancias sin estado compartido (como en Vercel)', () => {
  test('nonce, sesión y límite de intentos viven en la base de datos, no en la memoria de cada instancia', async () => {
    const config = loadConfig({ ...baseEnv, DB_PATH: ':memory:' });
    const db = await initDb(new RemoteDb(fakeLibsqlClient()));
    const verifyGoogle = createGoogleVerifier({ clientId: CLIENT_ID, fetchKeys: async () => ({ keys: [publicJwk], ttlMs: 3_600_000 }) });
    const a = createApp({ config, db, verifyGoogle });
    const b = createApp({ config, db, verifyGoogle }); // otra "instancia" con memoria propia
    const [baseA, baseB] = [await listen(a.server), await listen(b.server)];
    const ca = new Client(baseA), cb = new Client(baseB);

    // El nonce lo emite A y lo consume B; reutilizarlo en cualquiera falla.
    const { data: { nonce } } = await ca.get('/api/auth/nonce');
    const credential = idToken({ nonce, sub: 'g-admin', email: 'rectora@colegio.edu', name: 'Rectora' });
    const first = await cb.post('/api/auth/google', { credential, nonce });
    assert.equal(first.status, 200);
    assert.equal((await ca.post('/api/auth/google', { credential, nonce })).status, 400, 'repetición rechazada en otra instancia');

    // La sesión creada en B vale en A (mismo token, registro en la base de datos).
    ca.cookie = cb.cookie;
    assert.equal((await ca.get('/api/session')).data.user.role, 'admin');
    await cb.post('/api/auth/logout');
    assert.equal((await ca.get('/api/session')).data.user, null, 'cerrar sesión en B la revoca en A');

    // Límite por IP compartido: 3 intentos por A + 2 por B agotan el cupo de 5; el siguiente (en A) recibe 429.
    const anon = (base) => new Client(base);
    for (let i = 0; i < 3; i++) await anon(baseA).post('/api/auth/login', { usuario: '99999999', password: 'x' });
    for (let i = 0; i < 2; i++) await anon(baseB).post('/api/auth/login', { usuario: '99999999', password: 'x' });
    assert.equal((await anon(baseA).post('/api/auth/login', { usuario: '99999999', password: 'x' })).status, 429);
    await a.close(); await b.close().catch(() => {});
  });
});

describe('punto de entrada de Vercel (api/index.mjs)', () => {
  test('atiende las rutas /api con la configuración de las variables de entorno', async () => {
    Object.assign(process.env, baseEnv, { DB_PATH: ':memory:', INSTITUTION_NAME: 'Colegio Vercel' });
    const { default: handler } = await import('../api/index.mjs?ok');
    const server = createServer(handler);
    const base = await listen(server);
    const r = await new Client(base).get('/api/config');
    assert.equal(r.status, 200);
    assert.equal(r.data.institution, 'Colegio Vercel');
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal((await new Client(base).get('/api/admin/students')).status, 401);
    server.close();
  });

  test('si falta configuración responde 500 genérico y no revela el detalle', async () => {
    const saved = process.env.APP_SECRET;
    delete process.env.APP_SECRET;
    const { default: handler } = await import('../api/index.mjs?missing');
    const server = createServer(handler);
    const base = await listen(server);
    const r = await new Client(base).get('/api/config');
    assert.equal(r.status, 500);
    assert.equal(r.data.error.code, 'config');
    assert.ok(!JSON.stringify(r.data).includes('APP_SECRET'));
    server.close();
    process.env.APP_SECRET = saved;
  });

  test('en Vercel (VERCEL=1) las cookies son Secure y se confía en el proxy por defecto', () => {
    const c = loadConfig({ ...baseEnv, VERCEL: '1' });
    assert.equal(c.cookieSecure, true);
    assert.equal(c.trustProxy, true);
    assert.equal(c.serverless, true);
  });
});

describe('vercel.json', () => {
  const cfg = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

  test('enruta /api a la función, el resto a la aplicación y compila a dist', () => {
    assert.equal(cfg.outputDirectory, 'dist');
    assert.equal(cfg.buildCommand, 'npm run build');
    assert.ok(cfg.installCommand.includes('--include=dev'), 'las herramientas de compilación se instalan siempre');
    assert.deepEqual(cfg.rewrites[0], { source: '/api/(.*)', destination: '/api/index' });
    assert.equal(cfg.rewrites[1].destination, '/index.html');
    assert.ok(new RegExp(`^${cfg.rewrites[1].source}$`).test('/dashboard/estudiante'));
    assert.ok(!new RegExp(`^${cfg.rewrites[1].source}$`).test('/api/session'));
  });

  test('las cabeceras de seguridad de los archivos estáticos coinciden con las del servidor', () => {
    const expected = securityHeaders({ cookieSecure: true });
    const declared = Object.fromEntries(cfg.headers[0].headers.map((h) => [h.key, h.value]));
    assert.deepEqual(declared, expected);
  });

  test('el archivo de la función existe y la base elegida es Turso cuando hay URL', async () => {
    assert.ok(readFileSync(new URL('../api/index.mjs', import.meta.url), 'utf8').includes('export default'));
    await assert.rejects(() => openDb(loadConfig({ ...baseEnv, TURSO_DATABASE_URL: 'libsql://x.turso.io', TURSO_AUTH_TOKEN: 't' })), /@libsql\/client|fetch|ENOTFOUND|network|failed/i);
  });
});
