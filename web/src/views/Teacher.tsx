import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { Scanner } from '../Scanner';
import { flushQueue, queuedCount, sendScan } from '../scanQueue';
import { useTab } from '../hooks';
import type { Roster, RosterStudent, ScanResult, Status, TeacherClass, User } from '../types';
import { Alert, Async, Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Loading, PageHeader, StatusBadge, STATUS, errorMessage, fmtTime, useLoad, useToast, type NavItem } from '../ui';
import { NoticesView, useUnread } from './Notices';
import { Shell } from './Shell';

type Outcome = { tone: 'ok' | 'bad' | 'queued'; title: string; detail?: string; status?: Status };

function ScanPanel({ user, classId, onRecorded, contingency }: { user: User; classId: number; onRecorded: () => void; contingency: string | null }) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [documento, setDocumento] = useState('');
  const [pending, setPending] = useState(() => queuedCount(user.id));
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const toast = useToast();

  const submit = useCallback(async (payload: { token?: string; documento?: string }) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const r = await sendScan<ScanResult>(user.id, classId, { ...payload, scannedAt: Date.now() });
      if (r.queued) {
        setOutcome({ tone: 'queued', title: 'Sin conexión: guardado en este dispositivo', detail: 'Se enviará solo cuando vuelva la red.' });
        setPending(queuedCount(user.id));
      } else {
        const { student, status, minutesLate } = r.result;
        setOutcome({ tone: 'ok', title: student.name, status, detail: minutesLate > 0 ? `${minutesLate} min después de la hora` : 'A tiempo' });
        onRecorded();
      }
    } catch (e) {
      setOutcome({ tone: 'bad', title: e instanceof ApiError && e.code === 'duplicate' ? 'Ya estaba registrado' : 'No se pudo registrar', detail: errorMessage(e) });
    } finally { lock.current = false; setBusy(false); }
  }, [user.id, classId, onRecorded]);

  const onCode = useCallback((text: string) => {
    if (!/^SIAE1\.\d+\.\d+\.[\w-]{22}$/.test(text.trim())) {
      setOutcome({ tone: 'bad', title: 'Código no reconocido', detail: 'Pida al estudiante que abra su carnet digital en la aplicación.' });
      return;
    }
    void submit({ token: text.trim() });
  }, [submit]);

  // Reenvío automático de lo guardado sin conexión.
  useEffect(() => {
    const run = async () => {
      if (!queuedCount(user.id)) return;
      const r = await flushQueue(user.id);
      setPending(r.remaining);
      if (r.sent) { toast(`${r.sent} registro(s) pendiente(s) enviados.`); onRecorded(); }
    };
    void run();
    const id = window.setInterval(() => void run(), 15_000);
    window.addEventListener('online', run);
    return () => { window.clearInterval(id); window.removeEventListener('online', run); };
  }, [user.id, onRecorded, toast]);

  return (
    <div className="split">
      <Card title="Escanear carnet" subtitle="Apunte la cámara al código del estudiante.">
        {contingency && <Alert tone="warn" icon="alert">Horario de contingencia: {contingency}</Alert>}
        <Scanner onScan={onCode} />
        <div className="result" role="status" aria-live="polite" data-tone={outcome?.tone}>
          {outcome ? (
            <>
              <div style={{ flex: 1, minWidth: 0 }}><strong>{outcome.title}</strong>{outcome.detail && <p className="muted">{outcome.detail}</p>}</div>
              {outcome.status && <StatusBadge status={outcome.status} />}
              {outcome.tone === 'bad' && <Badge tone="bad">Error</Badge>}
              {outcome.tone === 'queued' && <Badge tone="warn">Pendiente</Badge>}
            </>
          ) : <span className="muted">El resultado de cada escaneo aparece aquí.</span>}
        </div>
        {pending > 0 && <Alert tone="warn" icon="wifi-off">{pending} registro(s) pendiente(s) de envío. Se reintentan solos.</Alert>}
      </Card>

      <Card title="Ingreso manual" subtitle="Si el estudiante no tiene celular o la cámara no funciona.">
        <form className="stack" onSubmit={(e) => { e.preventDefault(); if (documento.trim()) { void submit({ documento: documento.trim() }).then(() => setDocumento('')); } }}>
          <Field label="Número de documento del estudiante"><input value={documento} onChange={(e) => setDocumento(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="Ej.: 1098765432" /></Field>
          <Button type="submit" variant="primary" icon="user-check" loading={busy} disabled={!documento.trim()}>Registrar llegada</Button>
        </form>
      </Card>
    </div>
  );
}

function RosterCard({ roster, onClosed, reload }: { roster: Roster; onClosed: () => void; reload: () => void }) {
  const toast = useToast();
  const [filter, setFilter] = useState<'todos' | 'sin' | Status>('todos');
  const [confirm, setConfirm] = useState(false);
  const rows = roster.students.filter((s) => (filter === 'todos' ? true : filter === 'sin' ? !s.record : s.record?.status === filter));
  const missing = roster.students.filter((s) => !s.record).length;
  const counts = (st: Status) => roster.students.filter((s) => s.record?.status === st).length;

  const close = async () => {
    try { const r = await api.post<{ marked: number }>(`/profesor/classes/${roster.course.id}/close`); toast(r.marked ? `${r.marked} estudiante(s) marcados como ausentes.` : 'No había estudiantes sin registrar.'); setConfirm(false); onClosed(); }
    catch (e) { toast(errorMessage(e), 'bad'); }
  };
  const chip = (id: typeof filter, label: string) => <button key={id} type="button" className="chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>;
  const line = (s: RosterStudent) => (
    <li key={s.id}>
      <span><strong>{s.name}</strong>{s.record?.scannedAt && <span className="muted"> · {fmtTime(s.record.scannedAt)}{s.record.minutesLate ? ` · ${s.record.minutesLate} min tarde` : ''}</span>}</span>
      {s.record ? <StatusBadge status={s.record.status} /> : <Badge>Sin registrar</Badge>}
    </li>
  );

  return (
    <Card title="Lista del curso" subtitle={`${roster.students.length} estudiantes · ${counts('puntual')} puntuales · ${counts('tarde')} tarde · ${counts('ausente')} ausentes · ${missing} sin registrar`}
      actions={<><Button icon="refresh" onClick={reload}>Actualizar</Button><Button variant="danger" icon="x-circle" disabled={!missing} onClick={() => setConfirm(true)}>Cerrar lista</Button></>}>
      <div className="chips" role="group" aria-label="Filtrar lista">
        {chip('todos', 'Todos')}{chip('sin', `Sin registrar (${missing})`)}{(Object.keys(STATUS) as Status[]).map((s) => chip(s, STATUS[s].label))}
      </div>
      {rows.length ? <ul className="roster">{rows.map(line)}</ul> : <Empty icon="users" title={roster.students.length ? 'Nadie coincide con el filtro' : 'Este grado todavía no tiene estudiantes activos'} />}
      {confirm && <Confirm danger title="Cerrar la lista" confirmLabel="Marcar ausentes" message={`Los ${missing} estudiantes sin registro se marcarán como ausentes. ¿Continuar?`} onConfirm={close} onClose={() => setConfirm(false)} />}
    </Card>
  );
}

export function TeacherView({ user }: { user: User }) {
  const [tab, setTab] = useTab(['registrar', 'lista', 'avisos'], 'registrar');
  const classes = useLoad(() => api.get<{ date: string; classes: TeacherClass[] }>('/profesor/classes'));
  const unread = useUnread();
  const [selected, setSelected] = useState<number | null>(null);
  const current = selected ?? classes.data?.classes[0]?.id ?? null;
  const roster = useLoad(() => (current ? api.get<Roster>(`/profesor/classes/${current}/roster`) : Promise.resolve(null)), [current]);
  const nav: NavItem[] = [
    { id: 'registrar', label: 'Registrar', icon: 'scan' },
    { id: 'lista', label: 'Lista', icon: 'users' },
    { id: 'avisos', label: 'Avisos', icon: 'bell', badge: unread },
  ];
  const label = (c: TeacherClass) => `${c.start ?? ''} · ${c.subject} · ${c.grade}${c.room ? ` · ${c.room}` : ''}${c.substitute ? ` (reemplazo de ${c.covering})` : ''}`;

  return (
    <Shell nav={nav} current={tab} onSelect={setTab} label="Secciones del profesor">
      {tab === 'avisos' ? <NoticesView /> : (
        <>
          <PageHeader title={tab === 'registrar' ? 'Registrar asistencia' : 'Lista del curso'} subtitle="Clases de hoy" />
          <Async load={classes}>{({ classes: list }) => !list.length ? (
            <Card><Empty icon="calendar" title="No tienes clases asignadas hoy">Si debería tenerlas, avise a la administración.</Empty></Card>
          ) : (
            <>
              <Card><Field label="Clase"><select value={current ?? ''} onChange={(e) => setSelected(Number(e.target.value))}>{list.map((c) => <option key={c.id} value={c.id}>{label(c)}</option>)}</select></Field></Card>
              {roster.error && <ErrorBox message={roster.error} onRetry={roster.reload} />}
              {roster.loading && !roster.data && <Loading />}
              {roster.data && current && (tab === 'registrar'
                ? <ScanPanel user={user} classId={current} onRecorded={roster.reload} contingency={roster.data.contingency} />
                : <RosterCard roster={roster.data} reload={roster.reload} onClosed={roster.reload} />)}
            </>
          )}</Async>
        </>
      )}
    </Shell>
  );
}
