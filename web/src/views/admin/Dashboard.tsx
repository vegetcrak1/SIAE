import { useState } from 'react';
import { api } from '../../api';
import type { Counts } from '../../types';
import { Alert, Async, Button, Card, DataTable, Empty, Field, PageHeader, Stat, StatusBadge, fmtDate, fmtTime, useLoad } from '../../ui';
import type { Status } from '../../types';

interface Dashboard {
  date: string; today: Counts & { total: number; expected: number };
  days: { date: string; attendance: number; punctuality: number }[];
  courses: { id: number; grade: string; subject: string; records: number; attendance: number; punctuality: number }[];
  recent: { id: number; status: Status; scannedAt: number | null; student: string; subject: string; grade: string }[];
  pendingRegistrations: number; pendingExcuses: number; atRisk: number;
}
interface Risk { threshold: number; items: { id: number; name: string; grade: string; guardianPhone: string | null; lates: number; absences: number }[] }

function TrendChart({ days }: { days: Dashboard['days'] }) {
  if (days.length < 2) return <Empty icon="activity" title="Aún no hay suficientes días registrados" />;
  const W = 640, H = 220, L = 36, B = 28, T = 10;
  const x = (i: number) => L + (i * (W - L - 12)) / (days.length - 1);
  const y = (v: number) => T + ((100 - v) * (H - T - B)) / 100;
  const line = (key: 'attendance' | 'punctuality') => days.map((d, i) => `${x(i)},${y(d[key])}`).join(' ');
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Asistencia y puntualidad de los últimos días">
        {[0, 25, 50, 75, 100].map((v) => <g key={v}><line x1={L} x2={W - 12} y1={y(v)} y2={y(v)} stroke="#e2e8f0" /><text x={L - 6} y={y(v) + 4} fontSize="11" textAnchor="end" fill="#475569">{v}%</text></g>)}
        {days.map((d, i) => <text key={d.date} x={x(i)} y={H - 8} fontSize="11" textAnchor="middle" fill="#475569">{d.date.slice(8)}/{d.date.slice(5, 7)}</text>)}
        <polyline points={line('attendance')} fill="none" stroke="#1d4ed8" strokeWidth="3" />
        <polyline points={line('punctuality')} fill="none" stroke="#b45309" strokeWidth="3" strokeDasharray="7 5" />
      </svg>
      <div className="legend"><span><i style={{ color: '#1d4ed8' }} />Asistencia</span><span><i style={{ color: '#b45309', borderTopStyle: 'dashed' }} />Puntualidad</span></div>
    </>
  );
}

export function DashboardView({ go }: { go: (tab: string) => void }) {
  const load = useLoad(() => api.get<Dashboard>('/admin/dashboard'));
  const risk = useLoad(() => api.get<Risk>('/admin/risk'));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const exportHref = `/api/admin/export.csv${from || to ? `?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}` : ''}`;

  return (
    <>
      <PageHeader title="Panel general" subtitle="Resumen de hoy y tendencias." actions={<Button icon="refresh" onClick={() => { load.reload(); risk.reload(); }}>Actualizar</Button>} />
      <Async load={load}>{(d) => (
        <>
          {(d.pendingRegistrations > 0 || d.pendingExcuses > 0) && (
            <Alert tone="info" icon="inbox">
              <div className="row">
                {d.pendingRegistrations > 0 && <Button size="sm" onClick={() => go('estudiantes')}>{d.pendingRegistrations} registro(s) por aprobar</Button>}
                {d.pendingExcuses > 0 && <Button size="sm" onClick={() => go('excusas')}>{d.pendingExcuses} excusa(s) por revisar</Button>}
              </div>
            </Alert>
          )}
          <div className="grid grid--stats">
            <Stat icon="users" tone="info" label="Registrados hoy" value={`${d.today.total}`} hint={`de ${d.today.expected} esperados`} />
            <Stat icon="check-circle" tone="ok" label="Puntuales" value={d.today.puntual} />
            <Stat icon="clock" tone="warn" label="Tarde" value={d.today.tarde} />
            <Stat icon="x-circle" tone="bad" label="Ausentes" value={d.today.ausente} hint={d.today.justificado ? `${d.today.justificado} justificadas` : undefined} />
          </div>
          <div className="split">
            <Card title="Últimos días"><TrendChart days={d.days} /></Card>
            <Card title="Últimos registros de hoy">
              {d.recent.length ? <ul className="roster">{d.recent.map((r) => <li key={r.id}><span><strong>{r.student}</strong><span className="muted"> · {r.grade} · {r.subject} · {fmtTime(r.scannedAt)}</span></span><StatusBadge status={r.status} /></li>)}</ul> : <Empty icon="scan" title="Todavía no hay registros hoy" />}
            </Card>
          </div>
          <Card title="Asistencia por curso" subtitle="Últimos 30 días">
            <DataTable caption="Asistencia por curso" rows={d.courses} rowKey={(c) => c.id} empty={<Empty icon="book" title="No hay cursos creados" />}
              columns={[
                { key: 'g', label: 'Grado', render: (c) => c.grade }, { key: 's', label: 'Asignatura', render: (c) => c.subject },
                { key: 'r', label: 'Registros', render: (c) => c.records },
                { key: 'a', label: 'Asistencia', render: (c) => c.records ? <div style={{ minWidth: 120 }}><div className="bar__row"><span>{c.attendance}%</span></div><div className="bar__track"><div className="bar__fill" style={{ width: `${c.attendance}%` }} /></div></div> : '—' },
                { key: 'p', label: 'Puntualidad', render: (c) => c.records ? `${c.punctuality}%` : '—' },
              ]} />
          </Card>
        </>
      )}</Async>
      <Async load={risk}>{(r) => (
        <Card title="Alerta de convivencia (Art. 19)" subtitle={`Estudiantes con ${r.threshold} o más llegadas tarde o ausencias.`}>
          <DataTable caption="Estudiantes en riesgo" rows={r.items} rowKey={(s) => s.id} empty={<Empty icon="shield" title="Nadie ha llegado al umbral" />}
            columns={[
              { key: 'n', label: 'Estudiante', render: (s) => <strong>{s.name}</strong> }, { key: 'g', label: 'Grado', render: (s) => s.grade },
              { key: 'l', label: 'Tarde', render: (s) => s.lates }, { key: 'a', label: 'Ausencias', render: (s) => s.absences },
              { key: 'c', label: 'Acudiente', render: (s) => s.guardianPhone ? <a href={`tel:${s.guardianPhone}`}>{s.guardianPhone}</a> : '—' },
            ]} />
        </Card>
      )}</Async>
      <Card title="Exportar asistencia" subtitle="Archivo CSV para Excel. Sin fechas: últimos 30 días.">
        <div className="filters">
          <Field label="Desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <a className="btn btn--primary" href={exportHref} download>Descargar CSV</a>
        </div>
        <p className="muted">Fecha de hoy: {fmtDate(new Date().toISOString().slice(0, 10))}</p>
      </Card>
    </>
  );
}
