import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { HttpError } from '../http.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
};

/** Sirve la aplicación web compilada (carpeta dist). Cualquier ruta sin extensión devuelve index.html (navegación del lado del cliente). */
export async function serveStatic(req, res, url, staticDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Método no permitido.');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(staticDir, rel || 'index.html');
  if (file !== staticDir && !file.startsWith(staticDir + sep)) throw new HttpError(403, 'forbidden', 'Acceso denegado.');
  let info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    if (extname(rel)) throw new HttpError(404, 'not_found', 'No encontrado.');
    file = join(staticDir, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) throw new HttpError(404, 'not_found', 'Falta compilar la aplicación: ejecute npm run build.');
  }
  const body = await readFile(file);
  const hashed = /[-.][A-Z0-9]{8}\.\w+$/.test(file);
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}
