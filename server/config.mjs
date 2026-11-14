// Configuración leída de variables de entorno, validada al arrancar.

const toInt = (value, fallback, min, max) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Valor inválido: ${value}`);
  return n;
};

export function loadConfig(overrides = {}) {
  const e = { ...process.env, ...overrides };
  const secret = e.APP_SECRET ?? '';
  if (secret.length < 32) {
    throw new Error('APP_SECRET es obligatorio y debe tener al menos 32 caracteres. Ejecute: npm run init');
  }
  const tz = e.SCHOOL_TZ || 'America/Bogota';
  try { new Intl.DateTimeFormat('es', { timeZone: tz }); } catch { throw new Error(`SCHOOL_TZ inválida: ${tz}`); }

  const production = e.NODE_ENV === 'production';
  const serverless = e.VERCEL === '1';
  return Object.freeze({
    production,
    secret,
    port: toInt(e.PORT, 3000, 0, 65535),
    host: e.HOST || '0.0.0.0',
    dbPath: e.DB_PATH || './data/siae.db',
    tursoUrl: (e.TURSO_DATABASE_URL || '').trim(),
    tursoToken: (e.TURSO_AUTH_TOKEN || '').trim(),
    serverless,
    googleClientId: (e.GOOGLE_CLIENT_ID || '').trim(),
    adminEmails: new Set((e.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)),
    institution: (e.INSTITUTION_NAME || '').trim().slice(0, 80),
    tz,
    trustProxy: e.TRUST_PROXY ? e.TRUST_PROXY === '1' : serverless,
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === '1' : production || serverless,
    sessionHours: toInt(e.SESSION_HOURS, 12, 1, 72),
    idleMinutes: toInt(e.IDLE_MINUTES, 60, 5, 1440),
    scryptCost: toInt(e.SCRYPT_COST, 15, 10, 17),
    loginRateLimit: toInt(e.LOGIN_RATE_LIMIT, 100, 5, 100000),
  });
}
