// Administración de personas: estudiantes (clave inicial = últimos 4 dígitos del documento) y
// usuarios del colegio (profesor, padre, admin) que reciben una contraseña temporal de un solo uso.
import { HttpError } from '../http.mjs';
import * as v from '../domain.mjs';
import { hashPassword, randomPassword } from '../security.mjs';
import { unique } from './util.mjs';

const ADMIN = { roles: ['admin'] };
const PAGE_SIZE = 25;
const STAFF_ROLES = ['profesor', 'padre', 'admin'];
const STATUSES = ['activo', 'pendiente', 'inactivo'];

export function peopleRoutes(router, ctx) {
  const { db, config, auth } = ctx;
  const audit = (c, action, detail) => auth.audit(c.user.id, action, detail, c.ip);

  // ---------- Estudiantes ----------
  const studentRow = (u) => ({
    id: u.id, name: u.name, docType: u.doc_type, documento: u.documento, grade: u.grade, status: u.status,
    email: u.email, guardianEmail: u.guardian_email, guardianPhone: u.guardian_phone,
    googleLinked: !!u.google_sub, passwordIsDefault: !!u.password_is_default, locked: u.locked_until > Date.now(),
  });

  const studentFields = (body) => ({
    name: v.text(body.name, 'El nombre', { min: 3, max: 120 }),
    doc_type: v.docType(body.docType),
    documento: v.documento(body.documento),
    grade: v.grade(body.grade),
    guardian_email: body.guardianEmail ? v.email(body.guardianEmail, 'El correo del acudiente') : null,
    guardian_phone: v.phone(body.guardianPhone) || null,
    status: v.oneOf(body.status ?? 'activo', STATUSES, 'El estado'),
  });

  router.add('GET', '/api/admin/students', ADMIN, async (c) => {
    const where = ["role = 'estudiante'"];
    const args = [];
    if (c.query.q) {
      where.push("(name LIKE ? ESCAPE '\\' OR documento LIKE ? ESCAPE '\\' OR guardian_email LIKE ? ESCAPE '\\')");
      const like = `%${String(c.query.q).slice(0, 60).replace(/[\\%_]/g, '\\$&')}%`;
      args.push(like, like, like);
    }
    if (STATUSES.includes(c.query.status)) { where.push('status = ?'); args.push(c.query.status); }
    if (c.query.grade) { where.push('grade = ?'); args.push(String(c.query.grade).slice(0, 10)); }
    const page = Math.max(0, Number.parseInt(c.query.page, 10) || 0);
    const total = (await db.get(`SELECT COUNT(*) AS n FROM users WHERE ${where.join(' AND ')}`, ...args)).n;
    const items = (await db.all(`SELECT * FROM users WHERE ${where.join(' AND ')} ORDER BY (status = 'pendiente') DESC, grade, name LIMIT ? OFFSET ?`, ...args, PAGE_SIZE, page * PAGE_SIZE)).map(studentRow);
    const pending = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'estudiante' AND status = 'pendiente'")).n;
    const grades = (await db.all("SELECT DISTINCT grade FROM users WHERE role = 'estudiante' AND grade IS NOT NULL UNION SELECT DISTINCT grade FROM courses ORDER BY grade")).map((r) => r.grade);
    return { items, total, page, pageSize: PAGE_SIZE, pending, grades };
  });

  router.add('POST', '/api/admin/students', ADMIN, async (c) => {
    const f = studentFields(await c.json());
    const hash = await hashPassword(v.defaultPassword(f.documento), config.scryptCost);
    const result = await unique(() => db.run(`INSERT INTO users (role, name, doc_type, documento, grade, guardian_email, guardian_phone, status, password_hash, password_is_default, created_at)
      VALUES ('estudiante', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`, f.name, f.doc_type, f.documento, f.grade, f.guardian_email, f.guardian_phone, f.status, hash, Date.now()), 'Ya existe un usuario con ese documento.');
    await audit(c, 'student.create', `#${result.lastInsertRowid}`);
    return { id: Number(result.lastInsertRowid) };
  });

  router.add('PUT', '/api/admin/students/:id', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    const current = (await db.get("SELECT * FROM users WHERE id = ? AND role = 'estudiante'", id));
    if (!current) throw new HttpError(404, 'not_found', 'Estudiante no encontrado.');
    const f = studentFields(await c.json());
    let hash = current.password_hash;
    if (f.documento !== current.documento && current.password_is_default) hash = await hashPassword(v.defaultPassword(f.documento), config.scryptCost);
    await unique(() => db.run('UPDATE users SET name = ?, doc_type = ?, documento = ?, grade = ?, guardian_email = ?, guardian_phone = ?, status = ?, password_hash = ? WHERE id = ?', f.name, f.doc_type, f.documento, f.grade, f.guardian_email, f.guardian_phone, f.status, hash, id), 'Ya existe un usuario con ese documento.');
    if (f.status === 'inactivo') (await db.run('DELETE FROM sessions WHERE user_id = ?', id));
    if (current.status !== f.status) await audit(c, 'student.status', `#${id} ${current.status}→${f.status}`);
    return { success: true };
  });

  // Importación masiva (el navegador lee el CSV y envía lotes de hasta 100 filas). Cada fila se valida por separado:
  // las válidas se crean y las demás se devuelven con el motivo, para corregirlas y volver a cargarlas.
  router.add('POST', '/api/admin/students/import', ADMIN, async (c) => {
    const { rows } = await c.json();
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100) throw new HttpError(400, 'invalid', 'Envía entre 1 y 100 filas por lote.');
    let created = 0;
    const skipped = [];
    for (const [i, row] of rows.entries()) {
      const line = Number.isInteger(row?.line) ? row.line : i + 1;
      try {
        if (row === null || typeof row !== 'object') throw new HttpError(400, 'invalid', 'Fila inválida.');
        const f = studentFields({ ...row, docType: String(row.docType || 'TI').trim().toUpperCase(), status: 'activo' });
        const hash = await hashPassword(v.defaultPassword(f.documento), config.scryptCost);
        await unique(() => db.run(`INSERT INTO users (role, name, doc_type, documento, grade, guardian_email, guardian_phone, status, password_hash, password_is_default, created_at)
          VALUES ('estudiante', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`, f.name, f.doc_type, f.documento, f.grade, f.guardian_email, f.guardian_phone, f.status, hash, Date.now()), 'Ya existe un usuario con ese documento.');
        created++;
      } catch (e) {
        if (!(e instanceof HttpError)) throw e;
        skipped.push({ line, message: e.message });
      }
    }
    await audit(c, 'student.import', `${created} creados, ${skipped.length} omitidos`);
    return { created, skipped };
  });

  router.add('POST', '/api/admin/students/:id/reset-password', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    const s = (await db.get("SELECT * FROM users WHERE id = ? AND role = 'estudiante'", id));
    if (!s) throw new HttpError(404, 'not_found', 'Estudiante no encontrado.');
    (await db.run('UPDATE users SET password_hash = ?, password_is_default = 1, failed_logins = 0, locked_until = 0 WHERE id = ?', await hashPassword(v.defaultPassword(s.documento), config.scryptCost), id));
    (await db.run('DELETE FROM sessions WHERE user_id = ?', id));
    await audit(c, 'student.reset_password', `#${id}`);
    return { success: true };
  });

  router.add('DELETE', '/api/admin/students/:id', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    const used = (await db.get(`SELECT (SELECT COUNT(*) FROM attendance WHERE student_id = ?) + (SELECT COUNT(*) FROM excuses WHERE student_id = ?)
      + (SELECT COUNT(*) FROM feedback WHERE student_id = ?) AS n`, id, id, id)).n;
    if (used) throw new HttpError(409, 'has_history', 'El estudiante tiene historial. Márquelo como inactivo en lugar de eliminarlo.');
    await db.run('DELETE FROM sessions WHERE user_id = ?', id);
    await db.run('DELETE FROM notification_reads WHERE user_id = ?', id);
    await db.run("DELETE FROM users WHERE id = ? AND role = 'estudiante'", id);
    await audit(c, 'student.delete', `#${id}`);
    return { success: true };
  });

  // ---------- Profesores, padres y administradores ----------
  const userRow = (u) => ({
    id: u.id, role: u.role, name: u.name, email: u.email, docType: u.doc_type, documento: u.documento, status: u.status,
    googleLinked: !!u.google_sub, mustChangePassword: !!u.password_is_default, courses: u.courses, children: u.children, lastLoginAt: u.last_login_at,
  });

  router.add('GET', '/api/admin/users', ADMIN, async (c) => {
    const role = STAFF_ROLES.includes(c.query.role) ? c.query.role : null;
    const statusOnly = c.query.status === 'activo' ? "AND u.status = 'activo'" : '';
    const rows = (await db.all(`SELECT u.*,
        (SELECT COUNT(*) FROM courses c WHERE c.teacher_id = u.id AND c.active = 1) AS courses,
        (SELECT COUNT(*) FROM users s WHERE s.role = 'estudiante' AND s.guardian_email = u.email) AS children
      FROM users u WHERE u.role IN (${role ? '?' : STAFF_ROLES.map(() => '?').join(',')}) ${statusOnly}
      ORDER BY u.role, u.name`, ...(role ? [role] : STAFF_ROLES)));
    return { items: rows.map(userRow) };
  });

  const userFields = (body) => ({
    name: v.text(body.name, 'El nombre', { min: 3, max: 120 }),
    email: v.email(body.email, 'El correo'),
    doc_type: body.documento ? v.docType(body.docType) : null,
    documento: body.documento ? v.documento(body.documento) : null,
    status: v.oneOf(body.status ?? 'activo', ['activo', 'inactivo'], 'El estado'),
  });

  // La contraseña temporal se muestra UNA sola vez al administrador; en la base solo queda su hash.
  router.add('POST', '/api/admin/users', ADMIN, async (c) => {
    const body = await c.json();
    const role = v.oneOf(body.role, STAFF_ROLES, 'El rol');
    const f = userFields(body);
    const temporaryPassword = randomPassword();
    const hash = await hashPassword(temporaryPassword, config.scryptCost);
    const result = await unique(() => db.run(`INSERT INTO users (role, name, email, doc_type, documento, status, password_hash, password_is_default, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`, role, f.name, f.email, f.doc_type, f.documento, f.status, hash, Date.now()), 'Ya existe un usuario con ese correo o documento.');
    await audit(c, 'user.create', `#${result.lastInsertRowid} ${role}`);
    return { id: Number(result.lastInsertRowid), temporaryPassword };
  });

  async function guardAdminChange(c, current, nextStatus) {
    if (current.role !== 'admin') return;
    const demoting = nextStatus === 'inactivo' || nextStatus === 'delete';
    if (!demoting) return;
    if (current.id === c.user.id) throw new HttpError(409, 'self', 'No puedes desactivar ni eliminar tu propia cuenta de administrador.');
    const others = (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'activo' AND id != ?", current.id)).n;
    if (!others) throw new HttpError(409, 'last_admin', 'Debe quedar al menos un administrador activo.');
  }

  router.add('PUT', '/api/admin/users/:id', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    const current = (await db.get(`SELECT * FROM users WHERE id = ? AND role IN ('profesor','padre','admin')`, id));
    if (!current) throw new HttpError(404, 'not_found', 'Usuario no encontrado.');
    const f = userFields(await c.json());
    await guardAdminChange(c, current, f.status);
    // Cambiar el correo desvincula la cuenta de Google anterior.
    const sub = f.email === current.email.toLowerCase() ? current.google_sub : null;
    await unique(() => db.run('UPDATE users SET name = ?, email = ?, doc_type = ?, documento = ?, status = ?, google_sub = ? WHERE id = ?', f.name, f.email, f.doc_type, f.documento, f.status, sub, id), 'Ya existe un usuario con ese correo o documento.');
    if (f.status === 'inactivo') (await db.run('DELETE FROM sessions WHERE user_id = ?', id));
    await audit(c, 'user.update', `#${id}`);
    return { success: true };
  });

  router.add('POST', '/api/admin/users/:id/reset-password', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    if (!(await db.get(`SELECT 1 FROM users WHERE id = ? AND role IN ('profesor','padre','admin')`, id))) throw new HttpError(404, 'not_found', 'Usuario no encontrado.');
    const temporaryPassword = randomPassword();
    (await db.run('UPDATE users SET password_hash = ?, password_is_default = 1, failed_logins = 0, locked_until = 0 WHERE id = ?', await hashPassword(temporaryPassword, config.scryptCost), id));
    (await db.run('DELETE FROM sessions WHERE user_id = ?', id));
    await audit(c, 'user.reset_password', `#${id}`);
    return { temporaryPassword };
  });

  router.add('DELETE', '/api/admin/users/:id', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    const current = (await db.get(`SELECT * FROM users WHERE id = ? AND role IN ('profesor','padre','admin')`, id));
    if (!current) throw new HttpError(404, 'not_found', 'Usuario no encontrado.');
    await guardAdminChange(c, current, 'delete');
    const used = (await db.get(`SELECT (SELECT COUNT(*) FROM courses WHERE teacher_id = ?) + (SELECT COUNT(*) FROM substitutions WHERE substitute_id = ?)
      + (SELECT COUNT(*) FROM attendance WHERE recorded_by = ?) + (SELECT COUNT(*) FROM excuses WHERE created_by = ? OR resolved_by = ?)
      + (SELECT COUNT(*) FROM feedback WHERE guardian_id = ?) + (SELECT COUNT(*) FROM substitutions WHERE created_by = ?) + (SELECT COUNT(*) FROM notifications WHERE created_by = ?) AS n`, id, id, id, id, id, id, id, id)).n;
    if (used) throw new HttpError(409, 'has_history', 'Este usuario tiene historial en el sistema. Márquelo como inactivo en lugar de eliminarlo.');
    await db.run('DELETE FROM sessions WHERE user_id = ?', id);
    await db.run('DELETE FROM notification_reads WHERE user_id = ?', id);
    await db.run('DELETE FROM users WHERE id = ?', id);
    await audit(c, 'user.delete', `#${id}`);
    return { success: true };
  });
}
