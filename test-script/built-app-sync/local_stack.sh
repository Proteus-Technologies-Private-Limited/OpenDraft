#!/usr/bin/env bash
# Isolated local cloud for testing real apps: collab server (auth) on 4137 and
# the FastAPI backend on 8137, serving backend/static. Synthetic data only.
# Mail and admin settings are blanked so collab-server/.env can never send real
# email from a test (dotenv does not override variables that are already set).
#   test-script/built-app-sync/local_stack.sh <new-state-dir>
# Stop with: kill $(lsof -tiTCP:4137 -sTCP:LISTEN) $(lsof -tiTCP:8137 -sTCP:LISTEN)
set -euo pipefail
STATE="${1:?state dir}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$STATE"/{collab,backend}
SECRET_FILE="$STATE/jwt.secret"
[ -f "$SECRET_FILE" ] || (umask 077; openssl rand -hex 32 > "$SECRET_FILE")
SECRET="$(cat "$SECRET_FILE")"

( cd "$ROOT/collab-server" && \
  PORT=4137 HOST=127.0.0.1 DATA_DIR="$STATE/collab" JWT_SECRET="$SECRET" \
  SMTP_HOST= SMTP_USER= SMTP_PASS= SMTP_FROM= ADMIN_EMAILS= GOOGLE_CLIENT_ID= GOOGLE_CLIENT_SECRET= \
  APP_URL="http://127.0.0.1:8137" \
  BACKEND_URL="http://127.0.0.1:8137/api" BCRYPT_ROUNDS=4 RATE_LIMIT_MAX=10000 \
  CORS_ORIGINS="http://127.0.0.1:8137,tauri://localhost,https://tauri.localhost" \
  nohup ./node_modules/.bin/ts-node --transpile-only src/server.ts > "$STATE/collab.log" 2>&1 & echo $! > "$STATE/collab.pid" )

( cd "$ROOT/backend" && \
  OPENDRAFT_DATA_DIR="$STATE/backend" COLLAB_DB_PATH="$STATE/collab/collab.sqlite3" \
  COLLAB_JWT_SECRET="$SECRET" COLLAB_SERVER_URL="http://127.0.0.1:4137" FREE_PLAN_FILE_LIMIT=1000 \
  CORS_ORIGINS="tauri://localhost,https://tauri.localhost" \
  nohup "$ROOT/venv/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port 8137 > "$STATE/backend.log" 2>&1 & echo $! > "$STATE/backend.pid" )

for _ in $(seq 1 60); do
  curl -sf -o /dev/null http://127.0.0.1:8137/ && curl -s -o /dev/null http://127.0.0.1:4137/ && break
  sleep 1
done
echo "backend: http://127.0.0.1:8137   collab: http://127.0.0.1:4137   state: $STATE"
