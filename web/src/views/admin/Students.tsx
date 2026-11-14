import { useEffect, useState } from 'react';
import { api } from '../../api';
import { parseCsv, TEMPLATE, toStudentRows, type ImportRow } from '../../csv';
import { Alert, Async, Badge, Button, Card, Confirm, DataTable, Dialog, Empty, Field, PageHeader, Pager, RowActions, errorMessage, useLoad, useToast } from '../../ui';

interface Student { id: number; name: string; docType: 'TI' | 'CC'; documento: string; grade: string; status: 'activo' | 'pendiente' | 'inactivo'; email: string | null; guardianEmail: string | null; guardianPhone: string | null; googleLinked: boolean; passwordIsDefault: boolean; locked: boolean }
interface Page { items: Student[]; total: number; page: number; pageSize: number; pending: number; grades: string[] }
const TONE = { activo: 'ok', pendiente: 'warn', inactivo: 'neutral' } as const;
const EMPTY = { name: '', docType: 'TI' as 'TI' | 'CC', documento: '', grade: '', guardianEmail: '', guardianPhone: '', status: 'activo' as Student['status'] };

function StudentForm({ student, grades, onClose, onSaved }: { student: Student | null; grades: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState(student ? { name: student.name, docType: student.docType, documento: student.documento, grade: student.grade, guardianEmail: student.guardianEmail ?? '', guardianPhone: student.guardianPhone ?? '', status: student.status } : EMPTY);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = async () => {
    setError(''); setBusy(true);
    try { if (student) await api.put(`/admin/students/${student.id}`, f); else await api.post('/admin/students', f); toast(student ? 'Estudiante actualizado.' : 'Estudiante creado.'); onSaved(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog title={student ? 'Editar estudiante' : 'Nuevo estudiante'} description={student ? undefined : 'Su contraseña inicial serán los últimos 4 dígitos del documento.'} onClose={onClose}
      footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" icon="save" loading={busy} onClick={() => void save()}>Guardar</Button></>}>
      <Field label="Nombre completo"><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} /></Field>
      <div className="form-grid">
        <Field label="Tipo de documento"><select value={f.docType} onChange={(e) => set('docType', e.target.value as 'TI' | 'CC')}><option value="TI">Tarjeta de identidad</option><option value="CC">Cédula</option></select></Field>
        <Field label="Número de documento"><input value={f.documento} inputMode="numeric" onChange={(e) => set('documento', e.target.value)} /></Field>
        <div><Field label="Grado"><input value={f.grade} list="grades" placeholder="Ej.: 10A" onChange={(e) => set('grade', e.target.value)} /></Field><datalist id="grades">{grades.map((g) => <option key={g} value={g} />)}</datalist></div>
        <Field label="Estado"><select value={f.status} onChange={(e) => set('status', e.target.value as Student['status'])}><option value="activo">Activo</option><option value="pendiente">Pendiente</option><option value="inactivo">Inactivo</option></select></Field>
      </div>
      <Field label="Correo del acudiente" hint="Con este correo el padre ve a su hijo(a) al ingresar."><input type="email" value={f.guardianEmail} onChange={(e) => set('guardianEmail', e.target.value)} /></Field>
      <Field label="Teléfono del acudiente"><input type="tel" value={f.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} /></Field>
      {error && <p className="field__error" role="alert">{error}</p>}
    </Dialog>
  );
}


function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [problem, setProblem] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: { line: number; message: string }[] } | null>(null);

  const pick = async (file: File | undefined) => {
    setProblem(''); setRows(null); setResult(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setProblem('El archivo es demasiado grande (máximo 5 MB).');
    const text = await file.text();
    if (text.includes('\uFFFD')) return setProblem('Las tildes se ven dañadas. En Excel usa «Guardar como» → «CSV UTF-8 (delimitado por comas)».');
    const parsed = toStudentRows(parseCsv(text));
    if (parsed.missing.length) return setProblem(`Faltan columnas en la primera fila: ${parsed.missing.join(', ')}. Descarga la plantilla para ver los nombres.`);
    if (!parsed.rows.length) return setProblem('El archivo no tiene estudiantes.');
    setRows(parsed.rows);
  };

  const run = async () => {
    if (!rows) return;
    let created = 0;
    const skipped: { line: number; message: string }[] = [];
    setProgress({ done: 0, total: rows.length });
    try {
      for (let i = 0; i < rows.length; i += 50) {
        const r = await api.post<{ created: number; skipped: { line: number; message: string }[] }>('/admin/students/import', { rows: rows.slice(i, i + 50) });
        created += r.created; skipped.push(...r.skipped);
        setProgress({ done: Math.min(i + 50, rows.length), total: rows.length });
      }
    } catch (e) { skipped.push({ line: 0, message: `Se interrumpió la carga: ${errorMessage(e)}` }); }
    setProgress(null); setResult({ created, skipped }); onDone();
  };

  const template = () => { const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'plantilla-estudiantes.csv'; a.click(); URL.revokeObjectURL(url); };

  return (
    <Dialog title="Importar estudiantes" description="Carga muchos estudiantes de una vez desde un archivo CSV." onClose={onClose}
      footer={result ? <Button variant="primary" onClick={onClose}>Cerrar</Button> : <><Button onClick={onClose}>Cancelar</Button><Button variant="primary" icon="save" disabled={!rows || !!progress} loading={!!progress} onClick={() => void run()}>{rows ? `Importar ${rows.length} estudiante(s)` : 'Importar'}</Button></>}>
      {!result && (
        <>
          <Alert tone="info" icon="file">Columnas: <strong>nombre, tipo (TI o CC), documento, grado, correo_acudiente, telefono_acudiente</strong>. Solo nombre, documento y grado son obligatorios. La contraseña inicial de cada uno serán los últimos 4 dígitos de su documento.</Alert>
          <div><Button icon="download" onClick={template}>Descargar plantilla</Button></div>
          <Field label="Archivo CSV"><input type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} /></Field>
          {problem && <Alert tone="bad">{problem}</Alert>}
          {rows && <Alert tone="ok" icon="check-circle">Listo para importar: {rows.length} fila(s). Primera: {rows[0].name} · {rows[0].documento} · {rows[0].grade}.</Alert>}
          {progress && <p role="status">Importando… {progress.done} de {progress.total}</p>}
        </>
      )}
      {result && (
        <>
          <Alert tone={result.skipped.length ? 'warn' : 'ok'} icon={result.skipped.length ? 'alert' : 'check-circle'}><strong>{result.created} estudiante(s) creados.</strong> {result.skipped.length ? `${result.skipped.length} fila(s) no se importaron:` : 'No hubo problemas.'}</Alert>
          {result.skipped.length > 0 && <ul className="list">{result.skipped.map((s, i) => <li key={i} className="item">{s.line ? `Línea ${s.line}: ` : ''}{s.message}</li>)}</ul>}
        </>
      )}
    </Dialog>
  );
}

export function StudentsView() {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState('');
  const [grade, setGrade] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => { const id = window.setTimeout(() => { setDebounced(q); setPage(0); }, 300); return () => window.clearTimeout(id); }, [q]);
  const load = useLoad(() => api.get<Page>(`/admin/students?${new URLSearchParams({ q: debounced, status, grade, page: String(page) })}`), [debounced, status, grade, page]);
  const [edit, setEdit] = useState<Student | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'reset' | 'delete'; s: Student } | null>(null);

  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); setConfirm(null); load.reload(); } catch (e) { toast(errorMessage(e), 'bad'); setConfirm(null); } };
  const approve = (s: Student) => run(() => api.put(`/admin/students/${s.id}`, { ...s, status: 'activo' }), `${s.name} aprobado(a).`);

  return (
    <>
      <PageHeader title="Estudiantes" subtitle="Registra, aprueba y edita estudiantes." actions={<><Button icon="upload" onClick={() => setImporting(true)}>Importar CSV</Button><Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Nuevo estudiante</Button></>} />
      <Card>
        <div className="filters">
          <Field label="Buscar"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre, documento o correo" /></Field>
          <Field label="Estado"><select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}><option value="">Todos</option><option value="activo">Activos</option><option value="pendiente">Pendientes</option><option value="inactivo">Inactivos</option></select></Field>
          <Field label="Grado"><select value={grade} onChange={(e) => { setGrade(e.target.value); setPage(0); }}><option value="">Todos</option>{load.data?.grades.map((g) => <option key={g}>{g}</option>)}</select></Field>
        </div>
        {!!load.data?.pending && status !== 'pendiente' && <Alert tone="info" icon="inbox"><div className="row"><span>{load.data.pending} registro(s) esperan aprobación.</span><Button size="sm" onClick={() => setStatus('pendiente')}>Verlos</Button></div></Alert>}
        <Async load={load}>{(d) => (
          <>
            <DataTable caption="Estudiantes" rows={d.items} rowKey={(s) => s.id} empty={<Empty icon="users" title="No hay estudiantes">Crea el primero con «Nuevo estudiante».</Empty>}
              columns={[
                { key: 'n', label: 'Estudiante', render: (s) => <span><strong>{s.name}</strong><br /><span className="muted mono">{s.docType} {s.documento}</span></span> },
                { key: 'g', label: 'Grado', render: (s) => s.grade },
                { key: 'e', label: 'Estado', render: (s) => <span className="row"><Badge tone={TONE[s.status]}>{s.status}</Badge>{s.googleLinked && <Badge tone="info">Google</Badge>}{s.locked && <Badge tone="bad">Bloqueado</Badge>}</span> },
                { key: 'a', label: 'Acudiente', render: (s) => s.guardianEmail ?? s.guardianPhone ?? '—' },
                { key: 'x', label: 'Acciones', align: 'end', render: (s) => (
                  <RowActions>
                    {s.status === 'pendiente' && <Button size="sm" variant="primary" icon="check" onClick={() => void approve(s)}>Aprobar</Button>}
                    <Button size="sm" icon="edit" aria-label={`Editar ${s.name}`} onClick={() => setEdit(s)} />
                    <Button size="sm" icon="key" aria-label={`Restablecer contraseña de ${s.name}`} title="Restablecer contraseña" onClick={() => setConfirm({ kind: 'reset', s })} />
                    <Button size="sm" icon="trash" aria-label={`Eliminar ${s.name}`} onClick={() => setConfirm({ kind: 'delete', s })} />
                  </RowActions>) },
              ]} />
            <Pager page={d.page} total={d.total} size={d.pageSize} onPage={setPage} />
          </>
        )}</Async>
      </Card>
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={load.reload} />}
      {edit && <StudentForm student={edit === 'new' ? null : edit} grades={load.data?.grades ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load.reload(); }} />}
      {confirm?.kind === 'reset' && <Confirm title="Restablecer contraseña" confirmLabel="Restablecer" message={`${confirm.s.name} volverá a entrar con los últimos 4 dígitos de su documento y se cerrarán sus sesiones abiertas.`} onConfirm={() => run(() => api.post(`/admin/students/${confirm.s.id}/reset-password`), 'Contraseña restablecida.')} onClose={() => setConfirm(null)} />}
      {confirm?.kind === 'delete' && <Confirm danger title="Eliminar estudiante" confirmLabel="Eliminar" message={`¿Eliminar a ${confirm.s.name}? Solo es posible si no tiene historial; de lo contrario, márcalo como inactivo.`} onConfirm={() => run(() => api.del(`/admin/students/${confirm.s.id}`), 'Estudiante eliminado.')} onClose={() => setConfirm(null)} />}
    </>
  );
}
