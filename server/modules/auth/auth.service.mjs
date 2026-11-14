// Servicio de autenticación: sesiones (JWT + registro en base de datos), login unificado, Google y cambio de contraseña.
// Sin estado en memoria: todo lo que debe recordarse entre peticiones vive en la base de datos (apto para Vercel).
import { HttpError } from '../../http.mjs';
import { deriveKey, hashPassword, randomToken, sha256, signJwt, signToken, verifyJwt, verifyPassword, verifyToken } from '../../security.mjs';
import * as v from '../../domain.mjs';
import { defaultPassword } from '../../domain.mjs';
import { GENERIC_AUTH_ERROR, JWT_AUDIENCE, JWT_ISSUER } from './auth.constants.mjs';

const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const NONCE_TTL_S = 10 * 60;
const REGISTRATION_TTL_S = 15 * 60;
const MIN_NEW_PASSWORD = 8;
const genericError = () => new HttpError(401, 'bad_credentials', GENERIC_AUTH_ERROR);
const isUnique = (err) => /UNIQUE constraint/i.test(String(err?.message));

export function publicUser(u) {
  return {
    id: u.id, role: u.role, name: u.name, email: u.email, grade: u.grade ?? null,
    mustChangePassword: !!u.password_is_default && u.role !== 'estudiante',
    passwordIsDefault: !!u.password_is_default,
  };
}

export function createAuth({ db, config, verifyGoogle }) {
  const regKey = deriveKey(config.secret, 'registration');
  const jwtKey = deriveKey(config.secret, 'jwt');
  const nonceKey = deriveKey(config.secret, 'nonce');
  const jwtOpts = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE };
  const dummyHash = hashPassword('contraseña-inexistente', config.scryptCost); // se compara siempre: iguala tiempos de respuesta
  const now = () => Date.now();

  const byId = (id) => db.get('SELECT * FROM users WHERE id = ?', id);
  const byDoc = (doc) => db.get('SELECT * FROM users WHERE documento = ?', doc);
  const byEmail = (email) => db.get('SELECT * FROM users WHERE email = ?', email);
  const bySub = (sub) => db.get('SELECT * FROM users WHERE google_sub = ?', sub);

  const audit = (userId, action, detail = '', ip = '') =>
    db.run('INSERT INTO audit_log (at, user_id, action, detail, ip) VALUES (?, ?, ?, ?, ?)', now(), userId ?? null, action, String(detail).slice(0, 300), ip);

  // ---------- Sesiones ----------
  // El JWT lleva el id (sub) y el rol; además cada sesión se registra por su jti para poder revocarla
  // (cerrar sesión, cambiar contraseña, desactivar usuario) sin esperar a que el token expire.
  async function createSession(user) {
    const jti = randomToken(16);
    const t = now();
    const ttl = config.sessionHours * 3600;
    await db.run('DELETE FROM sessions WHERE expires_at < ?', t);
    await db.run('INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)', sha256(jti), user.id, t, t, t + ttl * 1000);
    await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', t, user.id);
    return { token: signJwt(jwtKey, { sub: String(user.id), role: user.role, jti }, { ttlSeconds: ttl, ...jwtOpts }), maxAge: ttl };
  }

  /** Devuelve { user, jti } si el token es válido, la sesión sigue activa y el usuario está activo con el mismo rol. */
  async function authenticate(token) {
    const claims = token ? verifyJwt(jwtKey, token, jwtOpts) : null;
    if (!claims) return null;
    const hash = sha256(claims.jti);
    // Una sola consulta (sesión + usuario): cada ida y vuelta a una base remota cuesta tiempo.
    const row = await db.get(`SELECT u.*, s.last_seen_at AS s_last_seen, s.expires_at AS s_expires, s.user_id AS s_user
      FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, hash);
    if (!row || row.s_user !== Number(claims.sub)) return null;
    const t = now();
    if (row.s_expires < t || t - row.s_last_seen > config.idleMinutes * 60_000) {
      await db.run('DELETE FROM sessions WHERE token_hash = ?', hash);
      return null;
    }
    if (t - row.s_last_seen > 60_000) await db.run('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?', t, hash);
    const { s_last_seen, s_expires, s_user, ...user } = row;
    return user.status === 'activo' && user.role === claims.role ? { user, jti: claims.jti } : null;
  }

  async function destroySession(token) {
    const claims = token ? verifyJwt(jwtKey, token, { ...jwtOpts, ignoreExpiry: true }) : null;
    if (claims) await db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(claims.jti));
  }

  // ---------- Contraseñas con bloqueo por intentos fallidos ----------
  async function checkPassword(user, password, ip) {
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) throw genericError();
    if (!user?.password_hash) { await verifyPassword(password, await dummyHash); throw genericError(); }
    if (user.locked_until > now()) {
      const minutes = Math.ceil((user.locked_until - now()) / 60_000);
      throw new HttpError(429, 'locked', `Demasiados intentos fallidos. Intenta de nuevo en ${minutes} minuto(s).`);
    }
    if (await verifyPassword(password, user.password_hash)) {
      if (user.failed_logins) await db.run('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?', user.id);
      return;
    }
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED;
    await db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lock ? 0 : failed, lock ? now() + LOCK_MS : 0, user.id);
    await audit(user.id, lock ? 'login.locked' : 'login.failed', '', ip);
    throw genericError();
  }

  /** Solo los usuarios con estado "activo" reciben sesión. Se llama después de verificar la identidad. */
  function assertUsable(user) {
    if (user.status === 'inactivo') throw new HttpError(403, 'inactive', 'Tu cuenta está desactivada. Comunícate con la institución.');
    if (user.status === 'pendiente') throw new HttpError(403, 'pending', 'Tu registro está pendiente de aprobación. La institución te avisará cuando puedas ingresar.');
  }

  /** Login unificado: `credentials` viene de parseLogin ({ by: 'email' | 'documento', value, password }). */
  async function login({ by, value, password }, ip) {
    const user = await (by === 'email' ? byEmail(value) : byDoc(value));
    await checkPassword(user, password, ip);
    assertUsable(user);
    await audit(user.id, 'login.password', '', ip);
    return { user, session: await createSession(user) };
  }

  // ---------- Google ----------
  // El nonce es un token firmado con caducidad (sin estado en memoria) y de un solo uso: al consumirlo se registra su huella.
  const issueNonce = () => signToken(nonceKey, { n: randomToken(18) }, NONCE_TTL_S);

  async function consumeNonce(nonce) {
    const claims = verifyToken(nonceKey, nonce);
    if (!claims) return false;
    try {
      await db.run('INSERT INTO used_nonces (nonce_hash, exp) VALUES (?, ?)', sha256(nonce), claims.exp * 1000);
    } catch (err) {
      if (isUnique(err)) return false; // ya usado: repetición del mismo token de Google
      throw err;
    }
    if (Math.random() < 0.05) await db.run('DELETE FROM used_nonces WHERE exp < ?', now());
    return true;
  }

  async function googleLogin({ credential, nonce }, ip) {
    if (typeof nonce !== 'string' || !(await consumeNonce(nonce))) throw new HttpError(400, 'nonce', 'La solicitud expiró. Recarga la página e intenta de nuevo.');
    const g = await verifyGoogle(credential, nonce);

    let user = await bySub(g.sub);
    if (!user) {
      const existing = await byEmail(g.email);
      if (existing) {
        if (existing.google_sub && existing.google_sub !== g.sub) throw new HttpError(409, 'conflict', 'Ese correo ya está vinculado a otra cuenta de Google.');
        await db.run('UPDATE users SET google_sub = ? WHERE id = ?', g.sub, existing.id);
        user = await byId(existing.id);
      }
    }
    if (config.adminEmails.has(g.email)) {
      if (!user) {
        const { lastInsertRowid: id } = await db.run("INSERT INTO users (role, name, email, google_sub, status, created_at) VALUES ('admin', ?, ?, ?, 'activo', ?)", g.name, g.email, g.sub, now());
        user = await byId(id);
        await audit(id, 'admin.bootstrap', g.email, ip);
      } else if (user.role !== 'admin') {
        await db.run("UPDATE users SET role = 'admin', status = 'activo' WHERE id = ?", user.id);
        await audit(user.id, 'admin.promoted', g.email, ip);
        user = await byId(user.id);
      }
    }
    // Un correo que figura como acudiente de algún estudiante crea automáticamente su cuenta de padre.
    if (!user && await db.get('SELECT 1 AS ok FROM users WHERE role = ? AND guardian_email = ? LIMIT 1', 'estudiante', g.email)) {
      const { lastInsertRowid: id } = await db.run("INSERT INTO users (role, name, email, google_sub, status, created_at) VALUES ('padre', ?, ?, ?, 'activo', ?)", g.name, g.email, g.sub, now());
      user = await byId(id);
    }

    if (user) {
      assertUsable(user);
      // Quien se identifica con Google ya no necesita la contraseña temporal que conoce el administrador: se anula.
      if (user.password_is_default && user.role !== 'estudiante') {
        await db.run('UPDATE users SET password_hash = NULL, password_is_default = 0 WHERE id = ?', user.id);
        user = await byId(user.id);
      }
      await audit(user.id, 'login.google', '', ip);
      return { status: 'ok', user, session: await createSession(user) };
    }
    const grades = (await db.all('SELECT DISTINCT grade FROM courses WHERE active = 1 ORDER BY grade')).map((r) => r.grade);
    return {
      status: 'needs_registration', email: g.email, name: g.name, grades,
      registrationToken: signToken(regKey, { sub: g.sub, email: g.email, name: g.name }, REGISTRATION_TTL_S),
    };
  }

  /** Registro de estudiante con Google + documento. Si el documento ya fue cargado por el colegio, se vincula (exige la clave inicial). */
  async function register(body, ip) {
    const claims = verifyToken(regKey, body.registrationToken);
    if (!claims) throw new HttpError(401, 'registration_expired', 'La verificación de Google expiró. Vuelve a ingresar con Google.');
    if ((await bySub(claims.sub)) || (await byEmail(claims.email))) throw new HttpError(409, 'conflict', 'Esta cuenta de Google ya está registrada. Ingresa con Google.');

    const type = v.docType(body.docType);
    const doc = v.documento(body.documento);
    const existing = await byDoc(doc);

    if (existing) {
      if (existing.role !== 'estudiante' || existing.google_sub || existing.email) {
        throw new HttpError(409, 'document_taken', 'Ese documento ya está registrado. Ingresa con tu documento y contraseña.');
      }
      if (!body.password) {
        throw new HttpError(409, 'claim_requires_password', 'Tu documento ya está en el sistema. Escribe tu contraseña inicial (los últimos 4 dígitos del documento) para vincular tu cuenta de Google.');
      }
      await checkPassword(existing, body.password, ip);
      assertUsable(existing);
      await db.run('UPDATE users SET google_sub = ?, email = ?, doc_type = ? WHERE id = ?', claims.sub, claims.email, type, existing.id);
      await audit(existing.id, 'register.link', '', ip);
      return { status: 'ok', user: await byId(existing.id), session: await createSession(existing) };
    }

    const name = v.text(body.name ?? claims.name, 'El nombre completo', { min: 3, max: 120 });
    const gradeValue = v.grade(body.grade);
    const hash = await hashPassword(defaultPassword(doc), config.scryptCost);
    let id;
    try {
      ({ lastInsertRowid: id } = await db.run(`INSERT INTO users (role, name, email, google_sub, doc_type, documento, password_hash, password_is_default, status, grade, created_at)
        VALUES ('estudiante', ?, ?, ?, ?, ?, ?, 1, 'pendiente', ?, ?)`, name, claims.email, claims.sub, type, doc, hash, gradeValue, now()));
    } catch (err) {
      if (isUnique(err)) throw new HttpError(409, 'document_taken', 'Ese documento ya está registrado. Ingresa con tu documento y contraseña.');
      throw err;
    }
    await audit(id, 'register.new', gradeValue, ip);
    return { status: 'pending' }; // sin sesión: un administrador debe aprobar el registro
  }

  async function changePassword(user, { current, next }, ip, currentJti) {
    await checkPassword(user, current, ip);
    if (typeof next !== 'string' || next.length < MIN_NEW_PASSWORD || next.length > 128) {
      throw new HttpError(400, 'invalid', `La nueva contraseña debe tener entre ${MIN_NEW_PASSWORD} y 128 caracteres.`);
    }
    if (next === current || (user.documento && (next === user.documento || next === defaultPassword(user.documento)))) {
      throw new HttpError(400, 'invalid', 'Elige una contraseña distinta a la actual y que no sea tu documento.');
    }
    await db.run('UPDATE users SET password_hash = ?, password_is_default = 0 WHERE id = ?', await hashPassword(next, config.scryptCost), user.id);
    await db.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', user.id, sha256(currentJti));
    await audit(user.id, 'password.changed', '', ip);
  }

  return { audit, createSession, authenticate, destroySession, login, issueNonce, googleLogin, register, changePassword };
}
