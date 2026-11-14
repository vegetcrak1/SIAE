import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import { loadConfig } from '../server/config.mjs';
import { openDb, initDb, RemoteDb } from '../server/db.mjs';
import { fakeLibsqlClient } from './fake-libsql.mjs';
import { createApp } from '../server/app.mjs';
import { createGoogleVerifier } from '../server/google.mjs';

export const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
export const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };

/** Emite un ID token como lo haría Google; `overrides` permite fabricar tokens inválidos. */
export function idToken(claims, { key = privateKey, kid = 'test-key' } = {}) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT_ID, iat: now, exp: now + 3600, email_verified: true, ...claims });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${sig}`;
}
export const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

export class Client {
  constructor(base) { this.base = base; this.cookie = ''; }
  async request(method, path, body, { headers = {}, csrf = true, raw } = {}) {
    const h = { ...headers };
    if (csrf) { h.Origin = this.base; h['X-Requested-With'] = 'siae'; }
    if (this.cookie) h.Cookie = this.cookie;
    let payload;
    if (raw) payload = raw; else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + path, { method, headers: h, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  }
  get(path, opts) { return this.request('GET', path, undefined, opts); }
  post(path, body, opts) { return this.request('POST', path, body ?? {}, opts); }
  put(path, body, opts) { return this.request('PUT', path, body, opts); }
  del(path, opts) { return this.request('DELETE', path, undefined, opts); }
}

export async function startApp(extra = {}) {
  const config = loadConfig({
    APP_SECRET: randomBytes(32).toString('hex'), GOOGLE_CLIENT_ID: CLIENT_ID, ADMIN_EMAILS: 'rectora@colegio.edu',
    NODE_ENV: 'test', DB_PATH: ':memory:', SCRYPT_COST: '10', LOGIN_RATE_LIMIT: '1000', SCHOOL_TZ: 'America/Bogota', ...extra,
  });
  // TEST_DB=remote ejecuta las pruebas por el adaptador de base remota (Turso) con un cliente de laboratorio.
  const db = process.env.TEST_DB === 'remote' ? await initDb(new RemoteDb(fakeLibsqlClient())) : await openDb(config);
  const verifyGoogle = createGoogleVerifier({ clientId: CLIENT_ID, fetchKeys: async () => ({ keys: [publicJwk], ttlMs: 3_600_000 }) });
  const app = createApp({ config, db, verifyGoogle, staticDir: new URL('../dist', import.meta.url).pathname });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const client = () => new Client(base);

  const googleLogin = async (c, claims) => {
    const { data: { nonce } } = await c.get('/api/auth/nonce');
    return c.post('/api/auth/google', { credential: idToken({ nonce, ...claims }), nonce });
  };
  const adminClient = async () => {
    const c = client();
    const r = await googleLogin(c, { sub: 'g-admin', email: 'rectora@colegio.edu', name: 'Rectora' });
    if (r.status !== 200) throw new Error(`admin login failed ${JSON.stringify(r.data)}`);
    return c;
  };
  return { app, db, base, config, client, googleLogin, adminClient, close: () => app.close() };
}
