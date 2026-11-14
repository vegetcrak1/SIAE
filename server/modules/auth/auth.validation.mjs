import { HttpError } from '../../http.mjs';
import * as v from '../../domain.mjs';

const bad = (message) => new HttpError(400, 'invalid', message);

/**
 * Valida el cuerpo del login. Acepta correo (profesores, padres, administradores y estudiantes con Google)
 * o número de documento (estudiantes). Rechaza campos vacíos, formatos inválidos y campos desconocidos
 * (por ejemplo, un intento de enviar "role" desde el cliente).
 */
export function parseLogin(body) {
  for (const key of Object.keys(body)) {
    if (key !== 'usuario' && key !== 'password') throw bad('Solicitud inválida.');
  }
  const usuario = typeof body.usuario === 'string' ? body.usuario.trim() : '';
  if (!usuario) throw bad('El correo o el documento es obligatorio.');
  if (usuario.length > 254) throw bad('El correo o el documento es demasiado largo.');
  if (typeof body.password !== 'string' || body.password.length === 0) throw bad('La contraseña es obligatoria.');
  if (body.password.length > 128) throw bad('La contraseña es demasiado larga.');

  if (usuario.includes('@')) return { by: 'email', value: v.email(usuario, 'El correo'), password: body.password };
  try {
    return { by: 'documento', value: v.documento(usuario), password: body.password };
  } catch {
    throw bad('Escribe un correo válido o tu número de documento (solo números).');
  }
}
