import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { Icon } from './icons';
import type { AppConfig, User } from './types';
import { Alert, Button, Field, errorMessage } from './ui';

interface LoginResponse { user: User; redirectTo: string }
interface Registration { registrationToken: string; email: string; name: string; grades: string[] }
type GoogleResult = ({ status: 'needs_registration' } & Registration) | ({ status?: undefined } & LoginResponse);

// ---------- Google Identity Services ----------
interface GisApi {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; nonce: string; ux_mode: string; auto_select: boolean; cancel_on_tap_outside: boolean }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
}
declare global { interface Window { google?: { accounts: { id: GisApi } } } }

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('gis')); };
    document.head.appendChild(s);
  });
  return gisPromise;
}

function GoogleButton({ clientId, resetKey, onCredential }: { clientId: string; resetKey: number; onCredential: (credential: string, nonce: string) => void }) {
  const slot = useRef<HTMLDivElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const cb = useRef(onCredential);
  cb.current = onCredential;

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        await loadGis();
        const { nonce } = await api.get<{ nonce: string }>('/auth/nonce');
        if (!live || !slot.current || !window.google) return;
        window.google.accounts.id.initialize({ client_id: clientId, nonce, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true, callback: (r) => cb.current(r.credential, nonce) });
        slot.current.innerHTML = '';
        window.google.accounts.id.renderButton(slot.current, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: 'es', width: Math.min(320, slot.current.clientWidth || 320) });
      } catch { if (live) setUnavailable(true); }
    })();
    return () => { live = false; };
  }, [clientId, resetKey]);

  return unavailable
    ? <p className="muted" style={{ textAlign: 'center' }}>Google no está disponible en este momento (se necesita internet).</p>
    : <div className="google-slot" ref={slot} />;
}

// ---------- Pantalla ----------
export function Login({ config, onLoggedIn }: { config: AppConfig; onLoggedIn: (user: User, redirectTo: string) => void }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [done, setDone] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const handleError = (e: unknown) => setError(errorMessage(e));

  const submit = async () => {
    setError('');
    if (!usuario.trim() || !password) return setError('Escribe tu correo o documento y tu contraseña.');
    setBusy(true);
    try {
      const r = await api.post<LoginResponse>('/auth/login', { usuario: usuario.trim(), password });
      onLoggedIn(r.user, r.redirectTo);
    } catch (e) { handleError(e); setPassword(''); } finally { setBusy(false); }
  };

  const onGoogle = useCallback(async (credential: string, nonce: string) => {
    setError('');
    setBusy(true);
    try {
      const r = await api.post<GoogleResult>('/auth/google', { credential, nonce });
      if (r.status === 'needs_registration') setRegistration(r);
      else onLoggedIn(r.user, r.redirectTo);
    } catch (e) { handleError(e); } finally { setBusy(false); setResetKey((k) => k + 1); }
  }, [onLoggedIn]);

  if (done) {
    return (
      <div className="auth"><div className="auth__card">
        <Alert tone="ok" icon="check-circle"><strong>¡Registro recibido!</strong><br />Un administrador del colegio lo revisará. Cuando lo apruebe, podrás ingresar con tu documento y la contraseña inicial (los últimos {config.passwordDigits} dígitos de tu documento) o con Google.</Alert>
        <Button variant="primary" onClick={() => { setDone(false); setRegistration(null); }}>Volver al inicio</Button>
      </div></div>
    );
  }

  if (registration) return <Registration data={registration} digits={config.passwordDigits} onBack={() => setRegistration(null)} onPending={() => setDone(true)} onLoggedIn={onLoggedIn} />;

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <span className="brand__mark"><Icon name="qr" size={26} /></span>
          <div><h1>SIAE</h1><p className="muted">{config.institution || 'Asistencia escolar con código QR'}</p></div>
        </div>

        <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          <Field label="Correo o número de documento">
            <input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="email" placeholder="Tu correo o tu documento" required />
          </Field>
          <Field label="Contraseña" hint={`Estudiantes: al principio es la de los últimos ${config.passwordDigits} dígitos de tu documento.`}>
            <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          <label className="check"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar contraseña</label>
          {error && <Alert tone="bad">{error}</Alert>}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="btn--block">Ingresar</Button>
        </form>

        {config.googleClientId && (
          <>
            <div className="divider">o</div>
            <GoogleButton clientId={config.googleClientId} resetKey={resetKey} onCredential={(c, n) => void onGoogle(c, n)} />
            <p className="muted" style={{ textAlign: 'center' }}>¿Primera vez? Ingresa con Google y registra tu documento.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Registration({ data, digits, onBack, onPending, onLoggedIn }: { data: Registration; digits: number; onBack: () => void; onPending: () => void; onLoggedIn: (u: User, to: string) => void }) {
  const [docType, setDocType] = useState<'TI' | 'CC'>('TI');
  const [documento, setDocumento] = useState('');
  const [name, setName] = useState(data.name);
  const [grade, setGrade] = useState(data.grades[0] ?? '');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (!/^\d{5,12}$/.test(documento.replace(/[.\s-]/g, ''))) return setError('Escribe tu número de documento (solo números).');
    if (!grade.trim()) return setError('Indica tu grado, por ejemplo 10A.');
    setBusy(true);
    try {
      const r = await api.post<{ status?: string; user?: User; redirectTo?: string }>('/auth/register', { registrationToken: data.registrationToken, docType, documento, name, grade, password: needsPassword ? password : undefined });
      if (r.user && r.redirectTo) onLoggedIn(r.user, r.redirectTo); else onPending();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'claim_requires_password') setNeedsPassword(true);
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="auth">
      <div className="auth__card">
        <div><h1>Completa tu registro</h1><p className="muted">Cuenta de Google: {data.email}</p></div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
          <Field label="Nombre completo"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required /></Field>
          <div className="form-grid">
            <Field label="Tipo de documento">
              <select value={docType} onChange={(e) => setDocType(e.target.value as 'TI' | 'CC')}><option value="TI">Tarjeta de identidad</option><option value="CC">Cédula</option></select>
            </Field>
            <Field label="Número de documento"><input value={documento} onChange={(e) => setDocumento(e.target.value)} inputMode="numeric" autoComplete="off" required /></Field>
          </div>
          <Field label="Grado" hint="Un administrador lo confirmará.">
            {data.grades.length ? <select value={grade} onChange={(e) => setGrade(e.target.value)}>{data.grades.map((g) => <option key={g}>{g}</option>)}</select>
              : <input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Ej.: 10A" required />}
          </Field>
          {needsPassword && (
            <Field label={`Contraseña inicial (últimos ${digits} dígitos de tu documento)`}>
              <input type="password" inputMode="numeric" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" required />
            </Field>
          )}
          {error && <Alert tone={needsPassword && !password ? 'info' : 'bad'}>{error}</Alert>}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="btn--block">Registrarme</Button>
          <Button onClick={onBack} className="btn--block">Cancelar</Button>
        </form>
      </div>
    </div>
  );
}
