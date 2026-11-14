// Primitivas criptográficas: contraseñas (scrypt), tokens firmados y comparación en tiempo constante.
import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEYLEN = 32;

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Formato: scrypt$N$r$p$sal$hash (los parámetros viajan con el hash para poder subirlos en el futuro). */
export async function hashPassword(password, costLog2 = 15) {
  const N = 2 ** costLog2, r = 8, p = 1;
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEYLEN, { N, r, p, maxmem: 256 * N * r });
  return ['scrypt', N, r, p, b64u(salt), b64u(hash)].join('$');
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !hash) return false;
  const params = { N: Number(N), r: Number(r), p: Number(p) };
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, { ...params, maxmem: 256 * params.N * params.r });
  return timingSafeEqual(actual, expected);
}

// Contraseña temporal legible: sin caracteres ambiguos (0/O, 1/l/I). randomInt evita el sesgo del módulo.
const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export const randomPassword = (length = 10) => Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');

/** Subclaves independientes derivadas de APP_SECRET (una por propósito). */
export const deriveKey = (secret, purpose) => createHmac('sha256', secret).update(`siae:${purpose}`).digest();

// ---------- JWT (HS256) ----------
// Solo se acepta HS256: se descarta "alg: none" y la confusión de algoritmos.
export function signJwt(key, claims, { ttlSeconds, issuer, audience, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: issuer, aud: audience, iat, exp: iat + ttlSeconds, ...claims }));
  return `${head}.${body}.${b64u(createHmac('sha256', key).update(`${head}.${body}`).digest())}`;
}

export function verifyJwt(key, token, { issuer, audience, now = Date.now(), ignoreExpiry = false }) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const expected = b64u(createHmac('sha256', key).update(`${parts[0]}.${parts[1]}`).digest());
    if (!safeEqual(parts[2], expected)) return null;
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const nowSec = Math.floor(now / 1000);
    if (claims.iss !== issuer || claims.aud !== audience) return null;
    if (typeof claims.sub !== 'string' || typeof claims.jti !== 'string') return null;
    if (!ignoreExpiry && !(claims.exp > nowSec)) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Token firmado: base64url(payload JSON).firma — con caducidad. */
export function signToken(key, payload, ttlSeconds, now = Date.now()) {
  const body = b64u(JSON.stringify({ ...payload, exp: Math.floor(now / 1000) + ttlSeconds }));
  return `${body}.${b64u(createHmac('sha256', key).update(body).digest())}`;
}

export function verifyToken(key, token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = b64u(createHmac('sha256', key).update(body).digest());
  if (!safeEqual(mac, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

// ---------- QR rotativo del carnet digital ----------
// Formato: SIAE1.<idEstudiante>.<emitido en segundos>.<mac>. Solo la sesión autenticada del estudiante puede emitirlo.
export const QR_PREFIX = 'SIAE1';
export const QR_VALID_BEFORE_SECONDS = 30;
export const QR_VALID_AFTER_SECONDS = 150;

export function issueQrToken(key, studentId, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const base = `${QR_PREFIX}.${studentId}.${iat}`;
  return { token: `${base}.${b64u(createHmac('sha256', key).update(base).digest()).slice(0, 22)}`, expiresAt: (iat + QR_VALID_AFTER_SECONDS) * 1000 };
}

/** Devuelve el id del estudiante si la firma es válida y `atMs` cae dentro de la ventana de vigencia. */
export function verifyQrToken(key, token, atMs) {
  const m = /^SIAE1\.(\d{1,9})\.(\d{9,11})\.([A-Za-z0-9_-]{22})$/.exec(typeof token === 'string' ? token.trim() : '');
  if (!m) return null;
  const base = `${QR_PREFIX}.${m[1]}.${m[2]}`;
  if (!safeEqual(m[3], b64u(createHmac('sha256', key).update(base).digest()).slice(0, 22))) return null;
  const iat = Number(m[2]);
  const at = atMs / 1000;
  return at >= iat - QR_VALID_BEFORE_SECONDS && at <= iat + QR_VALID_AFTER_SECONDS ? Number(m[1]) : null;
}
