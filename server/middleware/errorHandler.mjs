import { HttpError } from '../http.mjs';

/** Convierte cualquier error en una respuesta JSON segura: los detalles internos solo van al registro del servidor. */
export function toErrorResponse(err, req) {
  if (err instanceof HttpError) {
    const { retryAfter, ...extra } = err.extra ?? {};
    return {
      status: err.status,
      headers: retryAfter ? { 'Retry-After': String(retryAfter) } : {},
      body: { success: false, error: { code: err.code, message: err.message, ...extra } },
    };
  }
  console.error('[error]', req.method, req.url?.split('?')[0], err);
  return { status: 500, headers: {}, body: { success: false, error: { code: 'internal', message: 'Ocurrió un error inesperado. Intenta de nuevo.' } } };
}
