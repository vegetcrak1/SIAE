// Consultas compartidas entre los módulos de estudiante, acudiente y administración.
import { getRules } from './db.mjs';

export const maskDocumento = (doc) => (doc ? `${'•'.repeat(Math.max(0, doc.length - 4))}${doc.slice(-4)}` : null);

export function courseView(row, rules) {
  const block = rules.blocks.find((b) => b.id === row.block_id);
  return {
    id: row.id, grade: row.grade, subject: row.subject, blockId: row.block_id, room: row.room,
    blockLabel: block?.label ?? row.block_id, start: block?.start ?? null, active: !!row.active,
  };
}

export async function gradeCourses(db, grade) {
  const rules = await getRules(db);
  const rows = await db.all('SELECT * FROM courses WHERE grade = ? AND active = 1 ORDER BY block_id, subject', grade);
  return rows.map((r) => courseView(r, rules));
}

export function studentRecords(db, studentId, limit = 500) {
  return db.all(`SELECT a.id, a.date, a.status, a.minutes_late AS minutesLate, a.scanned_at AS scannedAt, a.method, a.observation,
      a.course_id AS courseId, c.subject
    FROM attendance a JOIN courses c ON c.id = a.course_id WHERE a.student_id = ? ORDER BY a.date DESC, a.id DESC LIMIT ?`, studentId, limit);
}

export async function studentExcuses(db, studentId) {
  const excuses = await db.all(`SELECT e.id, e.date, e.kind, e.reason, e.status, e.created_at AS createdAt, c.subject
    FROM excuses e JOIN courses c ON c.id = e.course_id WHERE e.student_id = ? ORDER BY e.id DESC LIMIT 100`, studentId);
  return Promise.all(excuses.map(async (e) => ({ ...e, evidence: await db.all('SELECT id, name, mime, size FROM evidence WHERE excuse_id = ?', e.id) })));
}

export async function statusCounts(db, studentId) {
  const counts = { puntual: 0, tarde: 0, ausente: 0, justificado: 0 };
  for (const r of await db.all('SELECT status, COUNT(*) AS n FROM attendance WHERE student_id = ? GROUP BY status', studentId)) counts[r.status] = r.n;
  return counts;
}
