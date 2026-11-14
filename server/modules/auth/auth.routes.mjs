import { createAuthController } from './auth.controller.mjs';

export function authRoutes(router, ctx) {
  const ctl = createAuthController(ctx);
  router.add('GET', '/api/config', { public: true }, ctl.config);
  router.add('GET', '/api/session', { public: true }, ctl.session);
  router.add('POST', '/api/auth/login', { public: true, limiter: 'login' }, ctl.login);
  router.add('GET', '/api/auth/nonce', { public: true, limiter: 'nonce' }, ctl.nonce);
  router.add('POST', '/api/auth/google', { public: true, limiter: 'login' }, ctl.google);
  router.add('POST', '/api/auth/register', { public: true, limiter: 'login' }, ctl.register);
  router.add('POST', '/api/auth/logout', { public: true }, ctl.logout);
  router.add('POST', '/api/auth/password', { allowTemporary: true }, ctl.changePassword);
}
