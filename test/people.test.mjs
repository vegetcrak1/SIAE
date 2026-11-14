import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.mjs';

describe('importación masiva de estudiantes', () => {
  let t, admin;
  before(async () => { t = await startApp(); admin = await t.adminClient(); });
  after(() => t.close());

  test('crea las filas válidas y reporta las inválidas y repetidas con su línea', async () => {
    const rows = [
      { line: 2, name: 'Ana Pérez', docType: 'ti', documento: '1098765432', grade: '10a', guardianEmail: 'papa@correo.com', guardianPhone: '3001234567' },
      { line: 3, name: 'Beto Ríos', documento: '1098765433', grade: '10A' },
      { line: 4, name: 'Sin Documento', documento: '12', grade: '10A' },
      { line: 5, name: 'Repetido', documento: '1098765432', grade: '10A' },
      { line: 6, name: 'Correo Malo', documento: '1098765444', grade: '10A', guardianEmail: 'no-es-correo' },
    ];
    const r = await admin.post('/api/admin/students/import', { rows });
    assert.equal(r.status, 200);
    assert.equal(r.data.created, 2);
    assert.deepEqual(r.data.skipped.map((s) => s.line), [4, 5, 6]);
    assert.match(r.data.skipped[1].message, /Ya existe/);
    assert.equal((await t.client().post('/api/auth/login', { usuario: '1098765433', password: '5433' })).status, 200, 'clave inicial = últimos 4 dígitos');
    assert.equal((await admin.get('/api/admin/students')).data.total, 2);
  });

  test('límites: lote vacío, demasiado grande o sin permisos', async () => {
    assert.equal((await admin.post('/api/admin/students/import', { rows: [] })).status, 400);
    assert.equal((await admin.post('/api/admin/students/import', { rows: Array.from({ length: 101 }, () => ({})) })).status, 400);
    assert.equal((await admin.post('/api/admin/students/import', { rows: 'x' })).status, 400);
    const student = t.client(); await student.post('/api/auth/login', { usuario: '1098765433', password: '5433' });
    assert.equal((await student.post('/api/admin/students/import', { rows: [{ name: 'X Y Z', documento: '123456', grade: '1A' }] })).status, 403);
  });
});
