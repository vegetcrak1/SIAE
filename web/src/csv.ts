// Lector de CSV sin dependencias: comillas, saltos de línea dentro de comillas, BOM y separador , ; o tabulación.
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const FIELDS: Record<string, string> = {
  nombre: 'name', nombres: 'name', estudiante: 'name', nombrecompleto: 'name',
  tipo: 'docType', tipodocumento: 'docType', tipodedocumento: 'docType',
  documento: 'documento', numerodocumento: 'documento', numerodedocumento: 'documento', cedula: 'documento', identificacion: 'documento',
  grado: 'grade', curso: 'grade',
  correoacudiente: 'guardianEmail', correodelacudiente: 'guardianEmail', emailacudiente: 'guardianEmail',
  telefonoacudiente: 'guardianPhone', telefonodelacudiente: 'guardianPhone', telefono: 'guardianPhone', celular: 'guardianPhone',
};

export interface ImportRow { line: number; name?: string; docType?: string; documento?: string; grade?: string; guardianEmail?: string; guardianPhone?: string }

/** Convierte las filas del CSV en estudiantes usando los nombres de columna del encabezado (con o sin tildes). */
export function toStudentRows(table: string[][]): { rows: ImportRow[]; missing: string[] } {
  const [header = [], ...body] = table;
  const map = header.map((h) => FIELDS[norm(h)]);
  const missing = ['name', 'documento', 'grade'].filter((f) => !map.includes(f)).map((f) => ({ name: 'nombre', documento: 'documento', grade: 'grado' })[f] as string);
  const rows = body.map((cells, i) => {
    const row: ImportRow = { line: i + 2 };
    cells.forEach((value, c) => { const key = map[c]; if (key && value) (row as unknown as Record<string, string>)[key] = value; });
    return row;
  });
  return { rows, missing };
}

export const TEMPLATE = '\uFEFFnombre,tipo,documento,grado,correo_acudiente,telefono_acudiente\r\nAna María Gómez,TI,1098765432,10A,acudiente@correo.com,3001234567\r\n';
