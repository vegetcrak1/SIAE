// Verificación del ID token de Google Identity Services (RS256) con las claves públicas de Google.
import { createPublicKey, verify } from 'node:crypto';
import { HttpError } from './http.mjs';

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const CLOCK_SKEW_SECONDS = 60;

async function fetchGoogleKeys() {
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
  const { keys } = await res.json();
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
  return { keys, ttlMs: (maxAge ? Number(maxAge) : 3600) * 1000 };
}

/**
 * @param {{clientId: string, fetchKeys?: () => Promise<{keys: object[], ttlMs: number}>, now?: () => number}} options
 * `fetchKeys` y `now` se pueden inyectar (pruebas); por defecto consulta a Google.
 */
export function createGoogleVerifier({ clientId, fetchKeys = fetchGoogleKeys, now = Date.now }) {
  let cache = { keys: new Map(), expires: 0, fetchedAt: 0 };

  async function keyFor(kid) {
    const fresh = cache.expires > now();
    if (fresh && cache.keys.has(kid)) return cache.keys.get(kid);
    // Refresca si la caché venció o llegó un kid desconocido (como máximo una vez por minuto).
    if (!fresh || now() - cache.fetchedAt > 60_000) {
      const { keys, ttlMs } = await fetchKeys();
      cache = {
        keys: new Map(keys.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })])),
        expires: now() + ttlMs,
        fetchedAt: now(),
      };
    }
    return cache.keys.get(kid) ?? null;
  }

  return async function verifyIdToken(idToken, expectedNonce) {
    const invalid = () => new HttpError(401, 'google_invalid', 'No pudimos validar tu cuenta de Google. Intenta de nuevo.');
    if (!clientId) throw new HttpError(503, 'google_disabled', 'El ingreso con Google no está configurado.');
    const parts = typeof idToken === 'string' ? idToken.split('.') : [];
    if (parts.length !== 3) throw invalid();
    let header, claims;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch { throw invalid(); }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw invalid();

    let key;
    try { key = await keyFor(header.kid); } catch { throw new HttpError(503, 'google_unreachable', 'No pudimos contactar a Google. Intenta de nuevo en unos minutos.'); }
    if (!key) throw invalid();
    const signatureOk = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!signatureOk) throw invalid();

    const nowSec = Math.floor(now() / 1000);
    if (!ISSUERS.has(claims.iss) || claims.aud !== clientId) throw invalid();
    if (!(claims.exp > nowSec - CLOCK_SKEW_SECONDS) || !(claims.iat <= nowSec + CLOCK_SKEW_SECONDS)) throw invalid();
    if (typeof claims.sub !== 'string' || typeof claims.email !== 'string') throw invalid();
    if (claims.email_verified !== true && claims.email_verified !== 'true') throw invalid();
    if (!expectedNonce || claims.nonce !== expectedNonce) throw invalid();

    return { sub: claims.sub, email: claims.email.toLowerCase(), name: String(claims.name ?? claims.email).slice(0, 120) };
  };
}
