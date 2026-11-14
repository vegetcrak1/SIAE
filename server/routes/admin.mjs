// Administración: cursos y suplencias. (Personas: admin-people.mjs · Operaciones y reportes: admin-ops.mjs)
import { HttpError } from '../http.mjs';
import * as v from '../domain.mjs';
import { getRules } from '../db.mjs';
import { courseView } from '../queries.mjs';
import { operationsRoutes } from './admin-ops.mjs';
import { peopleRoutes } from './admin-people.mjs';
import { unique } from './util.mjs';

const ADMIN = { roles: ['admin'] };

export function adminRoutes(router, ctx) {
  const { db, config, auth } = ctx;
  const audit = (c, action, detail) => auth.audit(c.user.id, action, detail, c.ip);
  const today = () => v.localParts(Date.now(), config.tz).date;

  // ---------- Cursos ----------
  const courseFields = async (body) => {
    const rules = await getRules(db);
    const teacherId = v.id(body.teacherId, 'El profesor');
    if (!(await db.get("SELECT 1 AS ok FROM users WHERE id = ? AND role = 'profesor' AND status = 'activo'", teacherId))) throw new HttpError(400, 'invalid', 'El profesor no existe o está inactivo.');
    const blockId = String(body.blockId ?? '');
    if (!rules.blocks.some((b) => b.id === blockId)) throw new HttpError(400, 'invalid', 'La franja horaria no existe.');
    return { grade: v.grade(body.grade), subject: v.text(body.subject, 'La asignatura', { max: 60 }), teacherId, blockId, room: v.optionalText(body.room, 'El aula', { max: 20 }), active: body.active === false ? 0 : 1 };
  };

  router.add('GET', '/api/admin/courses', ADMIN, async () => {
    const rules = await getRules(db);
    const rows = await db.all('SELECT c.*, t.name AS teacher FROM courses c JOIN users t ON t.id = c.teacher_id ORDER BY c.active DESC, c.grade, c.block_id');
    return { blocks: rules.blocks, items: rows.map((r) => ({ ...courseView(r, rules), teacherId: r.teacher_id, teacher: r.teacher })) };
  });

  router.add('POST', '/api/admin/courses', ADMIN, async (c) => {
    const f = await courseFields(await c.json());
    const result = await db.run('INSERT INTO courses (grade, subject, teacher_id, block_id, room, active) VALUES (?, ?, ?, ?, ?, ?)', f.grade, f.subject, f.teacherId, f.blockId, f.room, f.active);
    await audit(c, 'course.create', `#${result.lastInsertRowid}`);
    return { id: result.lastInsertRowid };
  });

  router.add('PUT', '/api/admin/courses/:id', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    if (!(await db.get('SELECT 1 AS ok FROM courses WHERE id = ?', id))) throw new HttpError(404, 'not_found', 'Curso no encontrado.');
    const f = await courseFields(await c.json());
    await db.run('UPDATE courses SET grade = ?, subject = ?, teacher_id = ?, block_id = ?, room = ?, active = ? WHERE id = ?', f.grade, f.subject, f.teacherId, f.blockId, f.room, f.active, id);
    await audit(c, 'course.update', `#${id}`);
    return { success: true };
  });

  router.add('DELETE', '/api/admin/courses/:id', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    const { n: used } = await db.get('SELECT (SELECT COUNT(*) FROM attendance WHERE course_id = ?) + (SELECT COUNT(*) FROM excuses WHERE course_id = ?) AS n', id, id);
    if (used) {
      await db.run('UPDATE courses SET active = 0 WHERE id = ?', id);
      await audit(c, 'course.deactivate', `#${id}`);
      return { deactivated: true };
    }
    await db.run('DELETE FROM substitutions WHERE course_id = ?', id);
    await db.run('DELETE FROM courses WHERE id = ?', id);
    await audit(c, 'course.delete', `#${id}`);
    return { deleted: true };
  });

  router.add('GET', '/api/admin/courses/:id/attendance', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    const status = v.STATUSES.includes(c.query.status) ? c.query.status : null;
    const items = await db.all(`SELECT a.id, a.date, a.status, a.minutes_late AS minutesLate, a.scanned_at AS scannedAt, a.method, a.observation, u.name AS student
      FROM attendance a JOIN users u ON u.id = a.student_id WHERE a.course_id = ? ${status ? 'AND a.status = ?' : ''} ORDER BY a.date DESC, u.name LIMIT 300`,
      ...(status ? [id, status] : [id]));
    return { items };
  });

  // ---------- Suplencias ----------
  router.add('GET', '/api/admin/substitutions', ADMIN, async () => ({
    today: today(),
    items: await db.all(`SELECT s.id, s.date, c.subject, c.grade, t.name AS titular, sub.name AS substitute
      FROM substitutions s JOIN courses c ON c.id = s.course_id JOIN users t ON t.id = c.teacher_id JOIN users sub ON sub.id = s.substitute_id
      WHERE s.date >= ? ORDER BY s.date, c.grade`, today()),
  }));

  router.add('POST', '/api/admin/substitutions', ADMIN, async (c) => {
    const body = await c.json();
    const courseId = v.id(body.courseId, 'El curso');
    const substituteId = v.id(body.substituteId, 'El profesor reemplazante');
    const date = v.isoDate(body.date);
    if (date < today()) throw new HttpError(400, 'invalid', 'La fecha no puede ser anterior a hoy.');
    const course = await db.get('SELECT * FROM courses WHERE id = ? AND active = 1', courseId);
    if (!course) throw new HttpError(400, 'invalid', 'El curso no existe.');
    if (!(await db.get("SELECT 1 AS ok FROM users WHERE id = ? AND role = 'profesor' AND status = 'activo'", substituteId))) throw new HttpError(400, 'invalid', 'El profesor reemplazante no existe o está inactivo.');
    if (course.teacher_id === substituteId) throw new HttpError(400, 'invalid', 'El reemplazante debe ser distinto del titular.');
    const result = await unique(() => db.run('INSERT INTO substitutions (course_id, substitute_id, date, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      courseId, substituteId, date, c.user.id, Date.now()), 'Ese curso ya tiene un reemplazo para esa fecha.');
    await audit(c, 'substitution.create', `#${result.lastInsertRowid}`);
    return { id: result.lastInsertRowid };
  });

  router.add('DELETE', '/api/admin/substitutions/:id', ADMIN, async (c) => {
    await db.run('DELETE FROM substitutions WHERE id = ?', v.id(c.params.id));
    await audit(c, 'substitution.delete', `#${c.params.id}`);
    return { success: true };
  });

  peopleRoutes(router, ctx);
  operationsRoutes(router, ctx);
}
