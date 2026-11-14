# SIAE · Asistencia escolar con código QR

Sistema web de asistencia para colegios. Cada estudiante tiene un carnet digital (QR que cambia cada 45 segundos); el profesor lo escanea con la cámara del celular y el sistema registra si llegó **puntual, tarde o ausente** según las reglas del colegio. Padres, estudiantes y administración consultan todo desde el navegador.

> **¿Eres del colegio y no eres técnico?** Abre los documentos de la carpeta `docs/`:
> `INFORME_APLICATIVO.docx` (qué es y cómo funciona cada pantalla y botón), `MANUAL_COLEGIO.docx` (uso diario y alta de usuarios),
> `GUIA_INSTALACION.docx` (servidor del colegio) y `GUIA_VERCEL.docx` (publicar en Vercel).

## Dos formas de publicarlo

| | Servidor del colegio | Vercel |
|---|---|---|
| Datos | Archivo SQLite en `data/` | Turso (SQLite remoto), variable `TURSO_DATABASE_URL` |
| Proceso | `npm start` (Node permanente) | Función sin servidor `api/index.mjs` + archivos estáticos (`vercel.json`) |
| HTTPS / cámara / Google | Requiere proxy o túnel | Incluido |
| Guía | `docs/GUIA_INSTALACION.docx` | `docs/GUIA_VERCEL.docx` |

El mismo código sirve para ambos: la aplicación no guarda estado en memoria ni en disco que importe (sesiones, códigos de un solo uso del login con Google y límite de intentos viven en la base de datos).

## Roles y acceso

| Rol | Ingresa con | Panel |
|---|---|---|
| `estudiante` | Documento + contraseña (inicial: últimos 4 dígitos del documento) o Google | `/dashboard/estudiante` |
| `profesor` | Correo + contraseña temporal (se cambia al entrar) o Google | `/dashboard/profesor` |
| `padre` | Correo + contraseña temporal o Google | `/dashboard/padre` |
| `admin` | Correo + contraseña temporal o Google | `/dashboard/admin` |

Un único endpoint (`POST /api/auth/login`, cuerpo `{ usuario, password }`) atiende a todos; el servidor decide el rol y devuelve `redirectTo`.

## Puesta en marcha (resumen técnico)

Requiere **Node.js ≥ 22.13** (usa `node:sqlite`). Sin base de datos externa: un archivo SQLite en `data/`.

```bash
npm install
npm run init            # crea .env con APP_SECRET aleatorio
npm run build           # compila la interfaz a dist/
npm run create-admin    # primer administrador (contraseña temporal por consola)
npm start               # http://localhost:3000
```

Otros comandos: `npm test` (49 pruebas), `npm run test:remote` (las mismas pruebas por el adaptador de base remota), `npm run typecheck`, `npm run backup`, `npm run dev`.

En Windows hay accesos directos: `1-INSTALAR.bat`, `2-CREAR-ADMINISTRADOR.bat`, `3-INICIAR.bat`, `COPIA-DE-SEGURIDAD.bat`.

Variables de entorno: ver `.env.example` (todas comentadas).

## Arquitectura

```
server/                      Node sin dependencias externas (http, crypto, node:sqlite)
├── index.mjs · app.mjs      arranque y ensamblado: cabeceras → límites → CSRF → sesión → rol → ruta
├── modules/auth/            constants · validation · service · controller · routes
├── middleware/              rateLimit · csrf · authorize · errorHandler · staticFiles
├── routes/                  estudiante/padre · profesor · admin (personas, cursos, operaciones)
├── db.mjs · domain.mjs      esquema SQLite (local o Turso, interfaz asíncrona común) y reglas de negocio puras
└── security.mjs · google.mjs   scrypt, JWT HS256, QR firmado, verificación del ID token de Google
web/                         React 18 + TypeScript, CSS propio, sin librerías de UI
api/index.mjs                punto de entrada de la función en Vercel · vercel.json (rutas y cabeceras)
scripts/                     init · build (esbuild) · create-admin · backup
test/                        node:test — API completa con base en memoria
```

Dependencias de ejecución de la interfaz: `react`, `react-dom` y `jsqr` (lector de QR de respaldo para Safari/iOS). Nada se carga desde CDN.

## Seguridad aplicada

- **Contraseñas**: scrypt (N=2¹⁵) con sal por usuario; comparación en tiempo constante; hash ficticio si el usuario no existe (sin enumeración por tiempos).
- **Bloqueo**: 5 fallos → cuenta bloqueada 15 min; además límite por IP. Mensaje de error genérico (401).
- **Sesión**: JWT HS256 (`sub` = id, `role`, `jti`) firmado con una clave derivada de `APP_SECRET`, con algoritmo fijado, `iss`, `aud` y caducidad, **más** registro de la sesión en base de datos: cerrar sesión, cambiar contraseña o desactivar a un usuario la revoca al instante. Cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` con HTTPS).
- **CSRF**: SameSite, comprobación de `Origin` y cabecera `X-Requested-With`.
- **RBAC en el servidor**: cada ruta declara sus roles; los datos se filtran por pertenencia (un padre solo ve a sus hijos, un estudiante solo lo suyo, un profesor solo sus clases o reemplazos del día).
- **Contraseña temporal** para profesor/padre/admin: se muestra una sola vez; el sistema obliga a cambiarla antes de dar acceso a cualquier dato.
- **QR rotativo**: `SIAE1.<id>.<emisión>.<HMAC>`, válido ~2 min y emitido solo a la sesión del estudiante: una captura de pantalla compartida deja de servir enseguida.
- **Google**: verificación RS256 del ID token con las claves públicas de Google (`iss`, `aud`, `exp`, `email_verified`) y `nonce` de un solo uso. Es opcional.
- **Cabeceras**: CSP estricta, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS con HTTPS.
- **Entradas**: validación estricta con límites; SQL siempre parametrizado; evidencias validadas por contenido (JPG/PNG/WebP/PDF, 2 MB) y servidas aisladas; exportación CSV protegida contra inyección de fórmulas.
- **Auditoría**: registro de ingresos, bloqueos, cambios administrativos y exportaciones.

## Limitaciones que conviene conocer

- La contraseña inicial de los estudiantes (últimos 4 dígitos del documento) es débil por diseño: el documento no es secreto. Se compensa con bloqueo por intentos, límite por IP y el aviso para cambiarla; si quieres endurecerlo, puede exigirse el cambio en el primer ingreso (`authorize.mjs`).
- La cámara del celular y Google exigen **HTTPS**. En red local con `http://` la cámara no abre en la mayoría de celulares; el ingreso manual por documento sigue funcionando. Ver la guía de instalación.
- En modo servidor local: una sola instancia (SQLite en archivo).
- En Vercel, el límite general de peticiones por IP (`api`) es «mejor esfuerzo» por instancia; el límite de ingreso y el bloqueo por cuenta sí están en la base de datos y valen para todas las instancias.
- El plan gratuito (Hobby) de Vercel es para uso personal y no comercial según sus términos: confirme qué plan corresponde a una institución.
