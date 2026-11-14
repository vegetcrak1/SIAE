// Registro de asistencia: lógica compartida por escaneo QR, ingreso manual y cierre de lista.
import { HttpError } from './http.mjs';
import { computeStatus, hhmmToMinutes, localParts } from './domain.mjs';
import { getRules } from './db.mjs';

const MAX_PAST_MS = 24 * 3_600_000;
const MAX_FUTURE_MS = 60_000;

export const blockStart = (rules, blockId) => rules.blocks.find((b) => b.id === blockId)?.start ?? null;

/** Un docente puede registrar en su curso, o en uno que cubre ese día por suplencia. Devuelve null si no tiene permiso. */
export async function teachingAccess(db, user, course, date) {
  if (course.teacher_id === user.id) return { substitute: 0 };
  const sub = await db.get('SELECT 1 AS ok FROM substitutions WHERE course_id = ? AND substitute_id = ? AND date = ?', course.id, user.id, date);
  return sub ? { substitute: 1 } : null;
}

/** Acepta la hora del escaneo del cliente (cola sin conexión) solo si es plausible; si no, usa la del servidor. */
export function trustedScanTime(claimed, now = Date.now()) {
  if (!Number.isFinite(claimed)) return now;
  return claimed <= now + MAX_FUTURE_MS && claimed >= now - MAX_PAST_MS ? Math.min(claimed, now) : now;
}

export async function registerArrival({ db, tz }, { course, student, scannedAt, method, recordedBy, substitute }) {
  const rules = await getRules(db);
  const start = blockStart(rules, course.block_id);
  if (!start) throw new HttpError(409, 'no_block', 'La franja horaria de este curso ya no existe. Avise a la administración.');
  const { date, minutes } = localParts(scannedAt, tz);
  const minutesLate = Math.max(0, minutes - hhmmToMinutes(start));
  const status = computeStatus(minutesLate, rules);

  const existing = await db.get('SELECT * FROM attendance WHERE student_id = ? AND course_id = ? AND date = ?', student.id, course.id, date);
  if (existing && existing.method !== 'auto') {
    throw new HttpError(409, 'duplicate', `${student.name} ya fue registrado (${existing.status}).`, { status: existing.status });
  }
  if (existing) {
    await db.run('UPDATE attendance SET scanned_at = ?, minutes_late = ?, status = ?, method = ?, recorded_by = ?, substitute = ? WHERE id = ?',
      scannedAt, minutesLate, status, method, recordedBy, substitute, existing.id);
  } else {
    try {
      await db.run('INSERT INTO attendance (student_id, course_id, date, scanned_at, minutes_late, status, method, recorded_by, substitute) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        student.id, course.id, date, scannedAt, minutesLate, status, method, recordedBy, substitute);
    } catch (err) {
      // Dos escaneos simultáneos del mismo carnet: el segundo choca con la restricción UNIQUE.
      if (/UNIQUE constraint/i.test(String(err?.message))) throw new HttpError(409, 'duplicate', `${student.name} ya fue registrado.`);
      throw err;
    }
  }
  return { status, minutesLate, scannedAt, date };
}

/** Marca como ausentes a quienes no tienen registro hoy en el curso. */
export async function closeRoll({ db, tz }, { course, recordedBy, substitute }) {
  const { date } = localParts(Date.now(), tz);
  const result = await db.run(`INSERT INTO attendance (student_id, course_id, date, status, method, recorded_by, substitute)
    SELECT u.id, ?, ?, 'ausente', 'auto', ?, ? FROM users u
    WHERE u.role = 'estudiante' AND u.status = 'activo' AND u.grade = ?
      AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.student_id = u.id AND a.course_id = ? AND a.date = ?)`,
    course.id, date, recordedBy, substitute, course.grade, course.id, date);
  return result.changes;
}

/** Recalcula los estados de hoy (excepto cierres automáticos y justificados) tras cambiar reglas o contingencia. */
export async function recomputeToday({ db, tz }, tx = db) {
  const rules = await getRules(tx);
  const { date } = localParts(Date.now(), tz);
  const rows = await tx.all(`SELECT a.id, a.minutes_late FROM attendance a WHERE a.date = ? AND a.method != 'auto' AND a.status != 'justificado'`, date);
  for (const r of rows) await tx.run('UPDATE attendance SET status = ? WHERE id = ?', computeStatus(r.minutes_late ?? 0, rules), r.id);
}
