# Деплой и эксплуатация

## Два файла `.env`

- `server/.env` — переменные самого Node/API при запуске без Docker.
- `.env` в корне проекта — только подстановки для `docker compose` (в том числе
  `WAKANDA_IMAGE`, пароль админа и Telegram-токены).

Оба файла в `.gitignore`. Значения из корневого `.env` передаются в контейнер через
`docker-compose.yml`.

## Локальная разработка

```bash
nvm use                 # Node 22, файл .nvmrc
npm ci
npm ci --prefix server
npm run dev
```

Интерфейс — http://localhost:5173, API — http://localhost:3001/api,
Swagger — http://localhost:3001/api/docs.

## Docker (один контейнер)

```bash
cp .env.example .env    # обязательно задайте WAKANDA_ADMIN_PASS
docker compose up -d --build
```

Образ собирает фронтенд, а NestJS раздаёт `dist/` и `/api` с одного домена —
CORS не нужен: интерфейс стучится в свой API с Bearer-токеном. Web Push не
зависит от CORS, но требует HTTPS (см. ниже). Данные (SQLite) и ключи VAPID
лежат в томе `wakanda-data` и переживают пересборку.

### Готовый образ из GitHub (GHCR)

Каждый push в `main` после зелёного CI публикует:

- `ghcr.io/denisbekovnurel-ux/wakanda:latest`
- `ghcr.io/denisbekovnurel-ux/wakanda:sha-<коммит>`

Локальный Docker для сборки не нужен:

```bash
# в корневом .env:
WAKANDA_IMAGE=ghcr.io/denisbekovnurel-ux/wakanda:latest

docker compose pull
docker compose up -d
```

Пакет приватный. Сделайте его публичным (GitHub → Packages → Package settings)
или один раз войдите на сервере:

```bash
echo "<PAT>" | docker login ghcr.io -u denisbekovnurel-ux --password-stdin
```

Токену достаточно `read:packages` (classic PAT) или `Packages: read` (fine-grained).
Обновление: `docker compose pull && docker compose up -d`.

## Переменные окружения

| Переменная | Где задаётся | По умолчанию | Назначение |
| --- | --- | --- | --- |
| `PORT` | `server/.env`, compose | `3001` | Порт API |
| `WAKANDA_ADMIN_USER` | `server/.env`, compose | `waka_admin` | Логин администратора |
| `WAKANDA_ADMIN_PASS` | `server/.env`, compose | — | Пароль администратора (обязателен в проде) |
| `WAKANDA_BODY_LIMIT` | `server/.env`, compose | `2mb` | Лимит JSON-тела запроса |
| `WAKANDA_CORS_ORIGINS` | `server/.env`, compose | выключен | Домены через запятую; пусто = same-origin |
| `WAKANDA_TRUST_PROXY` | `server/.env`, compose | не доверять | Число хопов / `loopback` / подсети |
| `NODE_ENV` | `server/.env`, compose | — | `production`: HSTS и `upgrade-insecure-requests` |
| `WAKANDA_DATA_DIR` | `server/.env`, compose | `server/data` | Каталог SQLite (в контейнере `/data`) |
| `WAKANDA_VAPID_PUBLIC` / `WAKANDA_VAPID_PRIVATE` | `server/.env`, compose | генерируются | Ключи Web Push |
| `WAKANDA_VAPID_SUBJECT` | `server/.env`, compose | `mailto:admin@wakanda.local` | Контакт для push-сервисов |
| `WAKANDA_SERVE_STATIC` | `server/.env`, compose | включено | `0` — не раздавать `dist/` |
| `WAKANDA_LOG_LEVEL` | `server/.env`, compose | `info` | `fatal` … `trace`, `silent` |
| `WAKANDA_RELEASE` | `server/.env`, compose | — | Метка релиза в логах сервера |
| `VITE_RELEASE` | сборка фронта | — | Метка релиза в клиентских ошибках |
| `WAKANDA_IMAGE` | корневой `.env` | `wakanda:latest` | Образ для `docker compose pull` |
| `WAKANDA_SWAGGER` | `server/.env`, compose | включено | `0` — выключить `/api/docs` |
| `WAKANDA_TELEGRAM_BOT_TOKEN` | `server/.env`, compose | — | Токен от @BotFather |
| `WAKANDA_TELEGRAM_BOT_USERNAME` | `server/.env`, compose | из `getMe` | Имя бота для deep link |
| `WAKANDA_TELEGRAM_WEBHOOK_URL` | `server/.env`, compose | — | Публичный HTTPS-адрес вебхука |
| `WAKANDA_TELEGRAM_WEBHOOK_SECRET` | `server/.env`, compose | — | Секрет `X-Telegram-Bot-Api-Secret-Token` |

Подробности Telegram-переменных — в [docs/telegram.md](telegram.md).

## Вход администратора

Перед публикацией обязательно задайте `WAKANDA_ADMIN_PASS`: в production сервер
не стартует без него. Логин — `WAKANDA_ADMIN_USER`. Пароль меняется осознанно,
сменившийся пароль при перезапуске не сбрасывается. Хранение паролей и сессий —
в [docs/security.md](security.md).

## HTTPS и Web Push

Web Push работает только по HTTPS (исключение — `localhost`). На PaaS (Render,
Railway, Fly.io) TLS уже включён. На VPS поставьте reverse proxy — проще всего
Caddy с автоматическим Let's Encrypt:

```text
wakanda.example.com {
  reverse_proxy localhost:3001
}
```

За прокси задайте `WAKANDA_TRUST_PROXY=1` (или `loopback`), иначе ограничения
частоты будут считать по IP прокси — [docs/security.md](security.md#ограничение-частоты).
Адрес контакта push-сервисов — `WAKANDA_VAPID_SUBJECT`.

Ключи VAPID создаются при первом запуске и остаются в базе, поэтому подписки не
ломаются. Если диск эфемерный, задайте `WAKANDA_VAPID_PUBLIC` и
`WAKANDA_VAPID_PRIVATE` явно.

## Установка из Chrome (PWA)

- **Компьютер (Chrome/Edge):** значок установки в адресной строке или `⋮` →
  «Установить WakanDa».
- **Android (Chrome):** `⋮` → «Установить приложение».
- **iPhone/iPad:** только Safari → «Поделиться» → «На экран „Домой“». Chrome на iOS
  не устанавливает PWA — ограничение системы.

Условия: HTTPS (или `localhost`) и production-сборка (`npm run build`), где
регистрируется `/sw.js`. Манифест отдаётся как `application/manifest+json`.
Если плашки нет, установка доступна через меню браузера и карточку на главной.
Проверка: Chrome DevTools → Application → Manifest / Service Workers.

## Бэкапы

Перед отложенной миграцией сервер делает `VACUUM INTO` в
`server/data/backups/` (последние 5 копий). Это страховка от ошибки миграции,
а не замена регулярному бэкапу.

Полная копия тома (остановить приложение, чтобы SQLite не менялся):

```bash
docker compose stop wakanda
docker run --rm \
  -v "<проект>_wakanda-data:/data" \
  -v "$PWD:/backup" \
  alpine tar czf /backup/wakanda-data.tgz -C /data .
docker compose start wakanda
```

Имя тома можно узнать через `docker compose config | grep -A2 volumes`.
Восстановление — обратная распаковка в остановленный контейнер. База находится
по пути `$WAKANDA_DATA_DIR/wakanda.db`; ключи VAPID и настройки бота лежат там же
в таблице `settings`.

## Раздельный фронт и API

Возможно, но фронт тогда — только статика: GitHub Pages не запустит NestJS и
SQLite. Укажите адрес API во фронтенде и разрешите домен через
`WAKANDA_CORS_ORIGINS`. На бесплатных хостингах диск может очищаться при
пересборке — подключайте постоянный том.

## Разработка

- `npm run dev:web` / `npm run dev:api` — только фронт / только API
- `npm run build` — сборка `dist/` (в проде SW регистрируется только здесь)
- `npm run icons` — пересобрать PNG-иконки из `public/icons/icon.svg`
- `npm run lint`, `npm test`, `npm run test:server`, `npm run test:e2e`
- `npm run typecheck` — `tsc --noEmit` фронта и сервера
- `npm run check` — линт + тесты + типы + сборка
