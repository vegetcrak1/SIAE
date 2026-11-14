// Reglas de negocio y validaciones puras (sin I/O).
import { HttpError } from './http.mjs';

export const STATUSES = ['puntual', 'tarde', 'ausente', 'justificado'];
export const PASSWORD_DIGITS = 4;

export const hhmmToMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Fecha (YYYY-MM-DD) y minutos desde medianoche en la zona horaria del colegio. */
export function localParts(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

const bonus = (rules) => (rules.contingency.active ? rules.contingency.extraMinutes : 0);

/** puntual ≤ tolerancia · tarde ≤ umbral de ausencia · ausente después. La contingencia desplaza ambos límites. */
export function computeStatus(minutesLate, rules) {
  if (minutesLate <= rules.toleranceMinutes + bonus(rules)) return 'puntual';
  if (minutesLate <= rules.absentAfterMinutes + bonus(rules)) return 'tarde';
  return 'ausente';
}

export const effectiveLimits = (rules) => ({
  tolerance: rules.toleranceMinutes + bonus(rules),
  absentAfter: rules.absentAfterMinutes + bonus(rules),
});

export const defaultPassword = (documento) => documento.slice(-PASSWORD_DIGITS);

// ---------- Validación de entrada ----------
const bad = (message) => new HttpError(400, 'invalid', message);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function text(value, label, { min = 1, max = 200, multiline = false } = {}) {
  if (typeof value !== 'string') throw bad(`${label} es obligatorio.`);
  let v = value.normalize('NFC').replace(CONTROL, '').trim();
  if (!multiline) v = v.replace(/\s+/g, ' ');
  if (v.length < min) throw bad(min > 1 ? `${label} debe tener al menos ${min} caracteres.` : `${label} es obligatorio.`);
  if (v.length > max) throw bad(`${label} no puede superar ${max} caracteres.`);
  return v;
}

export function optionalText(value, label, opts) {
  return value === undefined || value === null || value === '' ? '' : text(value, label, { ...opts, min: 0 });
}

export function documento(value) {
  const v = typeof value === 'string' ? value.replace(/[.\s-]/g, '') : '';
  if (!/^\d{5,12}$/.test(v)) throw bad('Ingrese un número de documento válido (solo dígitos, entre 5 y 12).');
  return v;
}

export function docType(value) {
  if (value !== 'TI' && value !== 'CC') throw bad('Seleccione tarjeta de identidad (TI) o cédula (CC).');
  return value;
}

export function email(value, label = 'El correo') {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad(`${label} no es válido.`);
  return v;
}

export function grade(value) {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!/^[0-9A-ZÑ][0-9A-ZÑ\- ]{0,9}$/.test(v)) throw bad('Grado inválido (ej.: 10A).');
  return v;
}

export function phone(value) {
  if (value === undefined || value === null || value === '') return '';
  const v = String(value).trim();
  if (!/^\+?[\d\s()-]{7,20}$/.test(v)) throw bad('Teléfono inválido.');
  return v;
}

export function isoDate(value, label = 'La fecha') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw bad(`${label} no es válida.`);
  }
  return value;
}

export function oneOf(value, allowed, label) {
  if (!allowed.includes(value)) throw bad(`${label} no es válido.`);
  return value;
}

export function id(value, label = 'El identificador') {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw bad(`${label} no es válido.`);
  return n;
}

export function validateRules(input) {
  const int = (v, label, min, max) => {
    if (!Number.isInteger(v) || v < min || v > max) throw bad(`${label} debe ser un entero entre ${min} y ${max}.`);
    return v;
  };
  const toleranceMinutes = int(input?.toleranceMinutes, 'La tolerancia', 0, 60);
  const absentAfterMinutes = int(input?.absentAfterMinutes, 'El límite de ausencia', 1, 180);
  if (absentAfterMinutes <= toleranceMinutes) throw bad('El límite de ausencia debe ser mayor que la tolerancia.');
  const riskThreshold = int(input?.riskThreshold, 'El umbral de alerta', 1, 50);
  if (!Array.isArray(input?.blocks) || input.blocks.length < 1 || input.blocks.length > 16) throw bad('Defina entre 1 y 16 franjas horarias.');
  const seen = new Set();
  const blocks = input.blocks.map((b) => {
    const blockId = text(b?.id, 'El identificador de franja', { max: 8 });
    if (!/^[A-Za-z0-9]+$/.test(blockId) || seen.has(blockId)) throw bad('Los identificadores de franja deben ser únicos y alfanuméricos.');
    seen.add(blockId);
    if (typeof b.start !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start)) throw bad('Hora de inicio inválida (HH:MM).');
    return { id: blockId, label: text(b.label, 'El nombre de la franja', { max: 30 }), start: b.start };
  });
  return { toleranceMinutes, absentAfterMinutes, riskThreshold, blocks };
}
