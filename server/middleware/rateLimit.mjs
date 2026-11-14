// Limitadores de peticiones.
//  · "login" (ingreso, registro): guardado en la base de datos → vale con varias instancias o en Vercel.
//  · "api" y "nonce": en memoria, "mejor esfuerzo" por instancia (son defensas secundarias; el bloqueo por cuenta es la principal).
import { HttpError } from '../http.mjs';

class MemoryLimiter {
  #hits = new Map();
  constructor({ windowMs, max }) {
    this.windowMs = windowMs;
    this.max = max;
    this.timer = setInterval(() => this.#sweep(), Math.max(windowMs, 30_000));
    this.timer.unref?.();
  }

  /** Registra un intento. Devuelve los segundos de espera si superó el límite, o 0 si está permitido. */
  async take(key, now = Date.now()) {
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.#hits.set(key, recent);
      return Math.ceil((recent[0] + this.windowMs - now) / 1000);
    }
    recent.push(now);
    this.#hits.set(key, recent);
    return 0;
  }

  #sweep(now = Date.now()) {
    for (const [key, list] of this.#hits) {
      const recent = list.filter((t) => now - t < this.windowMs);
      if (recent.length) this.#hits.set(key, recent); else this.#hits.delete(key);
    }
  }

  close() { clearInterval(this.timer); }
}

class DbLimiter {
  constructor(db, { windowMs, max }) { this.db = db; this.windowMs = windowMs; this.max = max; }

  async take(key, now = Date.now()) {
    const since = now - this.windowMs;
    const { n, oldest } = await this.db.get('SELECT COUNT(*) AS n, MIN(at) AS oldest FROM rate_limits WHERE key = ? AND at > ?', key, since);
    if (n >= this.max) return Math.ceil((oldest + this.windowMs - now) / 1000);
    await this.db.run('INSERT INTO rate_limits (key, at) VALUES (?, ?)', key, now);
    if (Math.random() < 0.02) await this.db.run('DELETE FROM rate_limits WHERE at < ?', since);
    return 0;
  }

  close() {}
}

export function createLimiters(config, db) {
  // Los colegios comparten IP pública: el límite por IP es amplio; la defensa principal es el bloqueo por cuenta.
  const groups = {
    api: new MemoryLimiter({ windowMs: 60_000, max: 600 }),
    login: new DbLimiter(db, { windowMs: 10 * 60_000, max: config.loginRateLimit }),
    nonce: new MemoryLimiter({ windowMs: 10 * 60_000, max: 60 }),
  };
  return {
    /** Lanza 429 con Retry-After si `ip` superó el límite del grupo indicado. */
    async enforce(group, ip) {
      const wait = await groups[group].take(group === 'login' ? `login:${ip}` : ip);
      if (wait) {
        const message = group === 'login' ? `Demasiados intentos. Intenta de nuevo en ${Math.ceil(wait / 60)} minuto(s).` : 'Demasiadas solicitudes. Espera un momento.';
        throw new HttpError(429, 'rate_limited', message, { retryAfter: wait });
      }
    },
    close() { Object.values(groups).forEach((l) => l.close()); },
  };
}
