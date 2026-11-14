// Administración: panel, riesgo (Art. 19), excusas, mensajes, reglas, contingencia, avisos, auditoría y exportación.
import { HttpError } from '../http.mjs';
import * as v from '../domain.mjs';
import { getRules, saveRules } from '../db.mjs';
import { recomputeToday } from '../attendance.mjs';

const ADMIN = { roles: ['admin'] };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Celdas CSV seguras: evita inyección de fórmulas en Excel/Sheets y escapa comillas. */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const emptyCounts = () => ({ puntual: 0, tarde: 0, ausente: 0, justificado: 0 });
const withTotal = (c) => ({ ...c, total: c.puntual + c.tarde + c.ausente + c.justificado });
const rate = (c) => ({ attendance: pct(c.puntual + c.tarde + c.justificado, c.total), punctuality: pct(c.puntual, c.puntual + c.tarde) });

export function operationsRoutes(router, { db, config, auth }) {
  const audit = (c, action, detail) => auth.audit(c.user.id, action, detail, c.ip);
  const today = () => v.localParts(Date.now(), config.tz).date;
  const tzCtx = { db, tz: config.tz };

  async function riskList() {
    const threshold = (await getRules(db)).riskThreshold;
    return db.all(`SELECT u.id, u.name, u.grade, u.guardian_phone AS guardianPhone,
        SUM(a.status = 'tarde') AS lates, SUM(a.status = 'ausente') AS absences
      FROM users u JOIN attendance a ON a.student_id = u.id WHERE u.role = 'estudiante' AND u.status = 'activo'
      GROUP BY u.id HAVING lates >= ? OR absences >= ? ORDER BY (lates + absences) DESC`, threshold, threshold);
  }

  router.add('GET', '/api/admin/dashboard', ADMIN, async () => {
    const date = today();
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    // Consultas agrupadas (pocas idas y vueltas a la base de datos, importante cuando es remota).
    const [todayRows, expectedRow, dateRows, courseList, courseRows, recent, pendingReg, pendingExc, risk] = await Promise.all([
      db.all('SELECT status, COUNT(*) AS n FROM attendance WHERE date = ? GROUP BY status', date),
      db.get("SELECT COUNT(*) AS n FROM courses c JOIN users u ON u.role = 'estudiante' AND u.status = 'activo' AND u.grade = c.grade WHERE c.active = 1"),
      db.all('SELECT date, status, COUNT(*) AS n FROM attendance WHERE date IN (SELECT date FROM (SELECT DISTINCT date FROM attendance ORDER BY date DESC LIMIT 10)) GROUP BY date, status'),
      db.all('SELECT id, grade, subject FROM courses WHERE active = 1 ORDER BY grade, subject'),
      db.all('SELECT course_id, status, COUNT(*) AS n FROM attendance WHERE date >= ? GROUP BY course_id, status', since),
      db.all(`SELECT a.id, a.status, a.method, a.scanned_at AS scannedAt, u.name AS student, c.subject, c.grade
        FROM attendance a JOIN users u ON u.id = a.student_id JOIN courses c ON c.id = a.course_id
        WHERE a.date = ? AND a.method != 'auto' ORDER BY a.id DESC LIMIT 8`, date),
      db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'estudiante' AND status = 'pendiente'"),
      db.get("SELECT COUNT(*) AS n FROM excuses WHERE status = 'pendiente'"),
      riskList(),
    ]);

    const todayCounts = emptyCounts();
    for (const r of todayRows) todayCounts[r.status] = r.n;

    const perDate = new Map();
    for (const r of dateRows) { if (!perDate.has(r.date)) perDate.set(r.date, emptyCounts()); perDate.get(r.date)[r.status] = r.n; }
    const days = [...perDate.keys()].sort().map((d) => ({ date: d, ...rate(withTotal(perDate.get(d))) }));

    const perCourse = new Map();
    for (const r of courseRows) { if (!perCourse.has(r.course_id)) perCourse.set(r.course_id, emptyCounts()); perCourse.get(r.course_id)[r.status] = r.n; }
    const courses = courseList.map((c) => { const cc = withTotal(perCourse.get(c.id) ?? emptyCounts()); return { ...c, records: cc.total, ...rate(cc) }; });

    return {
      date, today: { ...withTotal(todayCounts), expected: expectedRow.n }, days, courses, recent,
      pendingRegistrations: pendingReg.n, pendingExcuses: pendingExc.n, atRisk: risk.length,
    };
  });

  router.add('GET', '/api/admin/risk', ADMIN, async () => ({ threshold: (await getRules(db)).riskThreshold, items: await riskList() }));

  // ---------- Excusas ----------
  router.add('GET', '/api/admin/excuses', ADMIN, async (c) => {
    const status = ['pendiente', 'aprobada', 'rechazada'].includes(c.query.status) ? c.query.status : null;
    const rows = await db.all(`SELECT e.id, e.date, e.kind, e.reason, e.status, e.created_at AS createdAt, u.name AS student, u.grade, u.guardian_phone AS guardianPhone, co.subject
      FROM excuses e JOIN users u ON u.id = e.student_id JOIN courses co ON co.id = e.course_id
      ${status ? 'WHERE e.status = ?' : ''} ORDER BY (e.status = 'pendiente') DESC, e.id DESC LIMIT 200`, ...(status ? [status] : []));
    const files = rows.length ? await db.all(`SELECT id, excuse_id, name, mime, size FROM evidence WHERE excuse_id IN (${rows.map(() => '?').join(',')})`, ...rows.map((r) => r.id)) : [];
    return { items: rows.map((r) => ({ ...r, evidence: files.filter((f) => f.excuse_id === r.id).map(({ excuse_id, ...f }) => f) })) };
  });

  router.add('POST', '/api/admin/excuses/:id/resolve', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    const approve = (await c.json()).approve === true;
    await db.transaction(async (tx) => {
      const e = await tx.get('SELECT * FROM excuses WHERE id = ?', id);
      if (!e) throw new HttpError(404, 'not_found', 'Solicitud no encontrada.');
      if (e.status !== 'pendiente') throw new HttpError(409, 'closed', 'La solicitud ya fue resuelta.');
      await tx.run('UPDATE excuses SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?', approve ? 'aprobada' : 'rechazada', c.user.id, Date.now(), id);
      if (approve && e.kind !== 'error_registro') {
        const note = `Excusa ${e.kind === 'medica' ? 'médica' : 'personal'} aprobada`;
        const existing = await tx.get('SELECT id FROM attendance WHERE student_id = ? AND course_id = ? AND date = ?', e.student_id, e.course_id, e.date);
        if (existing) await tx.run("UPDATE attendance SET status = 'justificado', observation = ? WHERE id = ?", note, existing.id);
        else await tx.run("INSERT INTO attendance (student_id, course_id, date, status, method, observation, recorded_by) VALUES (?, ?, ?, 'justificado', 'auto', ?, ?)", e.student_id, e.course_id, e.date, note, c.user.id);
      }
    });
    await audit(c, approve ? 'excuse.approve' : 'excuse.reject', `#${id}`);
    return { success: true };
  });

  router.add('GET', '/api/admin/feedback', ADMIN, async () => ({
    items: await db.all(`SELECT f.id, f.text, f.created_at AS createdAt, g.name AS guardian, s.name AS student, s.grade, s.guardian_phone AS guardianPhone
      FROM feedback f JOIN users g ON g.id = f.guardian_id JOIN users s ON s.id = f.student_id ORDER BY f.id DESC LIMIT 200`),
  }));

  // ---------- Reglas y contingencia ----------
  router.add('GET', '/api/admin/rules', ADMIN, async () => {
    const rules = await getRules(db);
    return { rules, limits: v.effectiveLimits(rules) };
  });

  router.add('PUT', '/api/admin/rules', ADMIN, async (c) => {
    const checked = v.validateRules(await c.json());
    const next = { ...checked, contingency: (await getRules(db)).contingency };
    await db.transaction(async (tx) => {
      await saveRules(tx, next);
      await recomputeToday(tzCtx, tx);
    });
    await audit(c, 'rules.update', '');
    return { rules: next };
  });

  router.add('PUT', '/api/admin/contingency', ADMIN, async (c) => {
    const body = await c.json();
    const rules = await getRules(db);
    const active = body.active === true;
    const extraMinutes = Number(body.extraMinutes);
    if (active && (!Number.isInteger(extraMinutes) || extraMinutes < 5 || extraMinutes > 120)) throw new HttpError(400, 'invalid', 'Los minutos extra deben estar entre 5 y 120.');
    const reason = active ? v.text(body.reason ?? 'Evento institucional', 'El motivo', { max: 120 }) : rules.contingency.reason;
    rules.contingency = active
      ? { active: true, extraMinutes, reason, activatedAt: Date.now() }
      : { ...rules.contingency, active: false, activatedAt: null };
    await db.transaction(async (tx) => {
      await saveRules(tx, rules);
      await recomputeToday(tzCtx, tx);
      await tx.run('INSERT INTO notifications (title, body, level, audience, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        active ? 'Horario de contingencia activo' : 'Horario de contingencia finalizado',
        active ? `${reason}. Se amplía la tolerancia ${extraMinutes} minutos; los registros de hoy se recalcularon.` : 'Vuelven a regir los tiempos de tolerancia habituales.',
        active ? 'critical' : 'info', 'all', c.user.id, Date.now());
    });
    await audit(c, active ? 'contingency.on' : 'contingency.off', reason);
    return { rules };
  });

  // ---------- Avisos ----------
  router.add('GET', '/api/admin/notifications', ADMIN, async () => ({
    items: await db.all('SELECT id, title, body, level, audience, created_at AS createdAt FROM notifications ORDER BY id DESC LIMIT 100'),
  }));

  router.add('POST', '/api/admin/notifications', ADMIN, async (c) => {
    const b = await c.json();
    const result = await db.run('INSERT INTO notifications (title, body, level, audience, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      v.text(b.title, 'El título', { max: 100 }), v.text(b.body, 'El mensaje', { max: 600, multiline: true }),
      v.oneOf(b.level, ['info', 'warning', 'critical'], 'El nivel'), v.oneOf(b.audience, ['all', 'profesor', 'estudiante', 'padre'], 'Los destinatarios'), c.user.id, Date.now());
    await audit(c, 'notification.create', `#${result.lastInsertRowid}`);
    return { id: result.lastInsertRowid };
  });

  router.add('DELETE', '/api/admin/notifications/:id', ADMIN, async (c) => {
    const id = v.id(c.params.id);
    await db.run('DELETE FROM notification_reads WHERE notification_id = ?', id);
    await db.run('DELETE FROM notifications WHERE id = ?', id);
    await audit(c, 'notification.delete', `#${id}`);
    return { success: true };
  });

  // ---------- Auditoría y exportación ----------
  router.add('GET', '/api/admin/audit', ADMIN, async () => ({
    items: await db.all('SELECT l.id, l.at, l.action, l.detail, l.ip, u.name AS user FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 200'),
  }));

  router.add('GET', '/api/admin/export.csv', ADMIN, async (c) => {
    const to = c.query.to ? v.isoDate(c.query.to) : today();
    const from = c.query.from ? v.isoDate(c.query.from) : new Date(Date.parse(`${to}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10);
    const rows = await db.all(`SELECT u.documento, u.name, u.grade, co.subject, a.date, a.scanned_at, a.status, a.minutes_late, a.method, a.observation
      FROM attendance a JOIN users u ON u.id = a.student_id JOIN courses co ON co.id = a.course_id
      WHERE a.date BETWEEN ? AND ? ORDER BY a.date, u.grade, u.name`, from, to);
    const header = ['Documento', 'Estudiante', 'Grado', 'Asignatura', 'Fecha', 'Hora', 'Estado', 'Minutos tarde', 'Método', 'Observación'];
    const time = (ms) => (ms ? new Intl.DateTimeFormat('es', { timeZone: config.tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(ms) : '');
    const lines = [header, ...rows.map((r) => [r.documento, r.name, r.grade, r.subject, r.date, time(r.scanned_at), r.status, r.minutes_late ?? '', r.method, r.observation])];
    await audit(c, 'export.csv', `${from}..${to} (${rows.length})`);
    return c.send(200, Buffer.from(`\uFEFF${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`, 'utf8'), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="asistencia_${from}_${to}.csv"`,
    });
  });
}
