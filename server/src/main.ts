import 'reflect-metadata';
import './env';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { buildHelmetOptions, parseCorsOrigins, parseTrustProxy } from './security/security.config';
import { logger } from './observability/logger';
import { NestPinoLogger } from './observability/nest-logger';
import { requestLogger } from './observability/http-logger';
import { AllExceptionsFilter } from './observability/exception.filter';

// Состояние пользователя — один JSON на всю историю, поэтому стандартных 100 КБ
// из express недостаточно: автосохранение тихо падало бы с 413. Лимит настраиваемый.
const BODY_LIMIT = process.env.WAKANDA_BODY_LIMIT || '2mb';
const API_PREFIX = 'api';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
// Сюда Vite собирает фронтенд: server/src → project/dist.
const DIST_DIR = join(APP_DIR, '../../dist');

/**
 * В продакшене отдаём собранный фронтенд прямо с API-сервера (один процесс,
 * один домен — работает и с GitHub Pages-независимым хостингом без CDN).
 * Отключается через WAKANDA_SERVE_STATIC=0, если фронт раздаётся отдельно.
 */
function serveFrontend(app: NestExpressApplication) {
  if (process.env.WAKANDA_SERVE_STATIC === '0') return;
  const indexFile = join(DIST_DIR, 'index.html');
  if (!existsSync(indexFile)) return;
  app.useStaticAssets(DIST_DIR, {
    // Chrome устанавливает PWA только при корректном MIME манифеста, а
    // service worker нельзя кэшировать надолго — иначе обновления залипают.
    setHeaders: (response: { setHeader: (name: string, value: string) => void }, filePath: string) => {
      if (filePath.endsWith('.webmanifest')) {
        response.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.endsWith('sw.js')) {
        response.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        response.setHeader('Service-Worker-Allowed', '/');
      } else if (filePath.endsWith('index.html')) {
        response.setHeader('Cache-Control', 'no-cache');
      }
    },
  });
  const express = app.getHttpAdapter().getInstance() as {
    get: (path: RegExp, handler: (request: unknown, response: { sendFile: (file: string) => void }) => void) => void;
  };
  // SPA-фолбэк: всё, что не /api, отдаёт index.html (но сначала сервер отдаёт
  // реальные ассеты из dist через useStaticAssets).
  express.get(/^(?!\/api\/?).*/, (_request, response) => response.sendFile(indexFile));
  logger.info({ distDir: DIST_DIR }, 'serving built frontend');
}

/**
 * OpenAPI живёт в коде: список эндпоинтов нельзя забыть обновить вручную.
 * Отключается через WAKANDA_SWAGGER=0.
 */
function setupSwagger(app: NestExpressApplication) {
  if (process.env.WAKANDA_SWAGGER === '0') return;
  // Swagger UI инициализируется inline-скриптом, поэтому для /api/docs CSP
  // мягче, чем у приложения. Остальные ответы остаются под строгой CSP.
  app.use(`/${API_PREFIX}/docs`, (_request: unknown, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
    response.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "script-src-attr 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
      ].join('; '),
    );
    next();
  });
  const config = new DocumentBuilder()
    .setTitle('WakanDa API')
    .setDescription('Привычки, разовые задачи, напоминания, Telegram и Web Push.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'opaque' }, 'bearer')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document, { customSiteTitle: 'WakanDa API' });
  logger.info({ url: `/${API_PREFIX}/docs` }, 'api docs enabled');
}

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  // Отключаем встроенный парсер, чтобы задать свой лимит, а не 100 КБ по умолчанию.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    // Стартовые сообщения Nest буферизуем и отдаём в pino после useLogger,
    // чтобы весь stdout был одним JSON-потоком без ANSI-вставок.
    bufferLogs: true,
  });
  app.useLogger(new NestPinoLogger());
  // Request id + лог завершения запроса. Ставим до парсеров и guard'ов, чтобы
  // ошибки на любом этапе уже имели X-Request-Id.
  app.use('/api', requestLogger);
  app.useGlobalFilters(new AllExceptionsFilter());
  // Security-заголовки ставим первыми — до раздачи статики и API.
  app.use(helmet(buildHelmetOptions(isProduction)));
  // Permissions-Policy: отключаем ненужные браузерные возможности, чтобы
  // скомпрометированный скрипт не получил доступ к камере, микрофону и т.п.
  // Уведомления (web push) этой директивой не затрагиваются.
  app.use(
    (_request: { headers: Record<string, unknown> }, response: { setHeader: (name: string, value: string) => void }, next: () => void) => {
      response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), usb=(), payment=(), browsing-topics=(), ' +
        'fullscreen=(self), display-capture=(), accelerometer=(), gyroscope=(), magnetometer=()',
      );
      next();
    },
  );
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: BODY_LIMIT });
  // CORS только по явному списку. Без него разрешены лишь same-origin запросы —
  // так безопаснее по умолчанию, чем отражать любой Origin.
  const corsOrigins = parseCorsOrigins(process.env.WAKANDA_CORS_ORIGINS);
  if (corsOrigins) {
    app.enableCors({ origin: corsOrigins, credentials: true });
  }
  // Реальный IP за прокси нужен для rate limit, но доверять хопам вслепую нельзя:
  // X-Forwarded-For подделывается, если прокси не наш.
  const trustProxy = parseTrustProxy(process.env.WAKANDA_TRUST_PROXY);
  const expressInstance = app.getHttpAdapter().getInstance() as { set?: (key: string, value: unknown) => void };
  if (trustProxy !== false) expressInstance?.set?.('trust proxy', trustProxy);
  logger.info(
    {
      cors: corsOrigins ?? 'same-origin',
      trustProxy: trustProxy === false ? 'disabled' : trustProxy,
    },
    'http security configured',
  );
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  setupSwagger(app);
  serveFrontend(app);
  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  logger.info({ port, url: `http://localhost:${port}/api` }, 'api listening');
}

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'server failed to start');
  process.exitCode = 1;
});
