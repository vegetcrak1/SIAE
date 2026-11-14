import type { ReactNode } from 'react';
import { NavTabs, type NavItem } from '../ui';

/** Estructura común de cada panel: navegación (pestañas en móvil, barra lateral en escritorio si `side`) + contenido. */
export function Shell({ nav, current, onSelect, label, side, children }: { nav: NavItem[]; current: string; onSelect: (id: string) => void; label: string; side?: boolean; children: ReactNode }) {
  return (
    <div className={side ? 'shell shell--side' : 'shell'}>
      <NavTabs items={nav} current={current} onSelect={onSelect} label={label} />
      <main id="contenido" className="main" tabIndex={-1}>{children}</main>
    </div>
  );
}
