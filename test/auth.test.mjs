import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { loadConfig } from '../server/config.mjs';
import { startApp, idToken, otherKey, CLIENT_ID } from './helpers.mjs';

describe('configuración', () => {
  test('exige APP_SECRET de al menos 32 caracteres', () => {
    assert.throws(() => loadConfig({ APP_SECRET: 'corto' }), /APP_SECRET/);
    assert.throws(() => loadConfig({ APP_SECRET: '' }), /APP_SECRET/);
  });
});

describe('login unificado', () => {
  let t, admin, temp;
  before(async () => {
    t = await startApp();
    admin = await t.adminClient();
    await admin.post('/api/admin/students', { name: 'Ana Pérez', docType: 'TI', documento: '1098765432', grade: '10A', guardianEmail: 'papa@correo.com' });
    temp = (await admin.post('/api/admin/users', { role: 'profesor', name: 'Laura Mendoza', email: 'Laura@Colegio.edu' })).data;
  });
  after(() => t.close());

  test('cabeceras de seguridad en cada respuesta', async () => {
    const r = await t.client().get('/api/config');
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.data.googleClientId, CLIENT_ID);
  });

  test('rechaza escrituras sin Origin propio o sin cabecera anti-CSRF', async () => {
    const c = t.client();
    const body = { usuario: '1', password: '1' };
    assert.equal((await c.post('/api/auth/login', body, { csrf: false })).status, 403);
    assert.equal((await c.post('/api/auth/login', body, { csrf: false, headers: { Origin: 'https://evil.example', 'X-Requested-With': 'siae' } })).status, 403);
  });

  test('estudiante: documento + últimos 4 dígitos → token con id y rol, y redirección a su dashboard', async () => {
    const c = t.client();
    const r = await c.post('/api/auth/login', { usuario: '1098765432', password: '5432' });
    assert.equal(r.status, 200);
    assert.equal(r.data.success, true);
    assert.equal(r.data.redirectTo, '/dashboard/estudiante');
    assert.equal(r.data.user.role, 'estudiante');
    assert.equal(r.data.user.mustChangePassword, false);
    assert.ok(!JSON.stringify(r.data).includes('password_hash'));
    const claims = JSON.parse(Buffer.from(r.data.token.split('.')[1], 'base64url'));
    assert.equal(claims.sub, String(r.data.user.id));
    assert.equal(claims.role, 'estudiante');
    assert.equal((await c.get('/api/session')).data.redirectTo, '/dashboard/estudiante');
  });

  test('profesor: correo (sin importar mayúsculas) + contraseña temporal → debe cambiarla antes de usar el sistema', async () => {
    const c = t.client();
    const r = await c.post('/api/auth/login', { usuario: ' laura@colegio.EDU ', password: temp.temporaryPassword });
    assert.equal(r.status, 200);
    assert.equal(r.data.redirectTo, '/dashboard/profesor');
    assert.equal(r.data.user.mustChangePassword, true);
    const blocked = await c.get('/api/profesor/classes');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.error.code, 'must_change_password');
    assert.equal((await c.post('/api/auth/password', { current: temp.temporaryPassword, next: 'corta' })).status, 400);
    assert.equal((await c.post('/api/auth/password', { current: temp.temporaryPassword, next: 'ClaveNueva2026' })).status, 200);
    assert.equal((await c.get('/api/profesor/classes')).status, 200);
    assert.equal((await t.client().post('/api/auth/login', { usuario: 'laura@colegio.edu', password: temp.temporaryPassword })).status, 401, 'la temporal deja de servir');
  });

  test('validación de entradas → 400 (vacíos, correo mal formado, documento inválido, campos extra)', async () => {
    const c = t.client();
    const bad = async (body) => (await c.post('/api/auth/login', body)).status;
    assert.equal(await bad({}), 400);
    assert.equal(await bad({ usuario: '', password: 'x' }), 400);
    assert.equal(await bad({ usuario: '   ', password: 'x' }), 400);
    assert.equal(await bad({ usuario: 'laura@colegio.edu', password: '' }), 400);
    assert.equal(await bad({ usuario: 'laura@', password: 'x' }), 400);
    assert.equal(await bad({ usuario: 'abc', password: 'x' }), 400);
    assert.equal(await bad({ usuario: 123456, password: 'x' }), 400);
    assert.equal(await bad({ usuario: '1098765432', password: 'x'.repeat(200) }), 400);
    assert.equal(await bad({ usuario: '1098765432', password: '5432', role: 'admin' }), 400, 'el cliente no puede enviar el rol');
  });

  test('mismo error 401 para usuario inexistente y contraseña errónea (sin enumeración)', async () => {
    const a = await t.client().post('/api/auth/login', { usuario: '1098765432', password: '0000' });
    const b = await t.client().post('/api/auth/login', { usuario: '99999999', password: '0000' });
    const c = await t.client().post('/api/auth/login', { usuario: 'nadie@colegio.edu', password: '0000' });
    assert.equal(a.status, 401);
    assert.deepEqual(a.data, b.data);
    assert.deepEqual(a.data, c.data);
  });

  test('la cookie de sesión es HttpOnly y SameSite=Strict', async () => {
    const cookie = (await t.client().post('/api/auth/login', { usuario: '1098765432', password: '5432' })).headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  });

  test('JWT: manipulado, sin firma, con otro algoritmo o con otro rol se rechaza', async () => {
    const { data } = await t.client().post('/api/auth/login', { usuario: '1098765432', password: '5432' });
    const [h, p, s] = data.token.split('.');
    const bearer = (token) => t.client().get('/api/estudiante/overview', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await bearer(data.token)).status, 200, 'el token válido sirve como Bearer');
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const claims = JSON.parse(Buffer.from(p, 'base64url'));
    assert.equal((await bearer(`${b64({ alg: 'none', typ: 'JWT' })}.${p}.`)).status, 401, 'alg none');
    assert.equal((await bearer(`${h}.${b64({ ...claims, role: 'admin' })}.${s}`)).status, 401, 'rol alterado');
    assert.equal((await bearer(`${h}.${p}.${s.slice(0, -2)}AA`)).status, 401, 'firma alterada');
    assert.equal((await bearer(`${b64({ alg: 'HS512', typ: 'JWT' })}.${p}.${createHmac('sha512', 'x').update('x').digest('base64url')}`)).status, 401, 'otro algoritmo');
    assert.equal((await t.client().get('/api/estudiante/overview', { headers: { Authorization: 'Bearer basura' } })).status, 401);
  });

  test('bloquea la cuenta tras 5 intentos fallidos, incluso con la clave correcta', async () => {
    await admin.post('/api/admin/students', { name: 'Luis Gómez', docType: 'TI', documento: '1011223344', grade: '10A' });
    const c = t.client();
    for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/login', { usuario: '1011223344', password: 'xxxx' })).status, 401);
    const locked = await c.post('/api/auth/login', { usuario: '1011223344', password: '3344' });
    assert.equal(locked.status, 429);
    assert.equal(locked.data.error.code, 'locked');
  });

  test('el restablecimiento por el administrador desbloquea y vuelve a la clave inicial', async () => {
    const list = await admin.get('/api/admin/students?q=1011223344');
    assert.equal(list.data.items[0].locked, true);
    assert.equal((await admin.post(`/api/admin/students/${list.data.items[0].id}/reset-password`)).status, 200);
    assert.equal((await t.client().post('/api/auth/login', { usuario: '1011223344', password: '3344' })).status, 200);
  });

  test('cambio de contraseña: exige la actual, 8+ caracteres y revoca las demás sesiones', async () => {
    const a = t.client(); const b = t.client();
    await a.post('/api/auth/login', { usuario: '1098765432', password: '5432' });
    await b.post('/api/auth/login', { usuario: '1098765432', password: '5432' });
    assert.equal((await a.post('/api/auth/password', { current: 'mal', next: 'NuevaClave9' })).status, 401);
    assert.equal((await a.post('/api/auth/password', { current: '5432', next: '1234567' })).status, 400);
    assert.equal((await a.post('/api/auth/password', { current: '5432', next: '1098765432' })).status, 400, 'no puede ser el documento');
    assert.equal((await a.post('/api/auth/password', { current: '5432', next: 'NuevaClave9' })).status, 200);
    assert.equal((await b.get('/api/session')).data.user, null, 'la otra sesión se revoca');
    assert.equal((await a.get('/api/session')).data.user.passwordIsDefault, false);
    assert.equal((await t.client().post('/api/auth/login', { usuario: '1098765432', password: '5432' })).status, 401);
  });

  test('cerrar sesión invalida el token en el servidor (aunque se conserve la cookie)', async () => {
    const c = t.client();
    const { data } = await c.post('/api/auth/login', { usuario: '1011223344', password: '3344' });
    await c.post('/api/auth/logout');
    assert.equal((await t.client().get('/api/session', { headers: { Authorization: `Bearer ${data.token}` } })).data.user, null);
  });

  test('un usuario desactivado pierde el acceso al instante; uno pendiente no recibe sesión', async () => {
    const c = t.client();
    await c.post('/api/auth/login', { usuario: '1011223344', password: '3344' });
    const id = (await admin.get('/api/admin/students?q=1011223344')).data.items[0];
    await admin.put(`/api/admin/students/${id.id}`, { ...id, status: 'inactivo' });
    assert.equal((await c.get('/api/session')).data.user, null);
    const r = await t.client().post('/api/auth/login', { usuario: '1011223344', password: '3344' });
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, 'inactive');
    await admin.put(`/api/admin/students/${id.id}`, { ...id, status: 'pendiente' });
    assert.equal((await t.client().post('/api/auth/login', { usuario: '1011223344', password: '3344' })).data.error.code, 'pending');
  });

  test('límite de intentos por IP en las rutas de ingreso', async () => {
    const limited = await startApp({ LOGIN_RATE_LIMIT: '20' });
    try {
      const c = limited.client();
      let last;
      for (let i = 0; i < 25; i++) last = await c.post('/api/auth/login', { usuario: `5000000${i}`, password: 'x' });
      assert.equal(last.status, 429);
      assert.ok(last.headers.get('retry-after'));
    } finally { limited.close(); }
  });

  test('administración de usuarios: contraseña temporal única, roles válidos y protección del último admin', async () => {
    assert.equal((await admin.post('/api/admin/users', { role: 'estudiante', name: 'Xx Yy', email: 'x@y.co' })).status, 400);
    assert.equal((await admin.post('/api/admin/users', { role: 'profesor', name: 'Dup', email: 'laura@colegio.edu' })).status, 409);
    const padre = (await admin.post('/api/admin/users', { role: 'padre', name: 'Papá de Ana', email: 'papa@correo.com' })).data;
    assert.match(padre.temporaryPassword, /^[A-Za-z0-9]{10}$/);
    const padres = (await admin.get('/api/admin/users?role=padre')).data.items;
    assert.equal(padres[0].children, 1, 'se vincula por el correo del acudiente del estudiante');
    assert.ok(!JSON.stringify(padres).includes(padre.temporaryPassword));
    const me = (await admin.get('/api/admin/users?role=admin')).data.items[0];
    assert.equal((await admin.put(`/api/admin/users/${me.id}`, { ...me, status: 'inactivo' })).data.error.code, 'self');
    assert.equal((await admin.del(`/api/admin/users/${me.id}`)).status, 409);
    const reset = await admin.post(`/api/admin/users/${padre.id}/reset-password`);
    assert.notEqual(reset.data.temporaryPassword, padre.temporaryPassword);
  });
});

describe('ingreso y registro con Google', () => {
  let t, admin;
  before(async () => { t = await startApp(); admin = await t.adminClient(); });
  after(() => t.close());

  const attempt = async (claims, { nonce, key, kid } = {}) => {
    const c = t.client();
    const { data } = await c.get('/api/auth/nonce');
    return { c, res: await c.post('/api/auth/google', { credential: idToken({ nonce: nonce ?? data.nonce, ...claims }, { key, kid }), nonce: data.nonce }) };
  };

  test('rechaza tokens inválidos: firma ajena, audiencia, emisor, vencido, correo sin verificar, nonce ajeno', async () => {
    const base = { sub: 'g1', email: 'x@gmail.com', name: 'X' };
    assert.equal((await attempt(base, { key: otherKey })).res.status, 401);
    assert.equal((await attempt({ ...base, aud: 'otra-app' })).res.status, 401);
    assert.equal((await attempt({ ...base, iss: 'https://evil.example' })).res.status, 401);
    assert.equal((await attempt({ ...base, exp: Math.floor(Date.now() / 1000) - 3600 })).res.status, 401);
    assert.equal((await attempt({ ...base, email_verified: false })).res.status, 401);
    assert.equal((await attempt(base, { nonce: 'otro-nonce' })).res.status, 401);
    assert.equal((await attempt(base, { kid: 'desconocido' })).res.status, 401);
  });

  test('el nonce es de un solo uso (anti-replay)', async () => {
    const c = t.client();
    const { data: { nonce } } = await c.get('/api/auth/nonce');
    const credential = idToken({ nonce, sub: 'g-replay', email: 'replay@gmail.com', name: 'R' });
    assert.equal((await c.post('/api/auth/google', { credential, nonce })).status, 200);
    assert.equal((await c.post('/api/auth/google', { credential, nonce })).status, 400);
  });

  test('administrador de ADMIN_EMAILS entra con su correo verificado; otros no obtienen privilegios', async () => {
    const me = (await admin.get('/api/session')).data;
    assert.equal(me.user.role, 'admin');
    assert.equal(me.redirectTo, '/dashboard/admin');
    const { res, c } = await attempt({ sub: 'g-x', email: 'intruso@gmail.com', name: 'Intruso' });
    assert.equal(res.data.status, 'needs_registration');
    assert.equal((await c.get('/api/admin/students')).status, 401);
  });

  test('persona nueva: se registra con documento y queda pendiente (sin sesión) hasta que el administrador la apruebe', async () => {
    const teacherId = (await admin.post('/api/admin/users', { role: 'profesor', name: 'Prof Uno', email: 'uno@colegio.edu' })).data.id;
    await admin.post('/api/admin/courses', { grade: '10A', subject: 'x', teacherId, blockId: 'B1' });
    const { res, c } = await attempt({ sub: 'g-new', email: 'nuevo@gmail.com', name: 'Nuevo Estudiante' });
    assert.equal(res.data.status, 'needs_registration');
    assert.deepEqual(res.data.grades, ['10A']);
    const reg = await c.post('/api/auth/register', { registrationToken: res.data.registrationToken, docType: 'CC', documento: '1.234.567', grade: '10a', name: 'Nuevo Estudiante' });
    assert.equal(reg.status, 200);
    assert.equal(reg.data.status, 'pending');
    assert.equal((await c.get('/api/session')).data.user, null, 'no recibe sesión');
    assert.equal((await t.client().post('/api/auth/login', { usuario: '1234567', password: '4567' })).data.error.code, 'pending');
    assert.equal((await t.googleLogin(t.client(), { sub: 'g-new', email: 'nuevo@gmail.com', name: 'N' })).data.error.code, 'pending');

    const pending = (await admin.get('/api/admin/students?status=pendiente')).data.items;
    assert.equal(pending.length, 1);
    await admin.put(`/api/admin/students/${pending[0].id}`, { ...pending[0], status: 'activo' });
    assert.equal((await t.client().post('/api/auth/login', { usuario: '1234567', password: '4567' })).data.redirectTo, '/dashboard/estudiante');
    assert.equal((await t.googleLogin(t.client(), { sub: 'g-new', email: 'nuevo@gmail.com', name: 'N' })).status, 200);
  });

  test('el token de registro no sirve manipulado ni para documentos ya vinculados', async () => {
    const { res, c } = await attempt({ sub: 'g-bad', email: 'bad@gmail.com', name: 'Bad' });
    const tampered = res.data.registrationToken.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A'));
    assert.equal((await c.post('/api/auth/register', { registrationToken: tampered, docType: 'TI', documento: '7777777', grade: '10A' })).status, 401);
    assert.equal((await c.post('/api/auth/register', { registrationToken: res.data.registrationToken, docType: 'CC', documento: '1234567', grade: '10A' })).status, 409);
  });

  test('documento precargado por el colegio: vincular Google exige la clave inicial', async () => {
    await admin.post('/api/admin/students', { name: 'Marta Ríos', docType: 'TI', documento: '1055000111', grade: '10A' });
    const { res, c } = await attempt({ sub: 'g-marta', email: 'marta@gmail.com', name: 'Marta R' });
    const body = { registrationToken: res.data.registrationToken, docType: 'TI', documento: '1055000111', grade: '10A' };
    assert.equal((await c.post('/api/auth/register', body)).data.error.code, 'claim_requires_password');
    assert.equal((await c.post('/api/auth/register', { ...body, password: '9999' })).status, 401);
    const ok = await c.post('/api/auth/register', { ...body, password: '0111' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.redirectTo, '/dashboard/estudiante');
    assert.equal((await t.googleLogin(t.client(), { sub: 'g-marta', email: 'marta@gmail.com', name: 'Marta R' })).data.user.name, 'Marta Ríos');
  });

  test('profesores y padres preinscritos entran con Google; su contraseña temporal queda anulada', async () => {
    const temp = (await admin.post('/api/admin/users', { role: 'profesor', name: 'Prof Dos', email: 'dos@colegio.edu' })).data;
    const r = await t.googleLogin(t.client(), { sub: 'g-t2', email: 'dos@colegio.edu', name: 'Profe' });
    assert.equal(r.data.redirectTo, '/dashboard/profesor');
    assert.equal(r.data.user.mustChangePassword, false);
    assert.equal((await t.client().post('/api/auth/login', { usuario: 'dos@colegio.edu', password: temp.temporaryPassword })).status, 401);
    await admin.post('/api/admin/students', { name: 'Hijo Uno', docType: 'TI', documento: '1066000222', grade: '10A', guardianEmail: 'mama@gmail.com' });
    const m = await t.googleLogin(t.client(), { sub: 'g-mama', email: 'mama@gmail.com', name: 'Mamá' });
    assert.equal(m.data.redirectTo, '/dashboard/padre');
  });

  test('un profesor desactivado no puede iniciar sesión', async () => {
    const created = await admin.post('/api/admin/users', { role: 'profesor', name: 'Prof Tres', email: 'tres@colegio.edu' });
    await admin.put(`/api/admin/users/${created.data.id}`, { name: 'Prof Tres', email: 'tres@colegio.edu', status: 'inactivo' });
    assert.equal((await t.googleLogin(t.client(), { sub: 'g-t3', email: 'tres@colegio.edu', name: 'P3' })).status, 403);
  });
});
