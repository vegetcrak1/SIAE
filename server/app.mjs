// Ensambla el servidor: cabeceras de seguridad → límites → CSRF → sesión → autorización por rol → ruta → respuesta.
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { HttpError, Router, SENT, clientIp, parseCookies, readBody, readJson, securityHeaders, serializeCookie } from './http.mjs';
import { createGoogleVerifier } from './google.mjs';
import { deriveKey } from './security.mjs';
import { createAuth } from './modules/auth/auth.service.mjs';
import { authRoutes } from './modules/auth/auth.routes.mjs';
import { createLimiters } from './middleware/rateLimit.mjs';
import { assertSameOrigin } from './middleware/csrf.mjs';
import { authorize } from './middleware/authorize.mjs';
import { toErrorResponse } from './middleware/errorHandler.mjs';
import { serveStatic } from './middleware/staticFiles.mjs';
import { studentRoutes } from './routes/student.mjs';
import { teacherRoutes } from './routes/teacher.mjs';
import { adminRoutes } from './routes/admin.mjs';
import { commonRoutes } from './routes/common.mjs';

export function createApp({ config, db, verifyGoogle, staticDir = resolve('dist') }) {
  const verify = verifyGoogle ?? createGoogleVerifier({ clientId: config.googleClientId });
  const auth = createAuth({ db, config, verifyGoogle: verify });
  const ctx = { config, db, auth, qrKey: deriveKey(config.secret, 'qr') };
  const cookieName = config.cookieSecure ? '__Host-siae' : 'siae';
  const baseHeaders = securityHeaders(config);
  const limiters = createLimiters(config, db);

  const router = new Router();
  for (const register of [authRoutes, commonRoutes, studentRoutes, teacherRoutes, adminRoutes]) register(router, ctx);

  const sendJson = (res, status, data, headers = {}) => {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
    res.end(body);
  };

  async function handleApi(req, res, url) {
    const ip = clientIp(req, config.trustProxy);
    await limiters.enforce('api', ip);

    const found = router.match(req.method, url.pathname);
    if (!found) throw new HttpError(404, 'not_found', 'Recurso no encontrado.');
    if (found.methodNotAllowed) throw new HttpError(405, 'method_not_allowed', 'Método no permitido.');
    const { route, params } = found;

    assertSameOrigin(req);
    if (route.opts.limiter) await limiters.enforce(route.opts.limiter, ip);

    const bearer = String(req.headers.authorization ?? '').startsWith('Bearer ') ? req.headers.authorization.slice(7).trim() : null;
    const token = parseCookies(req.headers.cookie)[cookieName] ?? bearer;
    const session = await auth.authenticate(token);
    authorize(route.opts, session?.user ?? null);

    const c = {
      req, res, url, params, ip, token, user: session?.user ?? null, jti: session?.jti ?? null,
      query: Object.fromEntries(url.searchParams),
      json: () => readJson(req),
      raw: (limit) => readBody(req, limit),
      setSession: (s) => res.setHeader('Set-Cookie', serializeCookie(cookieName, s.token, { maxAge: s.maxAge, secure: config.cookieSecure })),
      clearSession: () => res.setHeader('Set-Cookie', serializeCookie(cookieName, '', { maxAge: 0, secure: config.cookieSecure })),
      send(status, body, headers = {}) {
        res.writeHead(status, { 'Content-Length': body.length, 'Cache-Control': 'no-store', ...headers });
        res.end(body);
        return SENT;
      },
    };
    const result = await route.handler(c, ctx);
    if (result !== SENT) sendJson(res, 200, result ?? { success: true });
  }

  // Función de atención de una petición: sirve tanto al servidor local (http.createServer) como a Vercel (api/index.mjs).
  const handler = async (req, res) => {
    for (const [k, val] of Object.entries(baseHeaders)) res.setHeader(k, val);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else await serveStatic(req, res, url, staticDir);
    } catch (err) {
      if (res.headersSent) { res.destroy(); return; }
      const { status, headers, body } = toErrorResponse(err, req);
      sendJson(res, status, body, headers);
    }
  };

  const server = createServer(handler);
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;

  return { handler, server, ctx, async close() { limiters.close(); server.close(); await db.close(); } };
}
