#!/usr/bin/env bash
# Pull the latest GHCR image and restart WakanDa. Keeps the data volume.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "run with sudo/root" >&2; exit 1; }
cd /opt/wakanda

echo "==> Pulling ghcr.io/denisbekovnurel-ux/wakanda:latest"
docker compose pull
docker compose up -d
docker image prune -f >/dev/null

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then break; fi
  sleep 2
done
curl -fsS http://127.0.0.1:3001/api/health >/dev/null \
  || { echo "API is not healthy" >&2; docker compose logs --tail=100 wakanda; exit 1; }

echo "OK: $(awk 'NR==1 { gsub(/[ {]/, "", $1); print "https://" $1 }' /opt/wakanda/Caddyfile)"
