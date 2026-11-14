import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin','profesor','estudiante','padre')),
  name TEXT NOT NULL,
  email TEXT UNIQUE COLLATE NOCASE,
  google_sub TEXT UNIQUE,
  doc_type TEXT CHECK (doc_type IN ('TI','CC')),
  documento TEXT UNIQUE,
  password_hash TEXT,
  password_is_default INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','pendiente','inactivo')),
  grade TEXT,
  guardian_email TEXT COLLATE NOCASE,
  guardian_phone TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS users_role_grade ON users (role, grade);
CREATE INDEX IF NOT EXISTS users_guardian_email ON users (guardian_email);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY,
  grade TEXT NOT NULL,
  subject TEXT NOT NULL,
  teacher_id INTEGER NOT NULL REFERENCES users (id),
  block_id TEXT NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users (id),
  course_id INTEGER NOT NULL REFERENCES courses (id),
  date TEXT NOT NULL,
  scanned_at INTEGER,
  minutes_late INTEGER,
  status TEXT NOT NULL CHECK (status IN ('puntual','tarde','ausente','justificado')),
  method TEXT NOT NULL CHECK (method IN ('qr','manual','auto')),
  observation TEXT NOT NULL DEFAULT '',
  recorded_by INTEGER REFERENCES users (id),
  substitute INTEGER NOT NULL DEFAULT 0,
  UNIQUE (student_id, course_id, date)
);
CREATE INDEX IF NOT EXISTS attendance_date ON attendance (date);
CREATE INDEX IF NOT EXISTS attendance_course_date ON attendance (course_id, date);

CREATE TABLE IF NOT EXISTS excuses (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users (id),
  course_id INTEGER NOT NULL REFERENCES courses (id),
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('medica','personal','error_registro')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente','aprobada','rechazada')),
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  resolved_by INTEGER REFERENCES users (id),
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS excuses_student ON excuses (student_id);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY,
  excuse_id INTEGER NOT NULL REFERENCES excuses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  guardian_id INTEGER NOT NULL REFERENCES users (id),
  student_id INTEGER NOT NULL REFERENCES users (id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('info','warning','critical')),
  audience TEXT NOT NULL CHECK (audience IN ('all','profesor','estudiante','padre')),
  created_by INTEGER REFERENCES users (id),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_reads (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  notification_id INTEGER NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, notification_id)
);

CREATE TABLE IF NOT EXISTS substitutions (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses (id),
  substitute_id INTEGER NOT NULL REFERENCES users (id),
  date TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  UNIQUE (course_id, date)
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS used_nonces (
  nonce_hash TEXT PRIMARY KEY,
  exp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_key ON rate_limits (key, at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT ''
);
`;

export const DEFAULT_RULES = Object.freeze({
  toleranceMinutes: 5,
  absentAfterMinutes: 20,
  riskThreshold: 5,
  blocks: [
    { id: 'B1', label: '1ª hora', start: '07:00' },
    { id: 'B2', label: '2ª hora', start: '08:00' },
    { id: 'B3', label: '3ª hora', start: '09:15' },
    { id: 'B4', label: '4ª hora', start: '10:15' },
    { id: 'B5', label: '5ª hora', start: '11:30' },
  ],
  contingency: { active: false, extraMinutes: 15, reason: '', activatedAt: null },
});

const STATEMENTS = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);

/**
 * Interfaz común de base de datos (asíncrona, para poder usar una base remota en Vercel):
 *   get(sql, ...params) → fila | undefined · all(sql, ...params) → filas · run(sql, ...params) → { changes, lastInsertRowid }
 *   transaction(async (tx) => …) → todo o nada · batch([sql…]) · close()
 * El SQL es SQLite en ambos modos: archivo local (node:sqlite) o Turso/libSQL (remoto).
 */
class LocalDb {
  #db;
  #queue = Promise.resolve();
  constructor(sqlite) { this.#db = sqlite; }

  async get(sql, ...p) { return this.#db.prepare(sql).get(...p); }
  async all(sql, ...p) { return this.#db.prepare(sql).all(...p); }
  async run(sql, ...p) {
    const r = this.#db.prepare(sql).run(...p);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }
  async batch(statements) { for (const sql of statements) this.#db.exec(sql); }

  /** Las transacciones se encolan: una conexión local no admite dos a la vez. El callback solo debe esperar operaciones de `tx`. */
  transaction(fn) {
    const job = this.#queue.then(async () => {
      this.#db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn({ get: (...a) => this.get(...a), all: (...a) => this.all(...a), run: (...a) => this.run(...a) });
        this.#db.exec('COMMIT');
        return result;
      } catch (err) {
        this.#db.exec('ROLLBACK');
        throw err;
      }
    });
    this.#queue = job.catch(() => {});
    return job;
  }

  async close() { this.#db.close(); }
}

const plain = (r) => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
const wrap = (x) => ({
  get: async (sql, ...p) => plain(await x.execute({ sql, args: p }))[0],
  all: async (sql, ...p) => plain(await x.execute({ sql, args: p })),
  run: async (sql, ...p) => {
    const r = await x.execute({ sql, args: p });
    return { changes: Number(r.rowsAffected), lastInsertRowid: Number(r.lastInsertRowid ?? 0) };
  },
});

export class RemoteDb {
  #client;
  constructor(client) { this.#client = client; Object.assign(this, wrap(client)); }
  async batch(statements) { await this.#client.batch(statements.map((sql) => ({ sql, args: [] })), 'write'); }
  async transaction(fn) {
    const tx = await this.#client.transaction('write');
    try {
      const result = await fn(wrap(tx));
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    } finally {
      tx.close();
    }
  }
  async close() { this.#client.close(); }
}

/** Abre la base: Turso si hay TURSO_DATABASE_URL (Vercel), o un archivo SQLite local. Crea las tablas si faltan. */
export async function openDb(config) {
  let db;
  if (config.tursoUrl) {
    let createClient;
    try { ({ createClient } = await import('@libsql/client/web')); } catch { throw new Error('Falta el paquete @libsql/client (npm install) para usar Turso.'); }
    // HTTP en lugar de WebSocket: es lo adecuado para funciones sin estado.
    db = new RemoteDb(createClient({ url: config.tursoUrl.replace(/^libsql:/, 'https:'), authToken: config.tursoToken }));
  } else {
    const path = config.dbPath;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(path);
    sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    db = new LocalDb(sqlite);
  }
  return initDb(db);
}

/** Crea las tablas que falten (es idempotente) y las reglas por defecto. */
export async function initDb(db) {
  await db.batch(STATEMENTS);
  await db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', 'rules', JSON.stringify(DEFAULT_RULES));
  return db;
}

export const transaction = (db, fn) => db.transaction(fn);
export const getRules = async (db) => JSON.parse((await db.get('SELECT value FROM settings WHERE key = ?', 'rules')).value);
export const saveRules = (db, rules) => db.run('UPDATE settings SET value = ? WHERE key = ?', JSON.stringify(rules), 'rules');
