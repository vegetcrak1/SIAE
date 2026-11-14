// Utilidades HTTP sin dependencias: errores, enrutador, cookies, cuerpo, cabeceras de seguridad y límite de peticiones.
export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const SENT = Symbol('sent');

// ---------- Enrutador ----------
export class Router {
  #routes = [];

  add(method, path, opts, handler) {
    const keys = [];
    const regex = new RegExp(`^${path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    this.#routes.push({ method, regex, keys, opts: opts ?? {}, handler });
  }

  match(method, pathname) {
    let pathMatched = false;
    for (const route of this.#routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

// ---------- Cookies y cuerpo ----------
export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure }) {
  return [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', secure && 'Secure', maxAge !== undefined && `Max-Age=${maxAge}`]
    .filter(Boolean).join('; ');
}

export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) return reject(new HttpError(413, 'too_large', 'El archivo o mensaje es demasiado grande.'));
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'too_large', 'El archivo o mensaje es demasiado grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req, limit = 64 * 1024) {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') throw new HttpError(415, 'unsupported', 'Se esperaba application/json.');
  const buf = await readBody(req, limit);
  try {
    const value = JSON.parse(buf.toString('utf8') || '{}');
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return value;
  } catch {
    throw new HttpError(400, 'invalid_json', 'El cuerpo de la petición no es JSON válido.');
  }
}

// ---------- Cabeceras de seguridad ----------
export function securityHeaders({ cookieSecure }) {
  const headers = {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://accounts.google.com/gsi/client",
      "style-src 'self' https://accounts.google.com/gsi/style",
      "img-src 'self' data: blob:",
      "connect-src 'self' https://accounts.google.com/gsi/",
      'frame-src https://accounts.google.com/gsi/',
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  };
  if (cookieSecure) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (forwarded.length) return forwarded[forwarded.length - 1];
  }
  return req.socket.remoteAddress ?? 'unknown';
}
