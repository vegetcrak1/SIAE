// Cola de envío de registros: si no hay red, el escaneo se guarda en el dispositivo y se reintenta solo.
import { api, ApiError } from './api';

export interface ScanPayload { token?: string; documento?: string; scannedAt: number }
interface Queued { courseId: number; payload: ScanPayload }
const MAX_QUEUE = 300;
const key = (userId: number) => `siae.scans.${userId}`;

const read = (userId: number): Queued[] => { try { return JSON.parse(localStorage.getItem(key(userId)) ?? '[]'); } catch { return []; } };
const write = (userId: number, list: Queued[]) => { try { localStorage.setItem(key(userId), JSON.stringify(list.slice(-MAX_QUEUE))); } catch { /* almacenamiento lleno */ } };

export const queuedCount = (userId: number) => read(userId).length;

export async function sendScan<T>(userId: number, courseId: number, payload: ScanPayload): Promise<{ queued: false; result: T } | { queued: true }> {
  try {
    return { queued: false, result: await api.post<T>(`/profesor/classes/${courseId}/scan`, payload) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      write(userId, [...read(userId), { courseId, payload }]);
      return { queued: true };
    }
    throw e;
  }
}

/** Reenvía lo pendiente en orden; se detiene ante un fallo de red. Los rechazos definitivos (4xx) se descartan. */
export async function flushQueue(userId: number): Promise<{ sent: number; rejected: number; remaining: number }> {
  let list = read(userId);
  let sent = 0, rejected = 0;
  while (list.length) {
    const [item, ...rest] = list;
    try {
      await api.post(`/profesor/classes/${item.courseId}/scan`, item.payload);
      sent++;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) break;
      if (e instanceof ApiError && (e.status === 401 || e.status >= 500)) break;
      rejected++;
    }
    list = rest;
    write(userId, list);
  }
  return { sent, rejected, remaining: list.length };
}
