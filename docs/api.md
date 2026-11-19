# API

Единый источник правды — OpenAPI, сгенерированный из кода:

- **Swagger UI:** `http://localhost:3001/api/docs`
- **JSON:** `http://localhost:3001/api/docs-json`

Документ строится при старте из маршрутов NestJS, поэтому список эндпоинтов не
устаревает. Отключается переменной `WAKANDA_SWAGGER=0`. Все пути в документе
уже содержат префикс `/api`.

## Авторизация

Публичные: `GET /api/health`, `POST /api/auth/register`, `POST /api/auth/login`.
Остальные эндпоинты требуют `Authorization: Bearer <token>`. Токен выдаётся
при логине/регистрации, хранится на клиенте в `localStorage` — см.
[docs/security.md](security.md#хранение-токена).

Регистрация создаёт пользователя со статусом `pending`: до одобрения админом
доступны только `/api/auth/me` и heartbeat, данные недоступны.

## Группы эндпоинтов

| Группа | Путь | Назначение |
| --- | --- | --- |
| `auth` | `/api/auth/*` | Вход, сессии, смена пароля, админ-действия |
| `state` | `/api/state*` | Состояние, ревизии, снимки, откат |
| `push` | `/api/push/*` | VAPID-ключ, подписки, тестовое уведомление |
| `telegram` | `/api/telegram/*` | Привязка, тест, webhook |
| `reminders` | `/api/reminders*` | Напоминания на дату |
| `client-errors` | `/api/client-errors` | Отчёты об ошибках фронтенда (лимитированы) |

Точные тела запросов, статусы и схемы смотрите в Swagger.

## Ответы и ошибки

Успешные ответы — JSON. Ошибки содержат `statusCode`, `message` и, где нужно,
тело с актуальным состоянием (конфликт синхронизации возвращает `409`). Каждый
ответ имеет `X-Request-Id`; тот же идентификатор попадает в логи — см.
[docs/observability.md](observability.md).

Лимиты частоты запросов описаны в [docs/security.md](security.md#ограничение-частоты).
Web Push и Telegram описаны в [docs/telegram.md](telegram.md).
