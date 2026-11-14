import { useState } from 'react';
import { api } from '../../api';
import type { AttendanceRow, Block, Course, Status } from '../../types';
import { Async, Badge, Button, Card, Confirm, DataTable, Dialog, Empty, Field, PageHeader, RowActions, STATUS, StatusBadge, errorMessage, fmtDate, useLoad, useToast } from '../../ui';

interface AdminCourse extends Course { teacherId: number; teacher: string }
interface Teacher { id: number; name: string }

function CourseForm({ course, blocks, teachers, onClose, onSaved }: { course: AdminCourse | null; blocks: Block[]; teachers: Teacher[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ grade: course?.grade ?? '', subject: course?.subject ?? '', teacherId: course?.teacherId ?? teachers[0]?.id ?? 0, blockId: course?.blockId ?? blocks[0]?.id ?? '', room: course?.room ?? '', active: course?.active ?? true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(''); setBusy(true);
    try { if (course) await api.put(`/admin/courses/${course.id}`, f); else await api.post('/admin/courses', f); toast(course ? 'Curso actualizado.' : 'Curso creado.'); onSaved(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={course ? 'Editar curso' : 'Nuevo curso'} description="Un curso se repite todos los días de clase en su franja horaria." onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" icon="save" loading={busy} onClick={() => void save()}>Guardar</Button></>}>
      <div className="form-grid">
        <Field label="Grado"><input value={f.grade} placeholder="Ej.: 10A" onChange={(e) => setF({ ...f, grade: e.target.value })} /></Field>
        <Field label="Asignatura"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} maxLength={60} /></Field>
      </div>
      <Field label="Profesor"><select value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: Number(e.target.value) })}>{teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <div className="form-grid">
        <Field label="Franja horaria"><select value={f.blockId} onChange={(e) => setF({ ...f, blockId: e.target.value })}>{blocks.map((b) => <option key={b.id} value={b.id}>{b.label} ({b.start})</option>)}</select></Field>
        <Field label="Aula (opcional)"><input value={f.room} maxLength={20} onChange={(e) => setF({ ...f, room: e.target.value })} /></Field>
      </div>
      {course && <Field label="Estado"><select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">Activo</option><option value="0">Inactivo</option></select></Field>}
      {!teachers.length && <p className="field__error">Primero crea un profesor en «Usuarios».</p>}
      {error && <p className="field__error" role="alert">{error}</p>}
    </Dialog>
  );
}

function History({ course, onClose }: { course: AdminCourse; onClose: () => void }) {
  const [status, setStatus] = useState<'' | Status>('');
  const load = useLoad(() => api.get<{ items: (AttendanceRow & { student: string })[] }>(`/admin/courses/${course.id}/attendance${status ? `?status=${status}` : ''}`), [status]);
  return (
    <Dialog title={`Historial · ${course.subject} ${course.grade}`} onClose={onClose}>
      <Field label="Estado"><select value={status} onChange={(e) => setStatus(e.target.value as '' | Status)}><option value="">Todos</option>{(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</select></Field>
      <Async load={load}>{({ items }) => items.length ? <ul className="roster">{items.map((r) => <li key={r.id}><span><strong>{r.student}</strong><span className="muted"> · {fmtDate(r.date)}</span></span><StatusBadge status={r.status} /></li>)}</ul> : <Empty icon="calendar" title="Sin registros" />}</Async>
    </Dialog>
  );
}

export function CoursesView() {
  const toast = useToast();
  const load = useLoad(() => api.get<{ blocks: Block[]; items: AdminCourse[] }>('/admin/courses'));
  const teachers = useLoad(() => api.get<{ items: Teacher[] }>('/admin/users?role=profesor&status=activo'));
  const [edit, setEdit] = useState<AdminCourse | 'new' | null>(null);
  const [history, setHistory] = useState<AdminCourse | null>(null);
  const [del, setDel] = useState<AdminCourse | null>(null);

  const remove = async (c: AdminCourse) => {
    try { const r = await api.del<{ deactivated?: boolean }>(`/admin/courses/${c.id}`); toast(r.deactivated ? 'El curso tiene historial: quedó inactivo.' : 'Curso eliminado.'); load.reload(); } catch (e) { toast(errorMessage(e), 'bad'); }
    setDel(null);
  };

  return (
    <>
      <PageHeader title="Cursos" subtitle="Asignaturas por grado, profesor y franja horaria." actions={<Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Nuevo curso</Button>} />
      <Card>
        <Async load={load}>{(d) => (
          <DataTable caption="Cursos" rows={d.items} rowKey={(c) => c.id} empty={<Empty icon="book" title="No hay cursos">Crea el primero con «Nuevo curso».</Empty>}
            columns={[
              { key: 'g', label: 'Grado', render: (c) => <strong>{c.grade}</strong> }, { key: 's', label: 'Asignatura', render: (c) => c.subject },
              { key: 't', label: 'Profesor', render: (c) => c.teacher }, { key: 'b', label: 'Horario', render: (c) => `${c.blockLabel} · ${c.start ?? '—'}${c.room ? ` · ${c.room}` : ''}` },
              { key: 'e', label: 'Estado', render: (c) => <Badge tone={c.active ? 'ok' : 'neutral'}>{c.active ? 'activo' : 'inactivo'}</Badge> },
              { key: 'x', label: 'Acciones', align: 'end', render: (c) => (
                <RowActions>
                  <Button size="sm" icon="history" aria-label={`Historial de ${c.subject} ${c.grade}`} title="Historial" onClick={() => setHistory(c)} />
                  <Button size="sm" icon="edit" aria-label={`Editar ${c.subject} ${c.grade}`} onClick={() => setEdit(c)} />
                  <Button size="sm" icon="trash" aria-label={`Eliminar ${c.subject} ${c.grade}`} onClick={() => setDel(c)} />
                </RowActions>) },
            ]} />
        )}</Async>
      </Card>
      {edit && load.data && <CourseForm course={edit === 'new' ? null : edit} blocks={load.data.blocks} teachers={teachers.data?.items ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load.reload(); }} />}
      {history && <History course={history} onClose={() => setHistory(null)} />}
      {del && <Confirm danger title="Eliminar curso" confirmLabel="Eliminar" message={`¿Eliminar ${del.subject} de ${del.grade}? Si ya tiene asistencia registrada, solo quedará inactivo para conservar el historial.`} onConfirm={() => remove(del)} onClose={() => setDel(null)} />}
    </>
  );
}
