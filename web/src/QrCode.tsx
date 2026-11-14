import { useMemo } from 'react';
import { encodeQr } from './qr';

/** Código QR vectorial (SVG) con zona de silencio de 4 módulos, como exige el estándar. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const m = encodeQr(value);
    const quiet = 4;
    let d = '';
    m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
    return { size: m.length + quiet * 2, path: d };
  }, [value]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
