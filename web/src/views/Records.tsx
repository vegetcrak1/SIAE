import { useMemo, useState } from 'react';
import type { AttendanceRow, Counts, Status } from '../types';
import { Alert, Button, Card, DataTable, Empty, Field, Stat, StatusBadge, STATUS, fmtDate, fmtTime } from '../ui';

export const attendanceRate = (c: Counts) => {
  const total = c.puntual + c.tarde + c.ausente + c.justificado;
  return total ? Math.round(((total - c.ausente) / total) * 100) : 100;
};

export function StatsRow({ counts }: { counts: Counts }) {
  return (
    <div className="grid grid--stats">
      <Stat icon="trend" tone="info" label="Asistencia" value={`${attendanceRate(counts)}%`} />
      <Stat icon="check-circle" tone="ok" label="Puntual" value={counts.puntual} />
      <Stat icon="clock" tone="warn" label="Llegadas tarde" value={counts.tarde} />
      <Stat icon="x-circle" tone="bad" label="Ausencias" value={counts.ausente} hint={counts.justificado ? `${counts.justificado} justificada(s)` : undefined} />
    </div>
  );
}

export function RiskAlert({ counts, threshold, who }: { counts: Counts; threshold: number; who: string }) {
  if (counts.tarde < threshold && counts.ausente < threshold) return null;
  return (
    <Alert tone="warn" icon="siren">
      <strong>Atención:</strong> {who} acumula {counts.tarde} llegadas tarde y {counts.ausente} ausencias. Al llegar a {threshold} de cualquiera de las dos, el manual de convivencia (Art. 19) prevé un llamado de atención.
    </Alert>
  );
}

/** Historial con filtros por asignatura, estado y fechas. Tabla en pantalla grande, tarjetas en el celular. */
export function RecordsCard({ records, onReport, title = 'Historial de asistencia', filters = true }: { records: AttendanceRow[]; onReport?: (r: AttendanceRow) => void; title?: string; filters?: boolean }) {
  const [subject, setSubject] = useState('');
  const [status, setStatus] = useState<Status | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const subjects = useMemo(() => [...new Set(records.map((r) => r.subject))].sort(), [records]);
  const rows = useMemo(() => records.filter((r) => (!subject || r.subject === subject) && (!status || r.status === status) && (!from || r.date >= from) && (!to || r.date <= to)), [records, subject, status, from, to]);
  const filtered = !!(subject || status || from || to);

  return (
    <Card title={title} subtitle={`${rows.length} registro(s)`}>
      {filters && <div className="filters">
        <Field label="Asignatura"><select value={subject} onChange={(e) => setSubject(e.target.value)}><option value="">Todas</option>{subjects.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Estado"><select value={status} onChange={(e) => setStatus(e.target.value as Status | '')}><option value="">Todos</option>{(Object.keys(STATUS) as Status[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}</select></Field>
        <Field label="Desde"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Hasta"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        {filtered && <Button onClick={() => { setSubject(''); setStatus(''); setFrom(''); setTo(''); }}>Limpiar filtros</Button>}
      </div>}
      <DataTable caption={title} rows={rows} rowKey={(r) => r.id}
        empty={<Empty icon="calendar" title="No hay registros" >{filtered ? 'Prueba con otros filtros.' : 'Aparecerán aquí cuando se registre tu asistencia.'}</Empty>}
        columns={[
          { key: 'd', label: 'Fecha', render: (r) => fmtDate(r.date) },
          { key: 's', label: 'Asignatura', render: (r) => r.subject },
          { key: 'h', label: 'Hora', render: (r) => fmtTime(r.scannedAt) || '—' },
          { key: 'e', label: 'Estado', render: (r) => <StatusBadge status={r.status} /> },
          { key: 'o', label: 'Detalle', render: (r) => (r.minutesLate ? `${r.minutesLate} min tarde` : r.observation || '—') },
          ...(onReport ? [{ key: 'a', label: 'Acciones', align: 'end' as const, render: (r: AttendanceRow) => <Button size="sm" icon="flag" onClick={() => onReport(r)}>Reportar error</Button> }] : []),
        ]} />
    </Card>
  );
}
