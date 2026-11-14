export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function request<T>(method: string, path: string, body?: unknown, init: { raw?: Blob; headers?: Record<string, string>; silent401?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Requested-With': 'siae', ...init.headers };
  let payload: BodyInit | undefined;
  if (init.raw) payload = init.raw;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Sin conexión con el servidor.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code ?? 'error', data?.error?.message ?? 'Ocurrió un error inesperado.');
    if (res.status === 401 && err.code === 'unauthenticated' && !init.silent401) onUnauthorized();
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: { silent401?: boolean }) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, file: File) => request<T>('POST', path, undefined, { raw: file, headers: { 'X-Filename': encodeURIComponent(file.name) } }),
};
