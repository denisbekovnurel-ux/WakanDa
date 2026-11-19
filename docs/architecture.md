# Архитектура WakanDa

## Кратко

WakanDa — одностраничное React-приложение и один NestJS-процесс с SQLite.
Архитектура намеренно маленькая: без Redis, очередей, внешнего API-шлюза и
раздельного бэкенда. Это даёт бесплатный self-hosted деплой и предсказуемое
поведение на одном сервере.

```text
Browser / PWA
  │
  ├─ React + Vite + TypeScript
  │   ├─ Shell/Topbar — навигация, тема, язык, меню аккаунта
  │   ├─ Pages — главная, месяц, разовые задачи, статистика, админка
  │   └─ API clients — auth/state/push/telegram/reminders
  │
  └─ HTTPS
      │
NestJS API
  ├─ AuthModule — пользователи, сессии, admin, rate-limit
  ├─ StateModule — состояние пользователя, ревизии, снимки, откат
  ├─ PushModule — Web Push подписки + планировщик напоминаний
  ├─ TelegramModule — привязка чата, webhook/long polling, команды бота
  ├─ RemindersModule — пользовательские напоминания и snooze
  └─ DatabaseModule — SQLite, миграции, SettingsService
```

## Frontend boundaries

- `src/App.tsx` — композиционный корень: store, роуты, hero, глобальные
  эффекты и диалоги. Он не владеет шапкой.
- `src/components/Shell/navigation.ts` — единственный источник страниц и
  метаданных навигации.
- `src/components/Shell/Topbar.tsx` — бренд, навигация, статус синхронизации,
  тема, язык и меню аккаунта.
- `src/pages/*` и `src/components/*` — фичи. Страницы не должны знать про
  глобальную шапку; шапка получает данные props'ами.
- API-слой в `src/api/*` — единственный, кто знает URL и токены. Компоненты
  не делают `fetch` напрямую.
- `src/pwa/PwaInstallContext.ts` — контракт установки и `usePwaInstall`;
  `PwaInstallProvider.tsx` — единственный слушатель `beforeinstallprompt` и
  `appinstalled`. UI установки живёт в `src/components/Install/*`.

## Backend boundaries

- `DatabaseModule` — глобальный владелец соединения SQLite, миграций и
  `SettingsService`. Доменные сервисы не пишут в `settings` своим SQL.
- Контроллеры только принимают HTTP-запросы и вызывают сервисы. Прямой SQL и
  `DatabaseService.connection` в контроллерах запрещены архитектурным тестом.
- `StateService` — владелец состояния пользователя, ревизий, снэпшотов и отката.
- `PushService` — владелец Web Push подписок и ежедневных напоминаний.
  Чистая логика слотов и дедупликации живёт в `push.util.ts`.
- `TelegramService` — владелец привязки чата, webhook/long polling, команд и
  защиты от повторной обработки `update_id`.
- `RemindersService` — владелец пользовательских напоминаний. Парсер
  естественного языка вынесен в `reminders.util.ts`, чтобы его можно было
  тестировать без БД и Nest.
- `HealthController` не ходит в SQL сам: он вызывает `DatabaseService.ping()`
  и `PushService.schedulerStatus()`.

## Данные и потоки

### Состояние

```text
Client store → PUT /api/state { state, baseRevision }
             → StateService.saveForUser()
             → sanitizeAppState()
             → revision check → 409 при конфликте
             → user_state + snapshot/history
```

Сервер не доверяет клиенту: всегда валидирует и нормализует состояние.
Конфликты не затираются молча — клиент получает актуальную версию и выбирает.

### Напоминания

```text
Scheduler (1 раз/мин) → PushService.runReminders()
  ├─ custom reminders: RemindersService.due() → Web Push / Telegram
  ├─ daily reminders: StateService + push.util.dueReminderSlots()
  └─ one-off reminders: StateService + dueOneOffReminders()
        ↓
  push_log (user_id, date_key, slot) — защита от дублей
```

Telegram-обновления обрабатываются ровно один раз: `update_id` сохраняется в
`settings` через `SettingsService`, а параллельные повторы отсекаются
множеством обрабатываемых update.

### Миграции

SQLite меняется только через `server/src/database/migrations.ts`.
Миграции версионируются, пишутся в `schema_migrations`, выполняются в
транзакциях и применяются один раз. Перед отложенной миграцией на
существующей базе создаётся снимок через `VACUUM INTO`.

## Мобильный и iOS-слой

Мобильная адаптация — не набор разрозненных `@media`, а три уровня.

1. **Разметка и meta** — `index.html`: `viewport-fit=cover`, `dvh`,
   `apple-mobile-web-app-*`, `color-scheme`, `theme-color`.
2. **CSS-профиль** — конец `src/App.css`, секция «iOS profile»:
   safe-area, `svh/dvh`, 16 px в полях на `pointer: coarse`, нижняя шторка
   диалогов, состояния `:active` вместо hover, `-webkit-touch-callout`,
   `-webkit-fill-available` и место под home indicator.
3. **Поведение** — `src/utils/viewport.ts`, `src/utils/scrollLock.ts` и
   `src/hooks/useDialogA11y.ts`.

```text
visualViewport resize
  └─ utils/viewport.ts
       ├─ --vvh = высота видимой области
       └─ html.keyboard-open
            ├─ нижняя навигация уезжает вниз
            ├─ нижняя шторка ограничивает высоту
            └─ тосты поднимаются над home indicator

открытие диалога
  └─ hooks/useDialogA11y
       ├─ utils/scrollLock.ts: body fixed + возврат scrollY
       ├─ начальный фокус / Tab-ловушка / Escape
       └─ возврат фокуса на элемент-триггер
```

Диалоги не должны реализовывать блокировку фона и Escape самостоятельно —
только `useDialogA11y`. Это единственное место, где учитывается поведение
iOS Safari. `scripts`/`main.tsx` вызывают `installViewportTracking()` один раз
до рендера, поэтому экран входа и приложение используют один и тот же слой.

## PWA-слой

Установка — не отдельная сборка, а тот же фронтенд с манифестом и service worker.

```text
public/manifest.webmanifest → критерии устанавливаемости Chrome
public/sw.js                 → офлайн-шелл, push, notificationclick
src/pwa/PwaInstallProvider   → beforeinstallprompt / appinstalled, один на приложение
  ├─ components/Install/InstallBanner — предложение, когда prompt доступен
  ├─ components/Install/InstallPanel  — постоянная карточка и ручные инструкции
  └─ components/Shell/Topbar          — пункт меню аккаунта
```

- `beforeinstallprompt` слушается только в провайдере: событие одноразовое,
  второй обработчик получил бы уже использованный prompt.
- Service worker регистрируется только в production (`import.meta.env.PROD`):
  в dev он кэшировал бы модули Vite и ломал горячую перезагрузку.
- Установка возможна только по HTTPS или на `localhost`. Если
  `isSecureContext === false`, интерфейс объясняет это, а не обещает установку.
- На iPhone/iPad установка доступна только в Safari («Поделиться» → «На экран
  „Домой“»); Chrome на iOS не устанавливает PWA — это ограничение системы.
- Сервер отдаёт манифест как `application/manifest+json`, а `/sw.js` — с
  `no-store` и `Service-Worker-Allowed: /`. Это проверяет `src/pwa/pwa.test.js`.

## Ограничения и roadmap

Текущие trade-offs осознанны и не скрываются:

- **Один администратор.** Нет self-service восстановления пароля: сброс делает
  админ. Мульти-админ и roles — в планах.
- **SQLite, один процесс.** In-process таймеры, Web Push и Telegram не
  масштабируются горизонтально; нет HA. Для больших нагрузок нужен внешний
  планировщик и общая БД, что ломает текущую простоту.
- **Chrome на iOS не ставит PWA** — только Safari → «На экран „Домой“».
- **Bearer-токен в `localStorage`.** Просто для SPA и офлайн-старта, но требует
  строгой CSP; подробности — в [docs/security.md](security.md#хранение-токена).

Roadmap: мульти-админ, восстановление пароля, экспорт/импорт через UI,
опциональный внешний планировщик и метрики.

## CI и поставка

Подробные инструкции по деплою, переменным и бэкапам — в
[docs/deployment.md](deployment.md). `.github/workflows/ci.yml` — единственный
CI-конвейер:

```text
push / pull_request
  └─ build: lint → frontend tests → server tests → typecheck → build → e2e

push в main (после build)
  └─ docker: buildx → ghcr.io/<owner>/<repo>:latest + :sha-<commit>
```

- CI не требует секретов: тесты и e2e поднимают изолированные данные сами.
- Образ собирается из того же `Dockerfile`, что и локально; фронтенд попадает
  внутрь и раздаётся NestJS с того же домена.
- На сервере `WAKANDA_IMAGE` в `.env` переключает compose с локальной сборки на
  готовый образ из GHCR. Данные остаются в томе `wakanda-data`.
- Публикация образа не делает приложение публичным: пакет GHCR приватный, пока
  владелец не сменит видимость.
- GitHub Pages остаётся непригодным для полного приложения: это только статика,
  без API, SQLite, планировщика, Telegram и Web Push.

## Правила расширения

1. Новая фича = новый доменный сервис/компонент + узкий публичный метод.
2. Не обходи границы напрямую: контроллер → сервис, сервис → `SettingsService`,
   страницы → API-клиенты.
3. Чистые функции (парсинг, слоты, форматирование) клади в `*.util.ts` и
   тестируй без инфраструктуры.
4. Изменения схемы — только новой миграцией, не правками «на месте».
5. Публичные health/debug поля не должны отдавать секреты, SQL-ошибки или
   `chat_id`.
6. Если изменение влияет на напоминания, проверяй дедупликацию:
   `push_log`, `update_id`, grace-окна и повторные webhook.
7. Новое модальное окно подключай через `useDialogA11y`; не добавляй свои
   обработчики Escape и `body.style.overflow`.
8. Новые мобильные правила проверяй на трёх состояниях: iPhone портрет,
   iPhone альбом и открытая клавиатура (класс `keyboard-open`).
9. Поля ввода на сенсорных экранах держи 16 px: это не дизайн, а защита от
   авто-зума Safari.
10. Состояние установки не дублируй в компонентах — только `usePwaInstall`.
    Нативный prompt вызывается один раз; после отказа не показывай его снова
    в той же сессии.
11. Меняя манифест, иконки или service worker, обновляй `src/pwa/pwa.test.js`
    и проверяй Chrome DevTools → Application → Manifest / Service Workers.
12. README остаётся коротким: детали выносятся в `docs/*`. Список эндпоинтов
    не ведётся вручную — источник правды OpenAPI из `@nestjs/swagger`.
