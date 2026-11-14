import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { ApiError } from './api';
import { Icon, type IconName } from './icons';
import type { Status } from './types';

// ---------- Utilidades ----------
export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : 'Ocurrió un error inesperado.');

export const fmtTime = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '');
export const fmtDateTime = (ms: number) => new Date(ms).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
export const fmtDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
export const fmtSize = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(b / 1024))} KB`);

export const STATUS: Record<Status, { label: string; icon: IconName; tone: string }> = {
  puntual: { label: 'Puntual', icon: 'check-circle', tone: 'ok' },
  tarde: { label: 'Tarde', icon: 'clock', tone: 'warn' },
  ausente: { label: 'Ausente', icon: 'x-circle', tone: 'bad' },
  justificado: { label: 'Justificado', icon: 'shield', tone: 'info' },
};

/** Carga datos de la API y expone recarga; descarta respuestas de peticiones obsoletas. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: '' }));
    loader().then(
      (data) => { if (live) setState({ data, error: '', loading: false }); },
      (e) => { if (live) setState((s) => ({ data: s.data, error: errorMessage(e), loading: false })); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: useCallback(() => setTick((n) => n + 1), []) };
}

// ---------- Avisos emergentes ----------
type Tone = 'ok' | 'bad' | 'info';
const ToastCtx = createContext<(message: string, tone?: Tone) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; message: string; tone: Tone }[]>([]);
  const counter = useRef(0);
  const push = useCallback((message: string, tone: Tone = 'ok') => {
    const id = ++counter.current;
    setItems((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), tone === 'bad' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <Icon name={t.tone === 'bad' ? 'alert' : 'check-circle'} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Botón ----------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md' | 'lg'; icon?: IconName; loading?: boolean };
export function Button({ variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button type="button" className={cx('btn', `btn--${variant}`, `btn--${size}`, !children && 'btn--icon', className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <span className="spinner spinner--sm" aria-hidden="true" /> : icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

// ---------- Contenedores ----------
export function Card({ title, subtitle, actions, children, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="card__head">
          <div>{title && <h2 className="card__title">{title}</h2>}{subtitle && <p className="muted">{subtitle}</p>}</div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div>
      {actions && <div className="card__actions">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: Status }) {
  const m = STATUS[status];
  return <span className={`badge badge--${m.tone}`}><Icon name={m.icon} size={14} />{m.label}</span>;
}

export function Stat({ label, value, hint, tone = 'neutral', icon }: { label: string; value: ReactNode; hint?: string; tone?: string; icon: IconName }) {
  return (
    <div className="stat">
      <span className={`stat__icon stat__icon--${tone}`}><Icon name={icon} size={22} /></span>
      <div><p className="stat__label">{label}</p><p className="stat__value">{value}</p>{hint && <p className="stat__hint">{hint}</p>}</div>
    </div>
  );
}

export function Empty({ icon = 'inbox', title, children }: { icon?: IconName; title: string; children?: ReactNode }) {
  return <div className="empty"><Icon name={icon} size={36} /><p className="empty__title">{title}</p>{children && <p className="muted">{children}</p>}</div>;
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="alert alert--bad" role="alert"><Icon name="alert" /><span>{message}</span>{onRetry && <Button size="sm" onClick={onRetry}>Reintentar</Button>}</div>;
}

export function Alert({ tone = 'info', icon = 'alert', children }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; icon?: IconName; children: ReactNode }) {
  return <div className={`alert alert--${tone}`} role={tone === 'bad' ? 'alert' : undefined}><Icon name={icon} /><div>{children}</div></div>;
}

/** Renderiza el estado de una carga: spinner, error o contenido. */
export function Async<T>({ load, children }: { load: { data: T | null; error: string; loading: boolean; reload: () => void }; children: (data: T) => ReactNode }) {
  if (load.data) return <>{children(load.data)}</>;
  if (load.error) return <ErrorBox message={load.error} onRetry={load.reload} />;
  return <Loading />;
}

// ---------- Formularios ----------
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>; className?: string }) {
  const id = useId();
  const describedBy = [hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('field', className)}>
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && <p id={`${id}-h`} className="field__hint">{hint}</p>}
      {error && <p id={`${id}-e`} className="field__error" role="alert">{error}</p>}
    </div>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  const id = useId();
  return (
    <div className="switch">
      <div><span id={id}>{label}</span>{description && <p className="muted">{description}</p>}</div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} className="switch__track" onClick={() => onChange(!checked)}><span className="switch__thumb" /></button>
    </div>
  );
}

// ---------- Diálogo ----------
export function Dialog({ title, description, onClose, children, footer }: { title: string; description?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current as HTMLDivElement;
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'));
    (root.querySelector<HTMLElement>('input,select,textarea') ?? focusable()[1] ?? root).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); }
      if (e.key === 'Tab') {
        const items = focusable();
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); previous?.focus?.(); };
  }, []);

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className="dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined} tabIndex={-1}>
        <header className="dialog__head">
          <div><h2 id={`${id}-t`}>{title}</h2>{description && <p id={`${id}-d`} className="muted">{description}</p>}</div>
          <Button variant="ghost" icon="x" onClick={onClose} aria-label="Cerrar" />
        </header>
        <div className="dialog__body">{children}</div>
        {footer && <footer className="dialog__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function Confirm({ title, message, confirmLabel = 'Confirmar', danger, onConfirm, onClose }: { title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; onConfirm: () => Promise<void> | void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancelar</Button>
      <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>{confirmLabel}</Button>
    </>}>
      <p>{message}</p>
    </Dialog>
  );
}

// ---------- Navegación y tablas ----------
export interface NavItem { id: string; label: string; icon: IconName; badge?: number }

export function NavTabs({ items, current, onSelect, label }: { items: NavItem[]; current: string; onSelect: (id: string) => void; label: string }) {
  return (
    <nav className="nav" aria-label={label}>
      {items.map((it) => (
        <button key={it.id} type="button" className="nav__item" aria-current={it.id === current ? 'page' : undefined} onClick={() => onSelect(it.id)}>
          <Icon name={it.icon} size={18} /><span>{it.label}</span>
          {!!it.badge && <span className="nav__badge" aria-label={`${it.badge} pendientes`}>{it.badge}</span>}
        </button>
      ))}
    </nav>
  );
}

export interface Column<T> { key: string; label: string; render: (row: T) => ReactNode; align?: 'end' }

/** En pantallas angostas cada fila se convierte en una tarjeta con etiquetas (sin scroll horizontal). */
export function DataTable<T>({ columns, rows, rowKey, caption, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string | number; caption: string; empty?: ReactNode }) {
  if (!rows.length) return <>{empty ?? <Empty title="Sin resultados" />}</>;
  return (
    <table className="table">
      <caption className="sr-only">{caption}</caption>
      <thead><tr>{columns.map((c) => <th key={c.key} scope="col" className={c.align === 'end' ? 'end' : undefined}>{c.label}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)}>
            {columns.map((c) => <td key={c.key} data-label={c.label} className={c.align === 'end' ? 'end' : undefined}>{c.render(r)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;
  return (
    <nav className="pager" aria-label="Paginación">
      <Button size="sm" icon="chevron-left" disabled={page === 0} onClick={() => onPage(page - 1)}>Anterior</Button>
      <span aria-current="page">Página {page + 1} de {pages}</span>
      <Button size="sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)}>Siguiente<Icon name="chevron-right" /></Button>
    </nav>
  );
}

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="row-actions">{children}</div>;
}
