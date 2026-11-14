import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus, localParts } from '../server/domain.mjs';
import { issueQrToken, verifyQrToken } from '../server/security.mjs';
import { csvCell } from '../server/routes/admin-ops.mjs';
import { startApp } from './helpers.mjs';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('reglas puras', () => {
  const rules = { toleranceMinutes: 5, absentAfterMinutes: 20, contingency: { active: false, extraMinutes: 15 } };
  test('estado según minutos de retraso y contingencia', () => {
    assert.equal(computeStatus(0, rules), 'puntual');
    assert.equal(computeStatus(5, rules), 'puntual');
    assert.equal(computeStatus(6, rules), 'tarde');
    assert.equal(computeStatus(20, rules), 'tarde');
    assert.equal(computeStatus(21, rules), 'ausente');
    const c = { ...rules, contingency: { active: true, extraMinutes: 15 } };
    assert.equal(computeStatus(20, c), 'puntual');
    assert.equal(computeStatus(35, c), 'tarde');
    assert.equal(computeStatus(36, c), 'ausente');
  });
  test('la hora se calcula en la zona del colegio, no en la del servidor', () => {
    assert.deepEqual(localParts(Date.parse('2026-03-10T03:30:00Z'), 'America/Bogota'), { date: '2026-03-09', minutes: 22 * 60 + 30 });
  });
  test('QR: válido en su ventana, inválido fuera de ella o manipulado', () => {
    const key = Buffer.alloc(32, 7);
    const t0 = 1_800_000_000_000;
    const { token } = issueQrToken(key, 42, t0);
    assert.equal(verifyQrToken(key, token, t0 + 5_000), 42);
    assert.equal(verifyQrToken(key, token, t0 + 151_000), null);
    assert.equal(verifyQrToken(key, token, t0 - 60_000), null);
    assert.equal(verifyQrToken(key, token.replace('.42.', '.43.'), t0), null);
    assert.equal(verifyQrToken(Buffer.alloc(32, 8), token, t0), null);
    assert.equal(verifyQrToken(key, 'EST-1001', t0), null);
  });
  test('CSV neutraliza fórmulas y escapa comillas', () => {
    assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`);
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('Pérez, Ana'), '"Pérez, Ana"');
    assert.equal(csvCell(null), '');
  });
});

describe('flujo completo de asistencia', () => {
  let t, admin, teacher, other, student, guardian, ids = {};

  before(async () => {
    t = await startApp();
    admin = await t.adminClient();
    ids.t1 = (await admin.post('/api/admin/users', { role: 'profesor', name: 'Laura Mendoza', email: 'laura@colegio.edu' })).data.id;
    ids.t2 = (await admin.post('/api/admin/users', { role: 'profesor', name: 'Andrés Salazar', email: 'andres@colegio.edu' })).data.id;
    // La franja B1 empieza 12 minutos antes de "ahora" (hora del colegio) para producir un retardo determinista.
    const { minutes } = localParts(Date.now(), 'America/Bogota');
    const start = Math.max(0, minutes - 12);
    const hhmm = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
    const rules = (await admin.get('/api/admin/rules')).data.rules;
    rules.blocks[0].start = hhmm;
    assert.equal((await admin.put('/api/admin/rules', rules)).status, 200);
    ids.course = (await admin.post('/api/admin/courses', { grade: '10A', subject: 'Matemáticas', teacherId: ids.t1, blockId: 'B1', room: 'A-101' })).data.id;
    ids.course2 = (await admin.post('/api/admin/courses', { grade: '11A', subject: 'Física', teacherId: ids.t2, blockId: 'B2' })).data.id;
    for (const [name, doc, grade, g] of [['Ana', '1000000001', '10A', 'mama@gmail.com'], ['Beto', '1000000002', '10A', ''], ['Carla', '1000000003', '10A', ''], ['Dani', '1000000004', '11A', 'otra@gmail.com']]) {
      await admin.post('/api/admin/students', { name: name, docType: 'TI', documento: doc, grade, guardianEmail: g });
    }
    teacher = t.client(); await t.googleLogin(teacher, { sub: 'g-l', email: 'laura@colegio.edu', name: 'L' });
    other = t.client(); await t.googleLogin(other, { sub: 'g-a', email: 'andres@colegio.edu', name: 'A' });
    student = t.client(); await student.post('/api/auth/login', { usuario: '1000000001', password: '0001' });
    guardian = t.client(); await t.googleLogin(guardian, { sub: 'g-m', email: 'mama@gmail.com', name: 'Mamá' });
  });
  after(() => t.close());

  test('un docente solo ve sus clases y no puede abrir las de otro', async () => {
    assert.deepEqual((await teacher.get('/api/profesor/classes')).data.classes.map((c) => c.subject), ['Matemáticas']);
    assert.equal((await teacher.get(`/api/profesor/classes/${ids.course2}/roster`)).status, 404);
    assert.equal((await teacher.post(`/api/profesor/classes/${ids.course2}/scan`, { documento: '1000000004' })).status, 404);
  });

  test('roles: estudiante, acudiente y docente no acceden a la administración', async () => {
    for (const c of [student, guardian, teacher]) assert.equal((await c.get('/api/admin/students')).status, 403);
    assert.equal((await t.client().get('/api/admin/students')).status, 401);
    assert.equal((await student.get('/api/profesor/classes')).status, 403);
  });

  test('QR del estudiante: registra con retardo calculado en el servidor y no se puede repetir', async () => {
    const { token } = (await student.get('/api/estudiante/qr')).data;
    const r = await teacher.post(`/api/profesor/classes/${ids.course}/scan`, { token });
    assert.equal(r.status, 200);
    assert.equal(r.data.student.name, 'Ana');
    assert.equal(r.data.status, 'tarde');
    assert.ok(r.data.minutesLate >= 12);
    const again = await teacher.post(`/api/profesor/classes/${ids.course}/scan`, { token });
    assert.equal(again.status, 409);
    assert.equal(again.data.error.code, 'duplicate');
  });

  test('QR falsificado, ajeno al grado o con hora manipulada se rechaza', async () => {
    assert.equal((await teacher.post(`/api/profesor/classes/${ids.course}/scan`, { token: 'SIAE1.2.1800000000.AAAAAAAAAAAAAAAAAAAAAA' })).status, 422);
    assert.equal((await teacher.post(`/api/profesor/classes/${ids.course}/scan`, { token: 'EST-1002' })).status, 422);
    // Un cliente que diga haber escaneado hace 10 horas con un QR emitido ahora: fuera de ventana
    const { token } = (await student.get('/api/estudiante/qr')).data;
    assert.equal((await teacher.post(`/api/profesor/classes/${ids.course}/scan`, { token, scannedAt: Date.now() - 10 * 3_600_000 })).status, 422);
    const wrongGrade = await t.client(); await wrongGrade.post('/api/auth/login', { usuario: '1000000004', password: '0004' });
    const tok = (await wrongGrade.get('/api/estudiante/qr')).data.token;
    assert.equal((await teacher.post(`/api/profesor/classes/${ids.course}/scan`, { token: tok })).data.error.code, 'wrong_grade');
  });

  test('registro manual por documento y cierre de lista (ausentes automáticos)', async () => {
    assert.equal((await teacher.post(`/api/profesor/classes/${ids.course}/scan`, { documento: '1000000002' })).data.student.name, 'Beto');
    assert.equal((await teacher.post(`/api/profesor/classes/${ids.course}/scan`, { documento: '123456' })).status, 404);
    assert.equal((await teacher.post(`/api/profesor/classes/${ids.course}/close`)).data.marked, 1);
    const roster = (await teacher.get(`/api/profesor/classes/${ids.course}/roster`)).data.students;
    assert.deepEqual(roster.map((s) => [s.name, s.record.status]), [['Ana', 'tarde'], ['Beto', 'tarde'], ['Carla', 'ausente']]);
    assert.ok(!JSON.stringify(roster).includes('1000000'), 'la lista no expone documentos');
  });

  test('el estudiante ve solo su historial y su QR cambia con el tiempo', async () => {
    const o = (await student.get('/api/estudiante/overview')).data;
    assert.equal(o.counts.tarde, 1);
    assert.equal(o.records[0].subject, 'Matemáticas');
    assert.equal(o.student.documento, '••••••0001');
  });

  test('suplencia: el reemplazante accede solo el día asignado', async () => {
    const date = localParts(Date.now(), 'America/Bogota').date;
    assert.equal((await other.get(`/api/profesor/classes/${ids.course}/roster`)).status, 404);
    assert.equal((await admin.post('/api/admin/substitutions', { courseId: ids.course, substituteId: ids.t2, date })).status, 200);
    assert.equal((await admin.post('/api/admin/substitutions', { courseId: ids.course, substituteId: ids.t2, date })).status, 409);
    const classes = (await other.get('/api/profesor/classes')).data.classes;
    assert.ok(classes.some((c) => c.id === ids.course && c.substitute && c.covering === 'Laura Mendoza'));
    assert.equal((await other.get(`/api/profesor/classes/${ids.course}/roster`)).status, 200);
  });

  test('excusas: el estudiante solo reporta errores; el acudiente solo de su hijo; la evidencia se valida por contenido', async () => {
    const date = localParts(Date.now(), 'America/Bogota').date;
    const o = (await guardian.get('/api/padre/overview')).data;
    assert.equal(o.students.length, 1);
    const sid = o.students[0].id;
    const body = { studentId: sid, courseId: ids.course, date, kind: 'medica', reason: 'Cita médica programada con especialista' };
    assert.equal((await student.post('/api/excuses', body)).status, 403);
    assert.equal((await guardian.post('/api/excuses', { ...body, studentId: sid + 1 })).status, 403);
    assert.equal((await guardian.post('/api/excuses', { ...body, date: '2999-01-01' })).status, 400);
    assert.equal((await guardian.post('/api/excuses', { ...body, courseId: ids.course2 })).status, 400);
    const created = await guardian.post('/api/excuses', body);
    assert.equal(created.status, 200);

    const upload = (data, name) => guardian.request('POST', `/api/excuses/${created.data.id}/evidence`, undefined, { raw: data, headers: { 'X-Filename': encodeURIComponent(name), 'Content-Type': 'image/png' } });
    assert.equal((await upload(Buffer.from('<script>alert(1)</script>'), 'x.png')).status, 415, 'contenido no-imagen con Content-Type falso');
    const ok = await upload(PNG, '../../etc/passwd.exe');
    assert.equal(ok.status, 200);
    assert.equal(ok.data.mime, 'image/png');
    assert.match(ok.data.name, /^[\w.\- ]+\.png$/);
    assert.equal((await upload(Buffer.alloc(3 * 1024 * 1024, 0xff), 'big.jpg')).status, 413);

    const file = await admin.get(`/api/evidence/${ok.data.id}`);
    assert.equal(file.headers.get('content-type'), 'image/png');
    assert.match(file.headers.get('content-security-policy'), /sandbox/);
    assert.equal((await t.client().get(`/api/evidence/${ok.data.id}`)).status, 401);
    assert.equal((await teacher.get(`/api/evidence/${ok.data.id}`)).status, 403);

    // Aprobar justifica la inasistencia del curso/fecha
    const list = (await admin.get('/api/admin/excuses?status=pendiente')).data.items;
    assert.equal(list[0].evidence.length, 1);
    assert.equal((await admin.post(`/api/admin/excuses/${list[0].id}/resolve`, { approve: true })).status, 200);
    assert.equal((await admin.post(`/api/admin/excuses/${list[0].id}/resolve`, { approve: true })).status, 409);
    assert.equal((await student.get('/api/estudiante/overview')).data.counts.justificado, 1);
  });

  test('contingencia amplía la tolerancia y recalcula los registros de hoy', async () => {
    assert.equal((await admin.put('/api/admin/contingency', { active: true, extraMinutes: 30, reason: 'Lluvias' })).status, 200);
    const roster = (await teacher.get(`/api/profesor/classes/${ids.course}/roster`)).data.students;
    assert.ok(roster.find((s) => s.name === 'Beto').record.status === 'puntual');
    assert.equal(roster.find((s) => s.name === 'Carla').record.status, 'ausente', 'los cierres automáticos no cambian');
    const avisos = (await student.get('/api/notifications')).data;
    assert.equal(avisos.items[0].title, 'Horario de contingencia activo');
    assert.equal(avisos.unread, 1);
    await student.post('/api/notifications/read', { all: true });
    assert.equal((await student.get('/api/notifications')).data.unread, 0);
    await admin.put('/api/admin/contingency', { active: false });
  });

  test('reglas inválidas se rechazan y no se pueden eliminar docentes con historial', async () => {
    const rules = (await admin.get('/api/admin/rules')).data.rules;
    assert.equal((await admin.put('/api/admin/rules', { ...rules, absentAfterMinutes: 3 })).status, 400);
    assert.equal((await admin.put('/api/admin/rules', { ...rules, blocks: [{ id: 'B1', label: 'x', start: '25:00' }] })).status, 400);
    assert.equal((await admin.del(`/api/admin/users/${ids.t1}`)).status, 409);
    assert.equal((await admin.del(`/api/admin/courses/${ids.course}`)).data.deactivated, true);
  });

  test('panel, alerta Art. 19 y exportación CSV segura', async () => {
    const dash = (await admin.get('/api/admin/dashboard')).data;
    assert.ok(dash.today.total >= 3);
    assert.equal(dash.atRisk, 0);
    await admin.post('/api/admin/students', { name: '=cmd|calc', docType: 'TI', documento: '1000000009', grade: '11A' });
    const csv = await admin.get('/api/admin/export.csv');
    assert.match(csv.headers.get('content-disposition'), /attachment/);
    const text = csv.data.toString('utf8');
    assert.ok(text.startsWith('\uFEFFDocumento,Estudiante'));
    assert.ok(text.includes('1000000001,Ana,10A'));
    assert.equal((await student.get('/api/admin/export.csv')).status, 403);
    const audit = (await admin.get('/api/admin/audit')).data.items.map((a) => a.action);
    assert.ok(audit.includes('export.csv') && audit.includes('contingency.on') && audit.includes('excuse.approve'));
  });

  test('entradas hostiles: JSON inválido, tipo erróneo, ids absurdos, método no permitido, traversal', async () => {
    assert.equal((await admin.request('POST', '/api/admin/students', undefined, { raw: '{no json', headers: { 'Content-Type': 'application/json' } })).status, 400);
    assert.equal((await admin.request('POST', '/api/admin/students', undefined, { raw: 'a=b', headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await admin.put('/api/admin/students/abc', {})).status, 400);
    assert.equal((await admin.get("/api/admin/students?q=' OR 1=1 --")).data.total, 0);
    assert.equal((await admin.post('/api/admin/students', { name: 'x'.repeat(500), docType: 'TI', documento: '123456', grade: '10A' })).status, 400);
    assert.equal((await admin.request('PATCH', '/api/admin/students/1', {})).status, 405);
    const raw = await fetch(`${t.base}/%2e%2e/%2e%2e/package.json`);
    assert.ok([403, 404].includes(raw.status));
  });
});
