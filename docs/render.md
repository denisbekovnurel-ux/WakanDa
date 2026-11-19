# Render free — публичная ссылка без банковской карты

Это самый быстрый способ дать людям ссылку и установить PWA. Но есть важное
ограничение: **бесплатные сервисы Render имеют эфемерную файловую систему**.
SQLite-база и ключи VAPID удаляются при каждом рестарте, редеплое и после
15 минут простоя. Поэтому подходит только для демо/теста, не для реальных данных.
Для настоящего использования смотри [docs/oracle.md](oracle.md).

## Что делает репозиторий

`render.yaml` создаёт сервис `wakanda` из Dockerfile этого репозитория. GHCR не
нужен — Render сам клонирует публичный репозиторий и собирает образ.

## Шаги

1. Зарегистрируйся https://dashboard.render.com/register через GitHub. Карта не нужна.
2. Dashboard → **New** → **Blueprint**.
3. Выбери репозиторий `denisbekovnurel-ux/WakanDa`, ветку `main`, **Apply**.
4. Когда Render спросит `WAKANDA_ADMIN_PASS`, введи длинный пароль администратора.
5. Дождись деплоя (первый раз ~5–10 минут). Текущий адрес:
   https://wakanda-xgmb.onrender.com
6. В GitHub → репозиторий → Settings → Secrets and variables → Actions → Variables
   добавь переменную `RENDER_URL` со значением `https://wakanda-xxxx.onrender.com`.
   Это включит keep-alive каждые 5 минут: free-инстанс не будет засыпать.

## Проверка

```bash
curl https://wakanda-xxxx.onrender.com/api/health
# открыть https://wakanda-xxxx.onrender.com/api/docs
```

## PWA

HTTPS уже есть, поэтому Chrome на ноутбуке/Android покажет значок установки.
На iOS — Safari → «Поделиться» → «На экран „Домой“».

## Обновление

Каждый push в `main` автоматически пересобирает сервис. **Внимание:** при этом
эфемерный диск очищается, поэтому тестовые пользователи и их данные пропадут.
Если нужны постоянные данные — Oracle Always Free с диском и Caddy.

## Telegram

Добавь в Render → сервис `wakanda` → Environment переменные:

```text
WAKANDA_TELEGRAM_BOT_TOKEN=<токен от @BotFather>
WAKANDA_TELEGRAM_WEBHOOK_URL=https://wakanda-xxxx.onrender.com/api/telegram/webhook
WAKANDA_TELEGRAM_WEBHOOK_SECRET=<длинная случайная строка>
```

После сохранения Render перезапустит сервис. Подробности — [telegram.md](telegram.md).
