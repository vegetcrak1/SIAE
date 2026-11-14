// Estudiante y acudiente: consulta de asistencia, carnet QR, excusas, evidencias y mensajes.
import { HttpError } from '../http.mjs';
import * as v from '../domain.mjs';
import { issueQrToken } from '../security.mjs';
import { gradeCourses, maskDocumento, statusCounts, studentExcuses, studentRecords } from '../queries.mjs';
import { getRules } from '../db.mjs';

const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;
const MAX_FILES_PER_EXCUSE = 3;
const MAX_PENDING_EXCUSES = 30;

/** Detecta el tipo real por los primeros bytes; ignora el Content-Type declarado por el cliente. */
function sniffMime(buf) {
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length > 5 && buf.toString('latin1', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

export function studentRoutes(router, { db, config, qrKey }) {
  const linkedStudents = (guardian) => db.all("SELECT * FROM users WHERE role = 'estudiante' AND guardian_email = ? ORDER BY name", guardian.email);

  router.add('GET', '/api/estudiante/overview', { roles: ['estudiante'] }, async (c) => {
    const s = c.user;
    const [courses, records, excuses, counts, rules] = await Promise.all([gradeCourses(db, s.grade), studentRecords(db, s.id), studentExcuses(db, s.id), statusCounts(db, s.id), getRules(db)]);
    return {
      today: v.localParts(Date.now(), config.tz).date,
      student: { name: s.name, grade: s.grade, documento: maskDocumento(s.documento) },
      courses, records, excuses, counts, riskThreshold: rules.riskThreshold,
    };
  });

  router.add('GET', '/api/estudiante/qr', { roles: ['estudiante'] }, (c) => issueQrToken(qrKey, c.user.id));

  router.add('GET', '/api/padre/overview', { roles: ['padre'] }, async (c) => {
    const riskThreshold = (await getRules(db)).riskThreshold;
    const students = await Promise.all((await linkedStudents(c.user)).map(async (s) => {
      const [courses, records, excuses, counts] = await Promise.all([s.status === 'activo' ? gradeCourses(db, s.grade) : [], studentRecords(db, s.id), studentExcuses(db, s.id), statusCounts(db, s.id)]);
      return { id: s.id, name: s.name, grade: s.grade, status: s.status, documento: maskDocumento(s.documento), courses, records: records.filter((r) => r.status !== 'puntual'), excuses, counts };
    }));
    return { riskThreshold, today: v.localParts(Date.now(), config.tz).date, students };
  });

  router.add('POST', '/api/excuses', { roles: ['estudiante', 'padre'] }, async (c) => {
    const body = await c.json();
    const user = c.user;
    let student;
    if (user.role === 'estudiante') {
      student = user;
      if (body.kind !== 'error_registro') throw new HttpError(403, 'forbidden', 'Las excusas de inasistencia las presenta el acudiente.');
    } else {
      student = (await linkedStudents(user)).find((s) => s.id === Number(body.studentId));
      if (!student) throw new HttpError(403, 'forbidden', 'No tienes acceso a ese estudiante.');
    }
    const kind = v.oneOf(body.kind, ['medica', 'personal', 'error_registro'], 'El tipo de solicitud');
    const date = v.isoDate(body.date);
    const today = v.localParts(Date.now(), config.tz).date;
    if (date > today) throw new HttpError(400, 'invalid', 'La fecha no puede ser futura.');
    if (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`) > 60 * 86_400_000) {
      throw new HttpError(400, 'invalid', 'Solo se pueden presentar solicitudes de los últimos 60 días.');
    }
    const course = await db.get('SELECT * FROM courses WHERE id = ? AND active = 1', v.id(body.courseId, 'La asignatura'));
    if (!course || course.grade !== student.grade) throw new HttpError(400, 'invalid', 'La asignatura no corresponde al grado del estudiante.');
    const reason = v.text(body.reason, 'La descripción', { min: 10, max: 1000, multiline: true });
    const pending = (await db.get("SELECT COUNT(*) AS n FROM excuses WHERE student_id = ? AND status = 'pendiente'", student.id)).n;
    if (pending >= MAX_PENDING_EXCUSES) throw new HttpError(429, 'too_many', 'Hay demasiadas solicitudes pendientes. Espera a que la administración las revise.');
    const result = await db.run('INSERT INTO excuses (student_id, course_id, date, kind, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      student.id, course.id, date, kind, reason, user.id, Date.now());
    return { id: result.lastInsertRowid };
  });

  // Carga binaria directa (sin multipart). Solo imágenes JPEG/PNG/WebP y PDF, validadas por contenido.
  router.add('POST', '/api/excuses/:id/evidence', { roles: ['estudiante', 'padre'] }, async (c) => {
    const excuse = await db.get('SELECT * FROM excuses WHERE id = ? AND created_by = ?', v.id(c.params.id), c.user.id);
    if (!excuse) throw new HttpError(404, 'not_found', 'Solicitud no encontrada.');
    if (excuse.status !== 'pendiente') throw new HttpError(409, 'closed', 'La solicitud ya fue resuelta.');
    if ((await db.get('SELECT COUNT(*) AS n FROM evidence WHERE excuse_id = ?', excuse.id)).n >= MAX_FILES_PER_EXCUSE) {
      throw new HttpError(409, 'too_many', `Máximo ${MAX_FILES_PER_EXCUSE} archivos por solicitud.`);
    }
    const data = await c.raw(MAX_EVIDENCE_BYTES);
    const type = sniffMime(data);
    if (!type) throw new HttpError(415, 'unsupported', 'Solo se admiten imágenes (JPG, PNG, WebP) o PDF.');
    let name = 'evidencia';
    try { name = decodeURIComponent(String(c.req.headers['x-filename'] ?? '')); } catch { /* nombre por defecto */ }
    name = `${name.replace(/[^\p{L}\p{N}._ -]/gu, '').replace(/\.[^.]*$/, '').trim().slice(0, 60) || 'evidencia'}.${type.ext}`;
    const result = await db.run('INSERT INTO evidence (excuse_id, name, mime, size, data) VALUES (?, ?, ?, ?, ?)', excuse.id, name, type.mime, data.length, data);
    return { id: result.lastInsertRowid, name, mime: type.mime, size: data.length };
  });

  router.add('GET', '/api/evidence/:id', { roles: ['estudiante', 'padre', 'admin'] }, async (c) => {
    const file = await db.get('SELECT ev.*, e.created_by, e.student_id FROM evidence ev JOIN excuses e ON e.id = ev.excuse_id WHERE ev.id = ?', v.id(c.params.id));
    const allowed = file && (c.user.role === 'admin' || file.created_by === c.user.id || file.student_id === c.user.id);
    if (!allowed) throw new HttpError(404, 'not_found', 'Archivo no encontrado.');
    const inline = file.mime.startsWith('image/');
    return c.send(200, Buffer.from(file.data), {
      'Content-Type': file.mime,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
  });

  router.add('POST', '/api/feedback', { roles: ['padre'] }, async (c) => {
    const body = await c.json();
    const student = (await linkedStudents(c.user)).find((s) => s.id === Number(body.studentId));
    if (!student) throw new HttpError(403, 'forbidden', 'No tienes acceso a ese estudiante.');
    const message = v.text(body.text, 'El mensaje', { min: 10, max: 1500, multiline: true });
    const recent = (await db.get('SELECT COUNT(*) AS n FROM feedback WHERE guardian_id = ? AND created_at > ?', c.user.id, Date.now() - 3_600_000)).n;
    if (recent >= 5) throw new HttpError(429, 'too_many', 'Has enviado varios mensajes seguidos. Intenta más tarde.');
    await db.run('INSERT INTO feedback (guardian_id, student_id, text, created_at) VALUES (?, ?, ?, ?)', c.user.id, student.id, message, Date.now());
    return { success: true };
  });
}
