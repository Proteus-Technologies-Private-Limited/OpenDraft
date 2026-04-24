#!/usr/bin/env bash
set -euo pipefail

# ── OpenDraft VPS Deploy ──
#
# One-shot deploy for demo + collab on a single Ubuntu 22.04 VPS
# (Hostinger KVM 1, Contabo, or any Docker-capable host).
#
# Prereqs on the VPS (run once as root or with sudo):
#   apt update && apt install -y docker.io docker-compose-plugin git
#   systemctl enable --now docker
#
# DNS (free, no domain purchase):
#   1. Sign up at https://www.duckdns.org (GitHub/Google login).
#   2. Create two subdomains, e.g. opendraft-demo + opendraft-collab.
#   3. Point both to this VPS's public IPv4 address.
#
# First run:
#   cd deploy
#   cp .env.example .env
#   # edit .env: set DEMO_HOST, COLLAB_HOST, ACME_EMAIL, JWT_SECRET
#   ./deploy.sh
#
# Update deploy (after git pull):
#   ./deploy.sh

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill it in."
  exit 1
fi

# Pull secrets into the shell so we can validate before handing to compose
set -a
# shellcheck disable=SC1091
source .env
set +a

for var in DEMO_HOST COLLAB_HOST ACME_EMAIL JWT_SECRET CORS_ORIGINS; do
  if [ -z "${!var:-}" ] || [[ "${!var}" == *"change-me"* ]]; then
    echo "ERROR: $var is unset or still the placeholder value in .env"
    exit 1
  fi
done

echo "Building images..."
docker compose build

echo "Starting stack..."
docker compose up -d

echo ""
echo "Stack status:"
docker compose ps

echo ""
echo "Done. Once DNS has propagated, Caddy will fetch Let's Encrypt certs automatically."
echo "  Demo:   https://${DEMO_HOST}"
echo "  Collab: https://${COLLAB_HOST}  (wss://${COLLAB_HOST} for WebSocket)"
echo ""
echo "Logs:    docker compose logs -f"
echo "Restart: docker compose restart"
echo "Stop:    docker compose down"
