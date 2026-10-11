import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

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
  // Отключаем встроенный парсер, чтобы задать свой лимит, а не 100 КБ по умолчанию.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { extended: true, limit: BODY_LIMIT });
  // Ограничиваем CORS явным списком доменов, если он задан; иначе — как раньше.
  const corsOrigins = (process.env.WAKANDA_CORS_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  app.enableCors({ origin: corsOrigins.length ? corsOrigins : true, credentials: true });
  // За прокси/хостингом реальный IP приходит в заголовках — нужно для rate limit.
  const expressInstance = app.getHttpAdapter().getInstance() as { set?: (key: string, value: unknown) => void };
  expressInstance?.set?.('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  serveFrontend(app);
  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  console.log(`WakanDa API: http://localhost:${port}/api`);
}

bootstrap();
