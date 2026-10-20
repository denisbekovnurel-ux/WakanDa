import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { buildHelmetOptions, parseCorsOrigins, parseTrustProxy } from './security/security.config';

// Подхватываем server/.env, если он есть (логин/пароль администратора, порт).
const envFile = join(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Состояние пользователя — один JSON на всю историю, поэтому стандартных 100 КБ
// из express недостаточно: автосохранение тихо падало бы с 413. Лимит настраиваемый.
const BODY_LIMIT = process.env.WAKANDA_BODY_LIMIT || '2mb';

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
  app.useStaticAssets(DIST_DIR);
  const express = app.getHttpAdapter().getInstance() as {
    get: (path: RegExp, handler: (request: unknown, response: { sendFile: (file: string) => void }) => void) => void;
  };
  // SPA-фолбэк: всё, что не /api, отдаёт index.html (но сначала сервер отдаёт
  // реальные ассеты из dist через useStaticAssets).
  express.get(/^(?!\/api\/?).*/, (_request, response) => response.sendFile(indexFile));
  console.log(`WakanDa: раздаём собранный фронтенд из ${DIST_DIR}`);
}

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  // Отключаем встроенный парсер, чтобы задать свой лимит, а не 100 КБ по умолчанию.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Security-заголовки ставим первыми — до раздачи статики и API.
  app.use(helmet(buildHelmetOptions(isProduction)));
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
  console.log(
    `WakanDa: CORS ${corsOrigins ? corsOrigins.join(', ') : 'только same-origin'}; `
      + `trust proxy ${trustProxy === false ? 'выключен' : trustProxy}`,
  );
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  serveFrontend(app);
  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  console.log(`WakanDa API: http://localhost:${port}/api`);
}

bootstrap();
