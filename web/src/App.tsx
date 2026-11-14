import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from './api';
import { usePath } from './hooks';
import { Icon } from './icons';
import { Login } from './Login';
import { PasswordDialog } from './PasswordDialog';
import type { AppConfig, Role, SessionInfo, User } from './types';
import { Button, Loading, useToast } from './ui';
import { AdminView } from './views/Admin';
import { GuardianView } from './views/Guardian';
import { StudentView } from './views/Student';
import { TeacherView } from './views/Teacher';

export const dashboardPath = (role: Role) => `/dashboard/${role}`;
const ROLE_LABEL: Record<Role, string> = { admin: 'Administración', profesor: 'Profesor', estudiante: 'Estudiante', padre: 'Padre / acudiente' };

function Topbar({ user, institution, onPassword, onLogout }: { user?: User; institution?: string; onPassword?: () => void; onLogout?: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar__in">
        <div className="brand">
          <span className="brand__mark"><Icon name="qr" size={22} /></span>
          <span>SIAE{institution && <small>{institution}</small>}</span>
        </div>
        <span className="topbar__space" />
        {user && (
          <>
            <div className="who"><strong>{user.name}</strong><span>{ROLE_LABEL[user.role]}{user.grade ? ` · ${user.grade}` : ''}</span></div>
            {!user.mustChangePassword && onPassword && <Button variant="ghost" icon="key" onClick={onPassword} aria-label="Cambiar contraseña" title="Cambiar contraseña" />}
            <Button variant="ghost" icon="log-out" onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión" />
          </>
        )}
      </div>
    </header>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return <><a className="skip" href="#contenido">Saltar al contenido</a>{children}</>;
}

export function App() {
  const toast = useToast();
  const [path, go] = usePath();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [session, setSession] = useState<{ loaded: boolean; user: User | null }>({ loaded: false, user: null });
  const [changing, setChanging] = useState(false);

  const hadUser = useRef(false);
  useEffect(() => { hadUser.current = !!session.user; }, [session.user]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (hadUser.current) toast('Tu sesión terminó. Ingresa de nuevo.', 'info');
      setSession({ loaded: true, user: null });
    });
    api.get<AppConfig>('/config').then(setConfig).catch(() => setConfig({ institution: '', googleClientId: null, passwordDigits: 4 }));
    api.get<SessionInfo>('/session').then((s) => setSession({ loaded: true, user: s.user })).catch(() => setSession({ loaded: true, user: null }));
  }, [toast]);

  const refresh = useCallback(() => api.get<SessionInfo>('/session').then((s) => setSession({ loaded: true, user: s.user })), []);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setSession({ loaded: true, user: null });
    go('/', true);
  };

  const { loaded, user } = session;

  // Mantiene la URL coherente con el rol: sin sesión → "/", con sesión → su dashboard.
  useEffect(() => {
    if (!loaded) return;
    if (!user && path !== '/') go('/', true);
    else if (user && path !== dashboardPath(user.role)) go(dashboardPath(user.role), true);
  }, [loaded, user, path, go]);

  if (!loaded || !config) return <Frame><Topbar /><main id="contenido"><Loading label="Iniciando…" /></main></Frame>;

  if (!user) return <Frame><main id="contenido"><Login config={config} onLoggedIn={(u, redirectTo) => { setSession({ loaded: true, user: u }); go(redirectTo, true); }} /></main></Frame>;

  if (user.mustChangePassword) {
    return (
      <Frame>
        <Topbar user={user} institution={config.institution} onLogout={logout} />
        <main id="contenido" className="shell">
          <PasswordDialog forced onDone={refresh} onClose={logout} />
        </main>
      </Frame>
    );
  }

  const view = { admin: <AdminView />, profesor: <TeacherView user={user} />, estudiante: <StudentView onChangePassword={() => setChanging(true)} />, padre: <GuardianView /> }[user.role];

  return (
    <Frame>
      <Topbar user={user} institution={config.institution} onPassword={() => setChanging(true)} onLogout={logout} />
      {view}
      {changing && <PasswordDialog onDone={() => { setChanging(false); refresh(); }} onClose={() => setChanging(false)} />}
    </Frame>
  );
}
