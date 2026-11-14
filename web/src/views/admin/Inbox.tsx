import { useState } from 'react';
import { api } from '../../api';
import type { Block, Evidence, ExcuseKind, ExcuseState, Level, Rules } from '../../types';
import { Icon } from '../../icons';
import { Alert, Async, Badge, Button, Card, Confirm, DataTable, Empty, Field, PageHeader, Switch, errorMessage, fmtDate, fmtDateTime, useLoad, useToast } from '../../ui';
import { kindLabel } from '../ExcuseForm';

interface AdminExcuse { id: number; date: string; kind: ExcuseKind; reason: string; status: ExcuseState; createdAt: number; student: string; grade: string; guardianPhone: string | null; subject: string; evidence: Evidence[] }
const TONE = { pendiente: 'warn', aprobada: 'ok', rechazada: 'bad' } as const;

export function ExcusesAdminView() {
  const toast = useToast();
  const [status, setStatus] = useState<'' | ExcuseState>('pendiente');
  const load = useLoad(() => api.get<{ items: AdminExcuse[] }>(`/admin/excuses${status ? `?status=${status}` : ''}`), [status]);
  const [confirm, setConfirm] = useState<{ e: AdminExcuse; approve: boolean } | null>(null);
  const resolve = async () => {
    if (!confirm) return;
    try { await api.post(`/admin/excuses/${confirm.e.id}/resolve`, { approve: confirm.approve }); toast(confirm.approve ? 'Solicitud aprobada.' : 'Solicitud rechazada.'); load.reload(); } catch (e) { toast(errorMessage(e), 'bad'); }
    setConfirm(null);
  };
  return (
    <>
      <PageHeader title="Excusas y correcciones" subtitle="Al aprobar una excusa, la inasistencia queda como «justificada»." />
      <div className="chips" role="group" aria-label="Filtrar por estado">
        {([['pendiente', 'Pendientes'], ['aprobada', 'Aprobadas'], ['rechazada', 'Rechazadas'], ['', 'Todas']] as const).map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={status === id} onClick={() => setStatus(id)}>{label}</button>)}
      </div>
      <Async load={load}>{({ items }) => !items.length ? <Card><Empty icon="inbox" title="No hay solicitudes en esta vista" /></Card> : (
        <ul className="list">
          {items.map((e) => (
            <li key={e.id} className="item">
              <div className="item__head"><strong>{e.student} · {e.grade}</strong><Badge tone={TONE[e.status]}>{e.status}</Badge></div>
              <p className="muted">{kindLabel(e.kind)} · {e.subject} · {fmtDate(e.date)} · enviada {fmtDateTime(e.createdAt)}</p>
              <p className="item__body">{e.reason}</p>
              {e.evidence.length > 0 && <p className="row">{e.evidence.map((f) => <a key={f.id} href={`/api/evidence/${f.id}`} target="_blank" rel="noopener noreferrer" className="badge badge--info"><Icon name="paperclip" size={14} />{f.name}</a>)}</p>}
              <div className="row">
                {e.guardianPhone && <a className="btn btn--sm btn--secondary" href={`tel:${e.guardianPhone}`}><Icon name="phone" />Llamar al acudiente</a>}
                {e.status === 'pendiente' && <><Button size="sm" variant="primary" icon="check" onClick={() => setConfirm({ e, approve: true })}>Aprobar</Button><Button size="sm" icon="x" onClick={() => setConfirm({ e, approve: false })}>Rechazar</Button></>}
              </div>
            </li>
          ))}
        </ul>
      )}</Async>
      {confirm && <Confirm title={confirm.approve ? 'Aprobar solicitud' : 'Rechazar solicitud'} danger={!confirm.approve} confirmLabel={confirm.approve ? 'Aprobar' : 'Rechazar'} message={confirm.approve && confirm.e.kind !== 'error_registro' ? `La inasistencia de ${confirm.e.student} del ${fmtDate(confirm.e.date)} pasará a «justificada».` : `¿${confirm.approve ? 'Aprobar' : 'Rechazar'} la solicitud de ${confirm.e.student}?`} onConfirm={resolve} onClose={() => setConfirm(null)} />}
    </>
  );
}

export function FeedbackView() {
  const load = useLoad(() => api.get<{ items: { id: number; text: string; createdAt: number; guardian: string; student: string; grade: string; guardianPhone: string | null }[] }>('/admin/feedback'));
  return (
    <>
      <PageHeader title="Mensajes de los padres" subtitle="Quejas, sugerencias y dudas." />
      <Async load={load}>{({ items }) => !items.length ? <Card><Empty icon="message" title="No hay mensajes" /></Card> : (
        <ul className="list">{items.map((m) => (
          <li key={m.id} className="item">
            <div className="item__head"><strong>{m.guardian}</strong><span className="muted">{fmtDateTime(m.createdAt)}</span></div>
            <p className="muted">Sobre {m.student} · {m.grade}</p>
            <p className="item__body">{m.text}</p>
            {m.guardianPhone && <div><a className="btn btn--sm btn--secondary" href={`tel:${m.guardianPhone}`}><Icon name="phone" />Llamar</a></div>}
          </li>))}</ul>
      )}</Async>
    </>
  );
}

interface Notice { id: number; title: string; body: string; level: Level; audience: string; createdAt: number }
const AUDIENCE = { all: 'Todos', profesor: 'Profesores', estudiante: 'Estudiantes', padre: 'Padres' } as const;

export function NoticesAdminView() {
  const toast = useToast();
  const load = useLoad(() => api.get<{ items: Notice[] }>('/admin/notifications'));
  const [f, setF] = useState({ title: '', body: '', level: 'info' as Level, audience: 'all' as keyof typeof AUDIENCE });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setError(''); setBusy(true);
    try { await api.post('/admin/notifications', f); setF({ ...f, title: '', body: '' }); toast('Aviso publicado.'); load.reload(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const remove = async (id: number) => { try { await api.del(`/admin/notifications/${id}`); load.reload(); } catch (e) { toast(errorMessage(e), 'bad'); } };
  return (
    <>
      <PageHeader title="Avisos" subtitle="Comunicados que verán los usuarios al ingresar." />
      <Card title="Nuevo aviso">
        <Field label="Título"><input value={f.title} maxLength={100} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Mensaje"><textarea value={f.body} maxLength={600} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
        <div className="form-grid">
          <Field label="Para"><select value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value as keyof typeof AUDIENCE })}>{Object.entries(AUDIENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Importancia"><select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as Level })}><option value="info">Información</option><option value="warning">Importante</option><option value="critical">Urgente</option></select></Field>
        </div>
        {error && <p className="field__error" role="alert">{error}</p>}
        <div><Button variant="primary" icon="megaphone" loading={busy} onClick={() => void send()}>Publicar</Button></div>
      </Card>
      <Card title="Avisos publicados">
        <Async load={load}>{({ items }) => (
          <DataTable caption="Avisos" rows={items} rowKey={(n) => n.id} empty={<Empty icon="bell" title="No hay avisos" />}
            columns={[
              { key: 't', label: 'Aviso', render: (n) => <span><strong>{n.title}</strong><br /><span className="muted">{n.body}</span></span> },
              { key: 'a', label: 'Para', render: (n) => AUDIENCE[n.audience as keyof typeof AUDIENCE] ?? n.audience },
              { key: 'd', label: 'Fecha', render: (n) => fmtDateTime(n.createdAt) },
              { key: 'x', label: 'Acciones', align: 'end', render: (n) => <Button size="sm" icon="trash" aria-label={`Eliminar aviso ${n.title}`} onClick={() => void remove(n.id)} /> },
            ]} />
        )}</Async>
      </Card>
    </>
  );
}

// ---------- Reglas y contingencia ----------
export function RulesView() {
  const toast = useToast();
  const load = useLoad(() => api.get<{ rules: Rules; limits: { tolerance: number; absentAfter: number } }>('/admin/rules'));
  return (
    <>
      <PageHeader title="Reglas de asistencia" subtitle="Tiempos de tolerancia, horarios y contingencia." />
      <Async load={load}>{({ rules, limits }) => <RulesForms key={JSON.stringify(rules)} rules={rules} limits={limits} onSaved={(m) => { toast(m); load.reload(); }} />}</Async>
    </>
  );
}

function RulesForms({ rules, limits, onSaved }: { rules: Rules; limits: { tolerance: number; absentAfter: number }; onSaved: (msg: string) => void }) {
  const toast = useToast();
  const [r, setR] = useState({ toleranceMinutes: rules.toleranceMinutes, absentAfterMinutes: rules.absentAfterMinutes, riskThreshold: rules.riskThreshold });
  const [blocks, setBlocks] = useState<Block[]>(rules.blocks);
  const [c, setC] = useState({ active: rules.contingency.active, extraMinutes: rules.contingency.extraMinutes, reason: rules.contingency.reason });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const saveRules = async () => {
    setError(''); setBusy('rules');
    try { await api.put('/admin/rules', { ...r, blocks }); onSaved('Reglas guardadas. Los registros de hoy se recalcularon.'); } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  };
  const saveContingency = async (active: boolean) => {
    setBusy('cont');
    try { await api.put('/admin/contingency', { ...c, active }); onSaved(active ? 'Contingencia activada.' : 'Contingencia desactivada.'); } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(''); }
  };
  const setBlock = (i: number, patch: Partial<Block>) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const num = (v: string) => (v === '' ? NaN : Number(v));

  return (
    <>
      <Card title="Horario de contingencia" subtitle="Para lluvias, paros de transporte u otros eventos: amplía la tolerancia y recalcula los registros de hoy.">
        <Switch checked={c.active} label={c.active ? 'Activa' : 'Inactiva'} description={c.active ? `Tolerancia actual: ${limits.tolerance} min · ausente desde ${limits.absentAfter} min` : undefined} onChange={(v) => void saveContingency(v)} />
        <div className="form-grid">
          <Field label="Minutos extra de tolerancia"><input type="number" min={5} max={120} value={c.extraMinutes} onChange={(e) => setC({ ...c, extraMinutes: num(e.target.value) })} /></Field>
          <Field label="Motivo (se avisa a todos)"><input value={c.reason} maxLength={120} onChange={(e) => setC({ ...c, reason: e.target.value })} placeholder="Ej.: Lluvias fuertes" /></Field>
        </div>
        <p className="muted">Los cambios de minutos o motivo se aplican al activar la contingencia.</p>
        {busy === 'cont' && <p className="muted">Guardando…</p>}
      </Card>

      <Card title="Tiempos" subtitle="Cuántos minutos después de la hora de inicio cambia el estado.">
        <div className="form-grid">
          <Field label="Puntual hasta (minutos)"><input type="number" min={0} max={60} value={r.toleranceMinutes} onChange={(e) => setR({ ...r, toleranceMinutes: num(e.target.value) })} /></Field>
          <Field label="Ausente después de (minutos)" hint="Entre ambos límites se marca «tarde»."><input type="number" min={1} max={180} value={r.absentAfterMinutes} onChange={(e) => setR({ ...r, absentAfterMinutes: num(e.target.value) })} /></Field>
          <Field label="Alerta de convivencia desde" hint="Llegadas tarde o ausencias acumuladas."><input type="number" min={1} max={50} value={r.riskThreshold} onChange={(e) => setR({ ...r, riskThreshold: num(e.target.value) })} /></Field>
        </div>
        <h3>Franjas horarias</h3>
        <ul className="list">
          {blocks.map((b, i) => (
            <li key={i} className="item">
              <div className="form-grid">
                <Field label="Código"><input value={b.id} maxLength={8} onChange={(e) => setBlock(i, { id: e.target.value })} /></Field>
                <Field label="Nombre"><input value={b.label} maxLength={30} onChange={(e) => setBlock(i, { label: e.target.value })} /></Field>
                <Field label="Hora de inicio"><input type="time" value={b.start} onChange={(e) => setBlock(i, { start: e.target.value })} /></Field>
              </div>
              <div><Button size="sm" icon="trash" disabled={blocks.length <= 1} onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>Quitar franja</Button></div>
            </li>
          ))}
        </ul>
        <div><Button icon="plus" disabled={blocks.length >= 16} onClick={() => setBlocks([...blocks, { id: `B${blocks.length + 1}`, label: `${blocks.length + 1}ª hora`, start: '12:00' }])}>Agregar franja</Button></div>
        {error && <Alert tone="bad">{error}</Alert>}
        <div><Button variant="primary" icon="save" loading={busy === 'rules'} onClick={() => void saveRules()}>Guardar reglas</Button></div>
      </Card>
    </>
  );
}

// ---------- Auditoría ----------
export function AuditView() {
  const load = useLoad(() => api.get<{ items: { id: number; at: number; action: string; detail: string; ip: string; user: string | null }[] }>('/admin/audit'));
  return (
    <>
      <PageHeader title="Registro de actividad" subtitle="Últimos 200 eventos de seguridad y administración." actions={<Button icon="refresh" onClick={load.reload}>Actualizar</Button>} />
      <Card>
        <Async load={load}>{({ items }) => (
          <DataTable caption="Registro de actividad" rows={items} rowKey={(a) => a.id} empty={<Empty icon="shield" title="Sin eventos" />}
            columns={[
              { key: 'f', label: 'Fecha', render: (a) => fmtDateTime(a.at) }, { key: 'u', label: 'Usuario', render: (a) => a.user ?? '—' },
              { key: 'a', label: 'Acción', render: (a) => <span className="mono">{a.action}</span> }, { key: 'd', label: 'Detalle', render: (a) => a.detail || '—' }, { key: 'i', label: 'IP', render: (a) => <span className="mono">{a.ip || '—'}</span> },
            ]} />
        )}</Async>
      </Card>
    </>
  );
}
