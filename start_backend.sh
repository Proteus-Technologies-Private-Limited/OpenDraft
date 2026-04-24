#!/bin/bash
cd "$(dirname "$0")"

# Ensure the shared JWT secret is in place so backend can verify collab tokens.
if [[ ! -f backend/.env ]]; then
  echo "backend/.env missing — generating shared auth env…"
  ./setup_auth_env.sh
fi

# Load backend/.env into the process environment (no python-dotenv dep).
set -a
# shellcheck disable=SC1091
source backend/.env
set +a

source venv/bin/activate
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8008
