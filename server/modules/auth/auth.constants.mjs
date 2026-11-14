// El destino tras iniciar sesión lo decide SOLO el servidor según el rol guardado en la base de datos.
// Nunca se acepta una ruta de redirección enviada por el cliente (evita "open redirect").
export const DASHBOARD_BY_ROLE = Object.freeze({
  admin: '/dashboard/admin',
  profesor: '/dashboard/profesor',
  estudiante: '/dashboard/estudiante',
  padre: '/dashboard/padre',
});

export const ROLES = Object.freeze(Object.keys(DASHBOARD_BY_ROLE));

// Mismo mensaje si el usuario no existe, está bloqueado o la contraseña es errónea: no da pistas a un atacante.
export const GENERIC_AUTH_ERROR = 'Correo, documento o contraseña incorrectos.';

export const JWT_ISSUER = 'siae-api';
export const JWT_AUDIENCE = 'siae-web';
