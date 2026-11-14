import { useState } from 'react';
import { api } from './api';
import { Alert, Button, Card, Dialog, Field, errorMessage, useToast } from './ui';

/** Cambio de contraseña. `forced` = contraseña temporal: pantalla completa, no se puede omitir. */
export function PasswordDialog({ forced, onDone, onClose }: { forced?: boolean; onDone: () => void; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (next.length < 8) return setError('La nueva contraseña debe tener al menos 8 caracteres.');
    if (next !== again) return setError('Las dos contraseñas nuevas no coinciden.');
    setBusy(true);
    try {
      await api.post('/auth/password', { current, next });
      toast('Contraseña actualizada.');
      onDone();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  const form = (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void submit(); }} noValidate>
      {forced && <Alert tone="warn">Entraste con una contraseña temporal. Por seguridad, elige una propia para continuar.</Alert>}
      <Field label={forced ? 'Contraseña temporal' : 'Contraseña actual'}><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
      <Field label="Contraseña nueva" hint="Mínimo 8 caracteres. No uses tu documento."><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
      <Field label="Repite la contraseña nueva"><input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>
      {error && <p className="field__error" role="alert">{error}</p>}
      <div className="row">
        <Button type="submit" variant="primary" loading={busy}>Guardar contraseña</Button>
        {forced && <Button onClick={onClose}>Cerrar sesión</Button>}
      </div>
    </form>
  );

  if (forced) return <div className="main" style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}><Card title="Crea tu contraseña">{form}</Card></div>;
  return <Dialog title="Cambiar contraseña" onClose={onClose}>{form}</Dialog>;
}
