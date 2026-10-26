import pino from 'pino';

const LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);

function resolveLevel(): string {
  const requested = (process.env.WAKANDA_LOG_LEVEL || '').trim().toLowerCase();
  if (LEVELS.has(requested)) return requested;
  // Юнит-тесты не должны засорять вывод; e2e запускает отдельный процесс и
  // продолжает писать обычные логи.
  if (process.env.VITEST) return 'silent';
  return 'info';
}

const release = (process.env.WAKANDA_RELEASE || '').trim();

/**
 * Единый JSON-логгер сервера. Формат стабильный, чтобы его можно было без
 * парсера отправлять в journald, Loki, CloudWatch или любой другой сборщик.
 * Секреты и заголовки авторизации вырезаются на уровне pino.
 */
export const logger = pino({
  level: resolveLevel(),
  base: {
    service: 'wakanda-api',
    env: process.env.NODE_ENV || 'development',
    pid: process.pid,
    ...(release ? { release } : {}),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'newPassword',
      'currentPassword',
      'generatedPassword',
      'token',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.generatedPassword',
      '*.token',
      '*.authorization',
    ],
    censor: '[redacted]',
  },
});
