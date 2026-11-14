// Docente: clases del día, lista, registro por QR o documento y cierre de lista.
import { HttpError } from '../http.mjs';
import * as v from '../domain.mjs';
import { getRules } from '../db.mjs';
import { verifyQrToken } from '../security.mjs';
import { closeRoll, registerArrival, teachingAccess, trustedScanTime } from '../attendance.mjs';
import { courseView } from '../queries.mjs';

export function teacherRoutes(router, { db, config, qrKey }) {
  const today = () => v.localParts(Date.now(), config.tz).date;

  async function accessibleCourse(user, courseId) {
    const course = await db.get('SELECT * FROM courses WHERE id = ? AND active = 1', v.id(courseId, 'La clase'));
    const access = course && await teachingAccess(db, user, course, today());
    if (!course || !access) throw new HttpError(404, 'not_found', 'Clase no encontrada.');
    return { course, ...access };
  }

  router.add('GET', '/api/profesor/classes', { roles: ['profesor'] }, async (c) => {
    const rules = await getRules(db);
    const date = today();
    const rows = await db.all(`SELECT c.*, 0 AS substitute, NULL AS covering FROM courses c WHERE c.teacher_id = ? AND c.active = 1
      UNION ALL
      SELECT c.*, 1 AS substitute, t.name AS covering FROM substitutions s JOIN courses c ON c.id = s.course_id JOIN users t ON t.id = c.teacher_id
      WHERE s.substitute_id = ? AND s.date = ? AND c.active = 1`, c.user.id, c.user.id, date);
    const classes = rows.map((r) => ({ ...courseView(r, rules), substitute: !!r.substitute, covering: r.covering }))
      .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '') || a.grade.localeCompare(b.grade));
    return { date, classes };
  });

  router.add('GET', '/api/profesor/classes/:id/roster', { roles: ['profesor'] }, async (c) => {
    const { course } = await accessibleCourse(c.user, c.params.id);
    const rules = await getRules(db);
    const date = today();
    const students = await db.all(`SELECT u.id, u.name, a.status, a.minutes_late AS minutesLate, a.scanned_at AS scannedAt, a.method
      FROM users u LEFT JOIN attendance a ON a.student_id = u.id AND a.course_id = ? AND a.date = ?
      WHERE u.role = 'estudiante' AND u.status = 'activo' AND u.grade = ? ORDER BY u.name`, course.id, date, course.grade);
    return {
      date, course: courseView(course, rules), limits: v.effectiveLimits(rules), contingency: rules.contingency.active ? rules.contingency.reason : null,
      students: students.map((s) => ({ id: s.id, name: s.name, record: s.status ? { status: s.status, minutesLate: s.minutesLate, scannedAt: s.scannedAt, method: s.method } : null })),
    };
  });

  router.add('POST', '/api/profesor/classes/:id/scan', { roles: ['profesor'] }, async (c) => {
    const { course, substitute } = await accessibleCourse(c.user, c.params.id);
    const body = await c.json();
    const scannedAt = trustedScanTime(Number(body.scannedAt));
    let student;
    let method;
    if (typeof body.token === 'string') {
      method = 'qr';
      const studentId = verifyQrToken(qrKey, body.token, scannedAt);
      if (!studentId) throw new HttpError(422, 'bad_qr', 'Código QR inválido o vencido. Pida al estudiante que lo actualice en su celular.');
      student = await db.get("SELECT * FROM users WHERE id = ? AND role = 'estudiante'", studentId);
    } else {
      method = 'manual';
      student = await db.get("SELECT * FROM users WHERE documento = ? AND role = 'estudiante'", v.documento(body.documento));
      if (!student) throw new HttpError(404, 'unknown_student', 'No existe un estudiante con ese documento.');
    }
    if (!student) throw new HttpError(422, 'bad_qr', 'Código QR inválido.');
    if (student.status === 'pendiente') throw new HttpError(409, 'pendiente', 'El registro de este estudiante aún no ha sido aprobado.');
    if (student.status !== 'activo') throw new HttpError(409, 'inactivo', 'El estudiante está inactivo en el sistema.');
    if (student.grade !== course.grade) throw new HttpError(409, 'wrong_grade', `El estudiante no pertenece a ${course.grade}.`);
    const result = await registerArrival({ db, tz: config.tz }, { course, student, scannedAt, method, recordedBy: c.user.id, substitute });
    return { student: { id: student.id, name: student.name }, ...result };
  });

  router.add('POST', '/api/profesor/classes/:id/close', { roles: ['profesor'] }, async (c) => {
    const { course, substitute } = await accessibleCourse(c.user, c.params.id);
    return { marked: await closeRoll({ db, tz: config.tz }, { course, recordedBy: c.user.id, substitute }) };
  });
}
