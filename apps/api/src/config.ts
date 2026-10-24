export function loadConfig(env: NodeJS.ProcessEnv) {
  const port = Number(env.API_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT debe ser un entero entre 1 y 65535');
  }
  const corsOrigin = env.CORS_ORIGIN ?? 'http://localhost:5173';
  const origin = new URL(corsOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== corsOrigin) {
    throw new Error('CORS_ORIGIN debe ser un origen HTTP o HTTPS sin ruta');
  }
  return { port, corsOrigin };
}
