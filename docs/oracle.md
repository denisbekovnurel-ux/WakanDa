# Публичный деплой на Oracle Always Free

Это самый дешёвый вариант с постоянным диском и HTTPS: бесплатная ARM-VM,
домен `*.duckdns.org` и Caddy с автоматическим сертификатом Let's Encrypt.
Пользователи получают обычную ссылку и ставят PWA на телефон/ноутбук.

## 0. Сначала открой GHCR-пакет

Сделать публичным можно только в веб-интерфейсе (API не разрешает):

1. Открой https://github.com/denisbekovnurel-ux?tab=packages под своим аккаунтом.
2. `wakanda` → шестерёнка **Package settings**.
3. **Danger Zone** → **Change visibility** → **Public** → подтверди вводом имени.
4. Повтори: `docker pull ghcr.io/denisbekovnurel-ux/wakanda:latest` должен пройти без логина.

Репозиторий уже публичный: https://github.com/denisbekovnurel-ux/WakanDa

## 1. Бесплатный поддомен DuckDNS

1. Зайди на https://www.duckdns.org (удобно через Google/GitHub).
2. Добавь поддомен, например `wakanda-denis`. Получится `wakanda-denis.duckdns.org`.
3. Скопируй **token** из дашборда — он понадобится ниже.

## 2. VM на Oracle Cloud

1. Регистрация: https://www.oracle.com/cloud/free/ (нужна карта, списаний не будет
   при использовании только Always Free-ресурсов).
2. Create instance → Image: **Ubuntu 24.04 ARM64**.
3. Shape: **VM.Standard.A1.Flex**, `2 OCPU / 12 GB` (входит в Always Free).
   Boot volume: 50 GB. Если регион говорит «out of capacity» — выбери другой
   регион или повтори позже.
4. В блоке **SSH keys** вставь публичный ключ:

   ```text
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAfQu2h+gdihH4DAe94r8IxnJciBQ58O/qbHQI5AX2cv wakanda-oracle-deploy
   ```

   Приватный ключ лежит на этом ПК: `~/.ssh/wakanda_oracle`.
5. После создания скопируй **Public IP**.
6. В VCN → Security Lists → Ingress Rules открой TCP **80** и **443** для
   `0.0.0.0/0` и `::/0`. Порт 22 лучше оставить только со своего IP.

## 3. Запуск одной командой

С этого ПК (PowerShell в папке репозитория):

```powershell
scp -i "$env:USERPROFILE\.ssh\wakanda_oracle" deploy\oracle\bootstrap.sh ubuntu@<IP>:/tmp/bootstrap.sh
ssh -i "$env:USERPROFILE\.ssh\wakanda_oracle" ubuntu@<IP> "sudo bash /tmp/bootstrap.sh wakanda-denis.duckdns.org <DUCKDNS_TOKEN>"
```

Скрипт сам поставит Docker, подтянет образ из GHCR, поднимет API, Caddy,
cron для DuckDNS и ежедневные бэкапы. В конце напечатает пароль администратора —
сохрани его сразу.

Открой `https://<поддомен>.duckdns.org`. Первый запрос может занять 20–40 секунд,
пока Caddy получит сертификат.

## 4. Обновление и бэкапы

```bash
sudo /usr/local/bin/wakanda-update        # новая версия из GHCR, данные сохраняются
sudo /usr/local/bin/wakanda-backup        # ручной бэкап тома
ls -lh /opt/backups                       # ежедневные копии, последние 14 дней
docker compose -f /opt/wakanda/docker-compose.yml logs -f wakanda
```

Пароль и настройки лежат в `/opt/wakanda/.env`, база — в томе `wakanda-data`.
`/opt/wakanda/.env` не попадает в Git и не должен никому отправляться.

## 5. Telegram (по желанию)

В `/opt/wakanda/.env` раскомментируй и заполни:

```env
WAKANDA_TELEGRAM_BOT_TOKEN=<токен от @BotFather>
WAKANDA_TELEGRAM_WEBHOOK_URL=https://<поддомен>.duckdns.org/api/telegram/webhook
WAKANDA_TELEGRAM_WEBHOOK_SECRET=<длинная случайная строка>
```

Затем `cd /opt/wakanda && docker compose up -d`. Подробности — [telegram.md](telegram.md).

## 6. Проверка PWA

- **Chrome на ноутбуке/Android:** значок установки в адресной строке или `⋮` →
  «Установить приложение».
- **Safari на iPhone:** «Поделиться» → «На экран „Домой“». Chrome на iOS не ставит PWA.
- Если старая версия не обновилась — hard reload или очистка данных сайта.
