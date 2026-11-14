import { useState } from 'react';
import { api } from '../api';
import { useTab } from '../hooks';
import type { GuardianOverview } from '../types';
import { Alert, Async, Button, Card, Empty, Field, PageHeader, errorMessage, useLoad, useToast, type NavItem } from '../ui';
import { ExcuseForm } from './ExcuseForm';
import { ExcuseList } from './Excuses';
import { NoticesView, useUnread } from './Notices';
import { RecordsCard, RiskAlert, StatsRow } from './Records';
import { Shell } from './Shell';

function MessageForm({ studentId }: { studentId: number }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setError('');
    if (text.trim().length < 10) return setError('Escribe al menos 10 caracteres.');
    setBusy(true);
    try { await api.post('/feedback', { studentId, text }); setText(''); toast('Mensaje enviado a la administración.'); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Card title="Mensaje a la administración" subtitle="Quejas, sugerencias o dudas sobre el registro de asistencia.">
      <Field label="Tu mensaje"><textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1500} /></Field>
      {error && <p className="field__error" role="alert">{error}</p>}
      <div><Button variant="primary" icon="send" loading={busy} onClick={() => void send()}>Enviar mensaje</Button></div>
    </Card>
  );
}

export function GuardianView() {
  const [tab, setTab] = useTab(['novedades', 'excusas', 'mensaje', 'avisos'], 'novedades');
  const load = useLoad(() => api.get<GuardianOverview>('/padre/overview'));
  const unread = useUnread();
  const [selected, setSelected] = useState(0);
  const [form, setForm] = useState(false);
  const nav: NavItem[] = [
    { id: 'novedades', label: 'Novedades', icon: 'clipboard' },
    { id: 'excusas', label: 'Excusas', icon: 'file' },
    { id: 'mensaje', label: 'Mensaje', icon: 'message' },
    { id: 'avisos', label: 'Avisos', icon: 'bell', badge: unread },
  ];

  return (
    <Shell nav={nav} current={tab} onSelect={setTab} label="Secciones del acudiente">
      {tab === 'avisos' ? <NoticesView /> : <Async load={load}>{(o) => {
        if (!o.students.length) return <Card><Empty icon="users" title="No hay estudiantes vinculados a tu cuenta">Pide al colegio que registre tu correo como acudiente de tu hijo(a).</Empty></Card>;
        const s = o.students[Math.min(selected, o.students.length - 1)];
        return (
          <>
            <PageHeader title={tab === 'novedades' ? 'Novedades' : tab === 'excusas' ? 'Excusas' : 'Mensaje'} subtitle={`${s.name} · Grado ${s.grade}`} />
            {o.students.length > 1 && (
              <div className="chips" role="group" aria-label="Estudiante">
                {o.students.map((st, i) => <button key={st.id} type="button" className="chip" aria-pressed={i === selected} onClick={() => setSelected(i)}>{st.name.split(' ')[0]}</button>)}
              </div>
            )}
            {s.status !== 'activo' && <Alert tone="warn">El registro de {s.name} aún no está activo en el colegio.</Alert>}
            {tab === 'novedades' && (
              <>
                <RiskAlert counts={s.counts} threshold={o.riskThreshold} who={s.name} />
                <StatsRow counts={s.counts} />
                <RecordsCard title="Llegadas tarde, ausencias y justificaciones" records={s.records} />
              </>
            )}
            {tab === 'excusas' && (
              <Card title="Solicitudes enviadas" actions={<Button variant="primary" icon="plus" disabled={!s.courses.length} onClick={() => setForm(true)}>Nueva excusa</Button>}>
                <ExcuseList items={s.excuses} />
              </Card>
            )}
            {tab === 'mensaje' && <MessageForm studentId={s.id} />}
            {form && <ExcuseForm today={o.today} studentId={s.id} courses={s.courses} kinds={['medica', 'personal', 'error_registro']} onClose={() => setForm(false)} onSaved={() => { setForm(false); load.reload(); }} />}
          </>
        );
      }}</Async>}
    </Shell>
  );
}
