import { useState } from 'react';
import { Alert, Button, Dialog, useToast } from '../../ui';

export const ROLE_LABEL = { admin: 'Administrador', profesor: 'Profesor', padre: 'Padre / acudiente', estudiante: 'Estudiante' } as const;

/** Muestra la contraseña temporal UNA sola vez (en la base de datos solo queda su hash). */
export function TempPassword({ name, email, password, onClose }: { name: string; email: string; password: string; onClose: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(password); setCopied(true); } catch { toast('No se pudo copiar. Anótala a mano.', 'bad'); } };
  return (
    <Dialog title="Contraseña temporal" description={`Entrégasela a ${name}.`} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Ya la anoté</Button>}>
      <Alert tone="warn" icon="key"><strong>Solo se muestra ahora.</strong> Si se pierde, usa «Restablecer contraseña» para generar otra.</Alert>
      <p className="muted">Usuario: <strong>{email}</strong></p>
      <p className="mono" style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '.08em', textAlign: 'center', userSelect: 'all' }}>{password}</p>
      <Button icon={copied ? 'check' : 'paperclip'} onClick={() => void copy()}>{copied ? 'Copiada' : 'Copiar'}</Button>
      <p className="muted">Al primer ingreso el sistema le pedirá crear una contraseña propia.</p>
    </Dialog>
  );
}
