import { useState } from 'react';
import { api } from '../../api';
import type { Role } from '../../types';
import { Alert, Async, Badge, Button, Card, Confirm, DataTable, Dialog, Empty, Field, PageHeader, RowActions, errorMessage, fmtDateTime, useLoad, useToast } from '../../ui';
import { ROLE_LABEL, TempPassword } from './common';

type StaffRole = Exclude<Role, 'estudiante'>;
interface Person { id: number; role: StaffRole; name: string; email: string; docType: 'TI' | 'CC' | null; documento: string | null; status: 'activo' | 'inactivo'; googleLinked: boolean; mustChangePassword: boolean; courses: number; children: number; lastLoginAt: number | null }
interface Temp { name: string; email: string; password: string }

function UserForm({ person, onClose, onSaved }: { person: Person | null; onClose: () => void; onSaved: (temp?: Temp) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ role: (person?.role ?? 'profesor') as StaffRole, name: person?.name ?? '', email: person?.email ?? '', docType: (person?.docType ?? 'CC') as 'TI' | 'CC', documento: person?.documento ?? '', status: person?.status ?? 'activo' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError(''); setBusy(true);
    try {
      if (person) { await api.put(`/admin/users/${person.id}`, f); toast('Usuario actualizado.'); onSaved(); }
      else { const r = await api.post<{ temporaryPassword: string }>('/admin/users', f); onSaved({ name: f.name, email: f.email.trim().toLowerCase(), password: r.temporaryPassword }); }
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={person ? 'Editar usuario' : 'Nuevo usuario'} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" icon="save" loading={busy} onClick={() => void save()}>{person ? 'Guardar' : 'Crear usuario'}</Button></>}>
      {!person && <Field label="Rol" hint="Los estudiantes se crean en la sección Estudiantes."><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as StaffRole })}><option value="profesor">Profesor</option><option value="padre">Padre / acudiente</option><option value="admin">Administrador</option></select></Field>}
      <Field label="Nombre completo"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></Field>
      <Field label="Correo" hint={f.role === 'padre' ? 'Debe ser el mismo correo que se escribió como «acudiente» en sus hijos.' : 'Es su usuario para ingresar.'}><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <div className="form-grid">
        <Field label="Tipo de documento (opcional)"><select value={f.docType} onChange={(e) => setF({ ...f, docType: e.target.value as 'TI' | 'CC' })}><option value="CC">Cédula</option><option value="TI">Tarjeta de identidad</option></select></Field>
        <Field label="Número de documento (opcional)"><input value={f.documento} inputMode="numeric" onChange={(e) => setF({ ...f, documento: e.target.value })} /></Field>
      </div>
      {person && <Field label="Estado"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'activo' | 'inactivo' })}><option value="activo">Activo</option><option value="inactivo">Inactivo (no puede ingresar)</option></select></Field>}
      {!person && <Alert tone="info">Al crearlo se genera una contraseña temporal que verás una sola vez.</Alert>}
      {error && <p className="field__error" role="alert">{error}</p>}
    </Dialog>
  );
}

export function UsersView() {
  const toast = useToast();
  const [role, setRole] = useState<'' | StaffRole>('');
  const load = useLoad(() => api.get<{ items: Person[] }>(`/admin/users${role ? `?role=${role}` : ''}`), [role]);
  const [edit, setEdit] = useState<Person | 'new' | null>(null);
  const [temp, setTemp] = useState<Temp | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'reset' | 'delete'; p: Person } | null>(null);

  const reset = async (p: Person) => { try { const r = await api.post<{ temporaryPassword: string }>(`/admin/users/${p.id}/reset-password`); setConfirm(null); setTemp({ name: p.name, email: p.email, password: r.temporaryPassword }); load.reload(); } catch (e) { toast(errorMessage(e), 'bad'); setConfirm(null); } };
  const remove = async (p: Person) => { try { await api.del(`/admin/users/${p.id}`); toast('Usuario eliminado.'); load.reload(); } catch (e) { toast(errorMessage(e), 'bad'); } setConfirm(null); };

  return (
    <>
      <PageHeader title="Usuarios del colegio" subtitle="Profesores, padres de familia y administradores." actions={<Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Nuevo usuario</Button>} />
      <Card>
        <div className="chips" role="group" aria-label="Filtrar por rol">
          {([['', 'Todos'], ['profesor', 'Profesores'], ['padre', 'Padres'], ['admin', 'Administradores']] as const).map(([id, label]) => <button key={id} type="button" className="chip" aria-pressed={role === id} onClick={() => setRole(id)}>{label}</button>)}
        </div>
        <Async load={load}>{({ items }) => (
          <DataTable caption="Usuarios" rows={items} rowKey={(p) => p.id} empty={<Empty icon="user" title="No hay usuarios">Crea el primero con «Nuevo usuario».</Empty>}
            columns={[
              { key: 'n', label: 'Nombre', render: (p) => <span><strong>{p.name}</strong><br /><span className="muted">{p.email}</span></span> },
              { key: 'r', label: 'Rol', render: (p) => ROLE_LABEL[p.role] },
              { key: 'e', label: 'Estado', render: (p) => <span className="row"><Badge tone={p.status === 'activo' ? 'ok' : 'neutral'}>{p.status}</Badge>{p.mustChangePassword && <Badge tone="warn">Clave temporal</Badge>}{p.googleLinked && <Badge tone="info">Google</Badge>}</span> },
              { key: 'd', label: 'Detalle', render: (p) => (p.role === 'profesor' ? `${p.courses} curso(s)` : p.role === 'padre' ? `${p.children} hijo(s)` : '—') },
              { key: 'l', label: 'Último ingreso', render: (p) => (p.lastLoginAt ? fmtDateTime(p.lastLoginAt) : 'Nunca') },
              { key: 'x', label: 'Acciones', align: 'end', render: (p) => (
                <RowActions>
                  <Button size="sm" icon="edit" aria-label={`Editar ${p.name}`} onClick={() => setEdit(p)} />
                  <Button size="sm" icon="key" aria-label={`Restablecer contraseña de ${p.name}`} title="Restablecer contraseña" onClick={() => setConfirm({ kind: 'reset', p })} />
                  <Button size="sm" icon="trash" aria-label={`Eliminar ${p.name}`} onClick={() => setConfirm({ kind: 'delete', p })} />
                </RowActions>) },
            ]} />
        )}</Async>
      </Card>
      {edit && <UserForm person={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(t) => { setEdit(null); if (t) setTemp(t); load.reload(); }} />}
      {temp && <TempPassword {...temp} onClose={() => setTemp(null)} />}
      {confirm?.kind === 'reset' && <Confirm title="Restablecer contraseña" confirmLabel="Generar nueva" message={`Se generará una contraseña temporal para ${confirm.p.name} y se cerrarán sus sesiones abiertas.`} onConfirm={() => reset(confirm.p)} onClose={() => setConfirm(null)} />}
      {confirm?.kind === 'delete' && <Confirm danger title="Eliminar usuario" confirmLabel="Eliminar" message={`¿Eliminar a ${confirm.p.name}? Si tiene historial en el sistema, márcalo como inactivo en su lugar.`} onConfirm={() => remove(confirm.p)} onClose={() => setConfirm(null)} />}
    </>
  );
}
