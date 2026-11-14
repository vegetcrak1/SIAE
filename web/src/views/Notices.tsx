import { useEffect } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import type { NotificationItem } from '../types';
import { Async, Badge, Button, Card, Empty, PageHeader, fmtDateTime, useLoad } from '../ui';

const LEVEL = { info: { tone: 'info', label: 'Información' }, warning: { tone: 'warn', label: 'Importante' }, critical: { tone: 'bad', label: 'Urgente' } } as const;

/** Cantidad de avisos sin leer (se actualiza cada minuto). */
export function useUnread(): number {
  const load = useLoad(() => api.get<{ unread: number }>('/notifications'));
  useEffect(() => {
    const id = window.setInterval(load.reload, 60_000);
    return () => window.clearInterval(id);
  }, [load.reload]);
  return load.data?.unread ?? 0;
}

export function NoticesView({ onRead }: { onRead?: () => void }) {
  const load = useLoad(() => api.get<{ items: NotificationItem[]; unread: number }>('/notifications'));
  const markAll = async () => { await api.post('/notifications/read', { all: true }); load.reload(); onRead?.(); };

  return (
    <>
      <PageHeader title="Avisos" subtitle="Comunicados del colegio." actions={<Button icon="check" disabled={!load.data?.unread} onClick={() => void markAll()}>Marcar todo como leído</Button>} />
      <Async load={load}>{({ items }) => items.length === 0 ? <Card><Empty icon="bell" title="No hay avisos" /></Card> : (
        <ul className="list">
          {items.map((n) => (
            <li key={n.id} className="item" style={n.read ? undefined : { borderColor: 'var(--brand)' }}>
              <div className="item__head">
                <strong><Icon name="megaphone" size={16} /> {n.title}</strong>
                <span className="row"><Badge tone={LEVEL[n.level].tone}>{LEVEL[n.level].label}</Badge>{!n.read && <Badge tone="info">Nuevo</Badge>}</span>
              </div>
              <p>{n.body}</p>
              <p className="muted">{fmtDateTime(n.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}</Async>
    </>
  );
}
