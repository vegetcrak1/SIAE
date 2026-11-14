import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { Button } from './ui';

interface BarcodeDetectorLike { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> }
declare global {
  interface Window { BarcodeDetector?: new (opts: { formats: string[] }) => BarcodeDetectorLike }
}

const DEBOUNCE_MS = 3000;
const FRAME_INTERVAL_MS = 120;

/** Escáner continuo: usa BarcodeDetector nativo si existe (Chrome/Android) y jsQR como alternativa (Safari/iOS). */
export function Scanner({ onScan }: { onScan: (text: string) => void }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let last = { text: '', at: 0 };
    setStarting(true);
    setError('');

    const fail = (message: string) => { if (!stopped) { setError(message); setActive(false); } };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return fail('Este navegador no permite usar la cámara (se requiere HTTPS). Use el ingreso manual.');
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch (e) {
        const name = (e as DOMException).name;
        return fail(name === 'NotAllowedError' ? 'Permiso de cámara denegado. Habilítelo en el navegador o use el ingreso manual.'
          : name === 'NotFoundError' ? 'No se detectó una cámara. Use el ingreso manual.' : 'No fue posible iniciar la cámara. Use el ingreso manual.');
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const video = videoRef.current as HTMLVideoElement;
      video.srcObject = stream;
      await video.play().catch(() => {});
      setStarting(false);

      const native = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
      const jsqr = native ? null : (await import('jsqr')).default;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const handle = (text: string) => {
        const now = Date.now();
        if (text === last.text && now - last.at < DEBOUNCE_MS) return;
        last = { text, at: now };
        navigator.vibrate?.(60);
        onScanRef.current(text);
      };

      const tick = async () => {
        if (stopped) return;
        if (!document.hidden && video.readyState >= 2) {
          try {
            if (native) {
              const codes = await native.detect(video);
              if (codes[0]) handle(codes[0].rawValue);
            } else if (jsqr && ctx) {
              const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
              canvas.width = Math.round(video.videoWidth * scale);
              canvas.height = Math.round(video.videoHeight * scale);
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const code = jsqr(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
              if (code) handle(code.data);
            }
          } catch { /* fotograma ilegible: se ignora */ }
        }
        timer = window.setTimeout(tick, FRAME_INTERVAL_MS);
      };
      tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      setStarting(false);
    };
  }, [active]);

  return (
    <div className="stack">
      <div className="scanner">
        <video ref={videoRef} playsInline muted aria-label="Vista de la cámara para escanear carnets" hidden={!active} />
        {active && !starting && <div className="scanner__frame" aria-hidden="true" />}
        {!active && (
          <div className="scanner__idle">
            <Icon name="scan" size={48} />
            <strong>Cámara apagada</strong>
            <span>Actívela para escanear el código del carnet digital.</span>
          </div>
        )}
        {starting && <div className="scanner__idle" role="status">Iniciando cámara…</div>}
      </div>
      {error && <p className="field__error" role="alert">{error}</p>}
      <Button size="lg" variant={active ? 'danger' : 'primary'} icon={active ? 'camera-off' : 'camera'} onClick={() => setActive(!active)} aria-pressed={active}>
        {active ? 'Detener cámara' : 'Activar cámara'}
      </Button>
    </div>
  );
}
