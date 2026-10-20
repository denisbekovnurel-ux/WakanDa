import type { HelmetOptions } from 'helmet';

// Настройки безопасности вынесены из main.ts, чтобы их можно было покрыть тестами
// без запуска сервера.

export type TrustProxySetting = false | number | string;

/**
 * Express `trust proxy`. По умолчанию не доверяем никаким прокси: иначе клиент
 * может подделать X-Forwarded-For и обойти rate limit. За reverse proxy задайте
 * число хопов (`1`), пресет (`loopback`) или список подсетей.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxySetting {
  const value = (raw ?? '').trim();
  if (!value) return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * CORS: без явного списка доменов заголовки не отдаются вовсе, поэтому
 * cross-origin запросы из браузера не проходят. Same-origin (фронт и API на
 * одном домене) работает и без CORS.
 */
export function parseCorsOrigins(raw: string | undefined): string[] | false {
  const origins = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return origins.length ? origins : false;
}

export type SecurityCspOptions = {
  useDefaults: false;
  directives: Record<string, string[]>;
};

/**
 * CSP для SPA. Скрипты — только свои (Vite собирает внешние файлы, inline-скриптов
 * нет). Стили — свои + inline (React выставляет style-атрибуты) + Google Fonts,
 * которые подключаются через @import в App.css.
 */
export function buildContentSecurityPolicy(isProduction: boolean): SecurityCspOptions {
  return {
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'script-src': ["'self'"],
      'script-src-attr': ["'none'"],
      'worker-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'media-src': ["'self'"],
      'connect-src': ["'self'"],
      'manifest-src': ["'self'"],
      'object-src': ["'none'"],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      // Только в проде: локальный http-запуск (npm start без HTTPS) иначе
      // попытался бы грузить ассеты по https.
      ...(isProduction ? { 'upgrade-insecure-requests': [] } : {}),
    },
  };
}

export function buildHelmetOptions(isProduction: boolean): HelmetOptions {
  return {
    contentSecurityPolicy: buildContentSecurityPolicy(isProduction),
    // Не включаем COEP: приложение не использует SharedArrayBuffer, а лишний
    // заголовок ломает загрузку сторонних ресурсов без CORP.
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' },
    // HSTS имеет смысл только на HTTPS; над localhost браузер его всё равно
    // игнорирует, но в dev-режиме честнее не отправлять.
    strictTransportSecurity: isProduction
      ? { maxAge: 15_552_000, includeSubDomains: true }
      : false,
    // Остальные заголовки (nosniff, DNS-prefetch, download options,
    // permitted cross-domain policies, скрытие X-Powered-By) — дефолты helmet.
  };
}
