// Capa HTTP del login: traduce petición → servicio → respuesta. La lógica de negocio vive en auth.service.mjs.
import { publicUser } from './auth.service.mjs';
import { DASHBOARD_BY_ROLE } from './auth.constants.mjs';
import { parseLogin } from './auth.validation.mjs';
import { PASSWORD_DIGITS } from '../../domain.mjs';

export function createAuthController({ config, auth }) {
  /** Respuesta de inicio de sesión exitoso: usuario básico, token y la ruta de destino según el rol. */
  const startSession = (c, { user, session }) => {
    c.setSession(session); // cookie HttpOnly + SameSite=Strict (la interfaz web usa solo la cookie)
    return { success: true, token: session.token, user: publicUser(user), redirectTo: DASHBOARD_BY_ROLE[user.role] };
  };

  return {
    config: () => ({ institution: config.institution, googleClientId: config.googleClientId || null, passwordDigits: PASSWORD_DIGITS }),

    session: (c) => (c.user ? { user: publicUser(c.user), redirectTo: DASHBOARD_BY_ROLE[c.user.role] } : { user: null }),

    async login(c) {
      const credentials = parseLogin(await c.json());                 // 400 si falta algo o el formato es inválido
      return startSession(c, await auth.login(credentials, c.ip));    // 401 genérico / 403 cuenta inactiva o pendiente
    },

    nonce: () => ({ nonce: auth.issueNonce() }),

    async google(c) {
      const body = await c.json();
      const result = await auth.googleLogin({ credential: body.credential, nonce: body.nonce }, c.ip);
      return result.status === 'ok' ? startSession(c, result) : { success: true, ...result };
    },

    async register(c) {
      const result = await auth.register(await c.json(), c.ip);
      return result.status === 'ok' ? startSession(c, result) : { success: true, status: 'pending' };
    },

    async logout(c) {
      await auth.destroySession(c.token);
      c.clearSession();
      return { success: true };
    },

    async changePassword(c) {
      const body = await c.json();
      await auth.changePassword(c.user, { current: body.current, next: body.next }, c.ip, c.jti);
      return { success: true };
    },
  };
}
