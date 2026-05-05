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
#   2. Create two subdomains, e.g. opendraft + opendraft-collab.
#   3. Point both to this VPS's public IPv4 address.
#
# First run:
#   cd deploy
#   cp .env.example .env
#   # edit .env: set DEMO_HOST, COLLAB_HOST, ACME_EMAIL, JWT_SECRET
#   ./deploy.sh                  # builds backend + collab from source
#   ./deploy.sh --combined       # pulls combined image from GHCR (no source build)
#
# Update deploy (after git pull or new GHCR release):
#   ./deploy.sh [--combined]

cd "$(dirname "$0")"

# ── Mode selection ──
# --combined (or env OPENDRAFT_USE_COMBINED=1) uses the prebuilt single-image
# stack from GHCR; default is the per-service build-from-source stack.
USE_COMBINED="${OPENDRAFT_USE_COMBINED:-0}"
for arg in "$@"; do
  case "$arg" in
    --combined) USE_COMBINED=1 ;;
    *) echo "Unknown arg: $arg"; exit 1 ;;
  esac
done

if [ "$USE_COMBINED" = "1" ]; then
  COMPOSE_FILE="docker-compose.combined.yml"
  MODE_LABEL="combined image (GHCR pull)"
else
  COMPOSE_FILE="docker-compose.yml"
  MODE_LABEL="per-service build"
fi

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

echo "Mode: $MODE_LABEL"
echo "Compose file: $COMPOSE_FILE"
echo

if [ "$USE_COMBINED" = "1" ]; then
  echo "Pulling image (tag: ${OPENDRAFT_VERSION:-latest})..."
  docker compose -f "$COMPOSE_FILE" pull
else
  echo "Building images..."
  docker compose -f "$COMPOSE_FILE" build
fi

echo "Starting stack..."
docker compose -f "$COMPOSE_FILE" up -d

echo ""
echo "Stack status:"
docker compose -f "$COMPOSE_FILE" ps

echo ""
echo "Done. Once DNS has propagated, Caddy will fetch Let's Encrypt certs automatically."
echo "  Demo:   https://${DEMO_HOST}"
echo "  Collab: https://${COLLAB_HOST}  (wss://${COLLAB_HOST} for WebSocket)"
echo ""
echo "Logs:    docker compose -f $COMPOSE_FILE logs -f"
echo "Restart: docker compose -f $COMPOSE_FILE restart"
echo "Stop:    docker compose -f $COMPOSE_FILE down"
