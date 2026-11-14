import { useState } from 'react';
import { api } from '../api';
import type { Course, ExcuseKind } from '../types';
import { Button, Dialog, Field, errorMessage, fmtSize, useToast } from '../ui';

const KIND_LABEL: Record<ExcuseKind, string> = { medica: 'Excusa médica', personal: 'Excusa personal', error_registro: 'Error en el registro' };
export const kindLabel = (k: ExcuseKind) => KIND_LABEL[k];
const MAX_FILES = 3;
const MAX_BYTES = 2 * 1024 * 1024;


/** Solicitud de excusa o de corrección, con hasta 3 archivos de evidencia (imagen o PDF, 2 MB c/u). */
export function ExcuseForm({ studentId, today, courses, kinds, initial, onClose, onSaved }: {
  studentId?: number; today: string; courses: Course[]; kinds: ExcuseKind[]; initial?: { courseId?: number; date?: string }; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<ExcuseKind>(kinds[0]);
  const [courseId, setCourseId] = useState<number>(initial?.courseId ?? courses[0]?.id ?? 0);
  const [date, setDate] = useState(initial?.date ?? today);
  const [reason, setReason] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const minDate = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);

  const pickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    if (picked.length > MAX_FILES) return setError(`Máximo ${MAX_FILES} archivos.`);
    const big = picked.find((f) => f.size > MAX_BYTES);
    if (big) return setError(`"${big.name}" supera los 2 MB.`);
    setError('');
    setFiles(picked);
  };

  const submit = async () => {
    setError('');
    if (!courseId) return setError('Selecciona la asignatura.');
    if (reason.trim().length < 10) return setError('Cuéntanos qué pasó con al menos 10 caracteres.');
    setBusy(true);
    try {
      const { id } = await api.post<{ id: number }>('/excuses', { studentId, courseId, date, kind, reason });
      let failed = 0;
      for (const f of files) { try { await api.upload(`/excuses/${id}/evidence`, f); } catch { failed++; } }
      toast(failed ? `Solicitud enviada, pero ${failed} archivo(s) no se pudieron adjuntar.` : 'Solicitud enviada. La administración la revisará.', failed ? 'bad' : 'ok');
      onSaved();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog title={kinds.length === 1 ? KIND_LABEL[kinds[0]] : 'Nueva solicitud'} onClose={onClose} footer={<><Button onClick={onClose}>Cancelar</Button><Button variant="primary" icon="send" loading={busy} onClick={() => void submit()}>Enviar</Button></>}>
      {kinds.length > 1 && <Field label="Tipo de solicitud"><select value={kind} onChange={(e) => setKind(e.target.value as ExcuseKind)}>{kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>}
      <Field label="Asignatura"><select value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>{courses.map((c) => <option key={c.id} value={c.id}>{c.subject} · {c.blockLabel}</option>)}</select></Field>
      <Field label="Fecha" hint="Solo se aceptan solicitudes de los últimos 60 días."><input type="date" value={date} min={minDate} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="¿Qué pasó?"><textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="Describe el motivo con claridad." /></Field>
      <Field label="Evidencia (opcional)" hint="Fotos (JPG, PNG, WebP) o PDF. Hasta 3 archivos de 2 MB.">
        <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => pickFiles(e.target.files)} />
      </Field>
      {files.length > 0 && <ul className="muted">{files.map((f) => <li key={f.name}>{f.name} · {fmtSize(f.size)}</li>)}</ul>}
      {error && <p className="field__error" role="alert">{error}</p>}
    </Dialog>
  );
}
