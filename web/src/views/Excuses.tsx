import type { Excuse } from '../types';
import { Badge, Empty, fmtDate } from '../ui';
import { Icon } from '../icons';
import { kindLabel } from './ExcuseForm';

const TONE = { pendiente: 'warn', aprobada: 'ok', rechazada: 'bad' } as const;

/** Lista de solicitudes con su estado y los archivos adjuntos (se abren en una pestaña nueva con la sesión actual). */
export function ExcuseList({ items }: { items: Excuse[] }) {
  if (!items.length) return <Empty icon="file" title="Todavía no hay solicitudes" />;
  return (
    <ul className="list">
      {items.map((e) => (
        <li key={e.id} className="item">
          <div className="item__head"><strong>{kindLabel(e.kind)} · {e.subject}</strong><Badge tone={TONE[e.status]}>{e.status}</Badge></div>
          <p className="muted">{fmtDate(e.date)}</p>
          <p>{e.reason}</p>
          {e.evidence.length > 0 && (
            <p className="row">{e.evidence.map((f) => <a key={f.id} href={`/api/evidence/${f.id}`} target="_blank" rel="noopener noreferrer" className="badge badge--info"><Icon name="paperclip" size={14} />{f.name}</a>)}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
