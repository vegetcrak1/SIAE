import { HttpError } from '../http.mjs';

/**
 * Control de acceso (RBAC) en el servidor. `opts` viene de la definición de la ruta:
 *   public: no exige sesión · roles: lista de roles permitidos · allowTemporary: permitida con contraseña temporal.
 * La redirección al dashboard es solo comodidad de la interfaz; la autorización real ocurre aquí.
 */
export function authorize(opts, user) {
  if (opts.public) return;
  if (!user) throw new HttpError(401, 'unauthenticated', 'Inicia sesión para continuar.');
  if (opts.roles && !opts.roles.includes(user.role)) throw new HttpError(403, 'forbidden', 'No tienes permiso para esta acción.');
  // Quien entra con una contraseña temporal (profesores, padres, administradores) debe cambiarla antes de usar el sistema.
  if (user.password_is_default && user.role !== 'estudiante' && !opts.allowTemporary) {
    throw new HttpError(403, 'must_change_password', 'Debes cambiar tu contraseña temporal para continuar.');
  }
}
