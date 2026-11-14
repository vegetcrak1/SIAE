import { useState } from 'react';
import { api } from '../../api';
import { Alert, Async, Button, Card, DataTable, Empty, Field, PageHeader, errorMessage, fmtDate, useLoad, useToast } from '../../ui';

interface Sub { id: number; date: string; subject: string; grade: string; titular: string; substitute: string }

export function SubstitutionsView() {
  const toast = useToast();
  const subs = useLoad(() => api.get<{ today: string; items: Sub[] }>('/admin/substitutions'));
  const courses = useLoad(() => api.get<{ items: { id: number; grade: string; subject: string; teacher: string; teacherId: number; active: boolean }[] }>('/admin/courses'));
  const teachers = useLoad(() => api.get<{ items: { id: number; name: string }[] }>('/admin/users?role=profesor&status=activo'));
  const today = subs.data?.today ?? '';
  const [courseId, setCourseId] = useState(0);
  const [substituteId, setSubstituteId] = useState(0);
  const [picked, setDate] = useState('');
  const date = picked || today;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = (courses.data?.items ?? []).filter((c) => c.active);
  const course = active.find((c) => c.id === (courseId || active[0]?.id));
  const options = (teachers.data?.items ?? []).filter((t) => t.id !== course?.teacherId);

  const save = async () => {
    setError(''); setBusy(true);
    try { await api.post('/admin/substitutions', { courseId: course?.id, substituteId: substituteId || options[0]?.id, date }); toast('Reemplazo registrado.'); subs.reload(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const remove = async (id: number) => { try { await api.del(`/admin/substitutions/${id}`); toast('Reemplazo cancelado.'); subs.reload(); } catch (e) { toast(errorMessage(e), 'bad'); } };

  return (
    <>
      <PageHeader title="Reemplazos" subtitle="Cuando un profesor falta, otro puede tomar la asistencia de su curso ese día." />
      <Card title="Asignar reemplazo">
        <div className="filters">
          <Field label="Curso"><select value={course?.id ?? ''} onChange={(e) => setCourseId(Number(e.target.value))}>{active.map((c) => <option key={c.id} value={c.id}>{c.grade} · {c.subject} ({c.teacher})</option>)}</select></Field>
          <Field label="Profesor que reemplaza"><select value={substituteId || options[0]?.id || ''} onChange={(e) => setSubstituteId(Number(e.target.value))}>{options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="Fecha"><input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} /></Field>
          <Button variant="primary" icon="plus" loading={busy} disabled={!course || !options.length} onClick={() => void save()}>Asignar</Button>
        </div>
        {error && <Alert tone="bad">{error}</Alert>}
      </Card>
      <Card title="Reemplazos programados">
        <Async load={subs}>{({ items }) => (
          <DataTable caption="Reemplazos" rows={items} rowKey={(s) => s.id} empty={<Empty icon="calendar" title="No hay reemplazos programados" />}
            columns={[
              { key: 'd', label: 'Fecha', render: (s) => fmtDate(s.date) }, { key: 'c', label: 'Curso', render: (s) => `${s.grade} · ${s.subject}` },
              { key: 't', label: 'Titular', render: (s) => s.titular }, { key: 'r', label: 'Reemplaza', render: (s) => <strong>{s.substitute}</strong> },
              { key: 'x', label: 'Acciones', align: 'end', render: (s) => <Button size="sm" icon="trash" aria-label="Cancelar reemplazo" onClick={() => void remove(s.id)} /> },
            ]} />
        )}</Async>
      </Card>
    </>
  );
}
