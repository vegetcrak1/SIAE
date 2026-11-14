import { HttpError } from '../http.mjs';

/**
 * Defensa en profundidad contra CSRF para peticiones que cambian datos con cookie de sesión:
 * (1) cookie SameSite=Strict, (2) Origin igual al host del servidor, (3) cabecera propia que un sitio ajeno no puede añadir.
 * Las peticiones con "Authorization: Bearer" no usan credenciales automáticas del navegador, así que no son vulnerables a CSRF.
 */
export function assertSameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  if (String(req.headers.authorization ?? '').startsWith('Bearer ')) return;
  let sameOrigin = false;
  try { sameOrigin = !!req.headers.origin && new URL(req.headers.origin).host === req.headers.host; } catch { /* origen inválido */ }
  if (!sameOrigin || req.headers['x-requested-with'] !== 'siae') throw new HttpError(403, 'csrf', 'Solicitud no autorizada.');
}
