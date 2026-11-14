import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { QrCode } from '../QrCode';
import { useTab } from '../hooks';
import type { AttendanceRow, StudentOverview } from '../types';
import { Alert, Async, Button, Card, PageHeader, useLoad, type NavItem } from '../ui';
import { ExcuseForm } from './ExcuseForm';
import { ExcuseList } from './Excuses';
import { NoticesView, useUnread } from './Notices';
import { RecordsCard, RiskAlert, StatsRow } from './Records';
import { Shell } from './Shell';

const REFRESH_MS = 45_000;

/** Carnet digital: el código cambia cada 45 s y solo lo emite la sesión del estudiante (una captura de pantalla deja de servir enseguida). */
function QrPanel({ name, grade }: { name: string; grade: string }) {
  const [qr, setQr] = useState<{ token: string; at: number } | null>(null);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try { const r = await api.get<{ token: string }>('/estudiante/qr'); setQr({ token: r.token, at: Date.now() }); setOffline(false); } catch { setOffline(true); }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => { if (!document.hidden) void refresh(); }, REFRESH_MS);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [refresh]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const seconds = qr ? Math.max(0, Math.round((REFRESH_MS - (now - qr.at)) / 1000)) : 0;

  return (
    <Card title="Mi carnet digital" subtitle="Muéstraselo al profesor al entrar a clase.">
      <div className="qr-box">
        {qr ? <QrCode value={qr.token} label={`Código QR de ${name}`} /> : <div className="loading"><span className="spinner" />Generando…</div>}
        <strong>{name}</strong>
        <span className="muted">Grado {grade}{qr && !offline ? ` · se renueva en ${seconds} s` : ''}</span>
      </div>
      {offline && <Alert tone="warn" icon="wifi-off">Sin conexión: este código puede estar vencido. Reconéctate para renovarlo.</Alert>}
      <Button icon="refresh" onClick={() => void refresh()}>Renovar ahora</Button>
    </Card>
  );
}

export function StudentView({ onChangePassword }: { onChangePassword: () => void }) {
  const [tab, setTab] = useTab(['resumen', 'historial', 'solicitudes', 'avisos'], 'resumen');
  const load = useLoad(() => api.get<StudentOverview>('/estudiante/overview'));
  const unread = useUnread();
  const [report, setReport] = useState<{ open: boolean; row?: AttendanceRow }>({ open: false });
  const nav: NavItem[] = [
    { id: 'resumen', label: 'Resumen', icon: 'home' },
    { id: 'historial', label: 'Historial', icon: 'history' },
    { id: 'solicitudes', label: 'Solicitudes', icon: 'file' },
    { id: 'avisos', label: 'Avisos', icon: 'bell', badge: unread },
  ];

  return (
    <Shell nav={nav} current={tab} onSelect={setTab} label="Secciones del estudiante">
      {tab === 'avisos' ? <NoticesView /> : <Async load={load}>{(o) => (
        <>
          {tab === 'resumen' && (
            <>
              <PageHeader title={`Hola, ${o.student.name.split(' ')[0]}`} subtitle={`Grado ${o.student.grade}`} />
              <PasswordNudge onClick={onChangePassword} />
              <RiskAlert counts={o.counts} threshold={o.riskThreshold} who="Tienes" />
              <div className="split split--qr">
                <QrPanel name={o.student.name} grade={o.student.grade} />
                <div className="main"><StatsRow counts={o.counts} />
                  <RecordsCard title="Últimos registros" records={o.records.slice(0, 5)} filters={false} />
                </div>
              </div>
            </>
          )}
          {tab === 'historial' && <><PageHeader title="Historial" subtitle="Si ves un registro equivocado, repórtalo desde la fila." /><RecordsCard records={o.records} onReport={(row) => setReport({ open: true, row })} /></>}
          {tab === 'solicitudes' && (
            <>
              <PageHeader title="Solicitudes" subtitle="Aquí ves el estado de tus reportes. Las excusas por inasistencia las presenta tu acudiente." actions={<Button variant="primary" icon="plus" onClick={() => setReport({ open: true })} disabled={!o.courses.length}>Reportar un error</Button>} />
              <Card><ExcuseList items={o.excuses} /></Card>
            </>
          )}
          {report.open && <ExcuseForm today={o.today} courses={o.courses} kinds={['error_registro']} initial={report.row ? { courseId: report.row.courseId, date: report.row.date } : undefined} onClose={() => setReport({ open: false })} onSaved={() => { setReport({ open: false }); load.reload(); setTab('solicitudes'); }} />}
        </>
      )}</Async>}
    </Shell>
  );
}

function PasswordNudge({ onClick }: { onClick: () => void }) {
  const load = useLoad(() => api.get<{ user: { passwordIsDefault: boolean } | null }>('/session'));
  if (!load.data?.user?.passwordIsDefault) return null;
  return <Alert tone="warn" icon="key">Sigues usando la contraseña inicial (los últimos dígitos de tu documento). <Button size="sm" onClick={onClick}>Cambiarla ahora</Button></Alert>;
}
