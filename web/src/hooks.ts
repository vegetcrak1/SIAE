import { useCallback, useEffect, useState } from 'react';

const NAV_EVENT = 'siae:navigate';

/** Ruta actual (History API). Permite URLs reales como /dashboard/profesor sin librerías de ruteo. */
export function usePath(): [string, (path: string, replace?: boolean) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener('popstate', sync);
    window.addEventListener(NAV_EVENT, sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(NAV_EVENT, sync); };
  }, []);
  const go = useCallback((next: string, replace = false) => {
    if (next === window.location.pathname) return;
    window.history[replace ? 'replaceState' : 'pushState'](null, '', next);
    window.dispatchEvent(new Event(NAV_EVENT));
  }, []);
  return [path, go];
}

/** Pestaña activa guardada en el hash (#historial): sobrevive a recargas y funciona con el botón "atrás". */
export function useTab(ids: string[], fallback: string): [string, (id: string) => void] {
  const read = () => { const h = window.location.hash.slice(1); return ids.includes(h) ? h : fallback; };
  const [tab, setTab] = useState(read);
  useEffect(() => {
    const sync = () => setTab(read());
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);
  const select = useCallback((id: string) => {
    window.history.pushState(null, '', `${window.location.pathname}#${id}`);
    setTab(id);
    window.scrollTo({ top: 0 });
  }, []);
  return [tab, select];
}
