#!/usr/bin/env bash
# One-shot setup for a fresh Oracle Always Free Ubuntu VM (Ampere ARM).
# Usage: sudo bash bootstrap.sh <domain.duckdns.org> <duckdns-token> [admin-pass]
set -euo pipefail

DOMAIN="${1:-}"
DUCKDNS_TOKEN="${2:-}"
ADMIN_PASS="${3:-}"

fail() { echo "ERROR: $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "run with sudo/root"
[[ -n "$DOMAIN" ]] || fail "usage: bootstrap.sh <domain.duckdns.org> <duckdns-token> [admin-pass]"
[[ "$DOMAIN" == *.duckdns.org ]] || fail "domain must be a *.duckdns.org name"
[[ -n "$DUCKDNS_TOKEN" ]] || fail "DuckDNS token is required"

echo "==> Installing Docker and prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl cron openssl >/dev/null
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker

echo "==> Preparing /opt/wakanda"
install -d -m 0750 /opt/wakanda
cd /opt/wakanda
curl -fsSL -o docker-compose.yml \
  https://raw.githubusercontent.com/denisbekovnurel-ux/WakanDa/main/docker-compose.yml

if [[ -z "$ADMIN_PASS" ]]; then
  ADMIN_PASS="$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
fi

# .env contains the admin password and the DuckDNS token is only used in cron.
(
  umask 077
  cat > /opt/wakanda/.env <<EOF
WAKANDA_IMAGE=ghcr.io/denisbekovnurel-ux/wakanda:latest
WAKANDA_ADMIN_PASS=$ADMIN_PASS
WAKANDA_TRUST_PROXY=1
WAKANDA_VAPID_SUBJECT=mailto:admin@$DOMAIN
# Telegram: fill token + webhook secret, then restart. Webhook URL is below.
# WAKANDA_TELEGRAM_BOT_TOKEN=
# WAKANDA_TELEGRAM_BOT_USERNAME=
# WAKANDA_TELEGRAM_WEBHOOK_URL=https://$DOMAIN/api/telegram/webhook
# WAKANDA_TELEGRAM_WEBHOOK_SECRET=
EOF
)

echo "==> Configuring DuckDNS"
SUBDOMAIN="${DOMAIN%.duckdns.org}"
curl -fsS --max-time 15 \
  "https://www.duckdns.org/update?domains=${SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" >/dev/null
cat > /etc/cron.d/duckdns-wakanda <<EOF
*/5 * * * * root curl -fsS --max-time 15 "https://www.duckdns.org/update?domains=${SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=" >/dev/null 2>&1
EOF
chmod 0644 /etc/cron.d/duckdns-wakanda
systemctl enable --now cron

echo "==> Starting WakanDa from GHCR"
docker compose pull
docker compose up -d

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3001/api/health >/dev/null \
  || fail "API is not healthy. Check: docker compose logs --tail=100 wakanda"

echo "==> Starting Caddy (automatic HTTPS)"
cat > /opt/wakanda/Caddyfile <<EOF
$DOMAIN {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3001
}
EOF
docker rm -f wakanda-caddy >/dev/null 2>&1 || true
docker volume create wakanda-caddy-data >/dev/null
docker volume create wakanda-caddy-config >/dev/null
docker run -d --name wakanda-caddy --restart unless-stopped --network host \
  -v /opt/wakanda/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v wakanda-caddy-data:/data \
  -v wakanda-caddy-config:/config \
  caddy:2-alpine

echo "==> Setting up daily backups"
cat > /usr/local/bin/wakanda-backup <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/wakanda
DEST=/opt/backups
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"
VOLUME="$(docker volume ls --format '{{.Name}}' | grep 'wakanda-data' | head -n1)"
[[ -n "$VOLUME" ]] || { echo "volume not found" >&2; exit 1; }
docker compose stop wakanda >/dev/null
trap 'docker compose start wakanda >/dev/null' EXIT
docker run --rm -v "$VOLUME:/data:ro" -v "$DEST:/backup" \
  alpine tar czf "/backup/wakanda-$STAMP.tgz" -C /data .
find "$DEST" -name 'wakanda-*.tgz' -mtime +14 -delete
EOF
chmod 0755 /usr/local/bin/wakanda-backup
cat > /etc/cron.d/wakanda-backup <<'EOF'
15 4 * * * root /usr/local/bin/wakanda-backup >>/var/log/wakanda-backup.log 2>&1
EOF
chmod 0644 /etc/cron.d/wakanda-backup

echo "==> Installing update helper"
curl -fsSL -o /usr/local/bin/wakanda-update \
  https://raw.githubusercontent.com/denisbekovnurel-ux/WakanDa/main/deploy/oracle/update.sh
chmod 0755 /usr/local/bin/wakanda-update

echo
echo "============================================================"
echo "WakanDa is live:       https://$DOMAIN"
echo "Admin login:           waka_admin"
echo "Admin password:        $ADMIN_PASS"
echo "Save this password now — it is only stored in /opt/wakanda/.env"
echo "API health:            https://$DOMAIN/api/health"
echo "Swagger:               https://$DOMAIN/api/docs"
echo "Backups:               /opt/backups (daily, kept 14 days)"
echo "Update:                sudo /usr/local/bin/wakanda-update"
echo "============================================================"
