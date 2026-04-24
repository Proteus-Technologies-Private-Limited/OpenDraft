#!/bin/bash
# Start the OpenDraft Collaboration Server

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Ensure the shared JWT secret is in place (same secret the backend uses).
if [[ ! -f "$ROOT/collab-server/.env" ]]; then
    echo "collab-server/.env missing — generating shared auth env…"
    (cd "$ROOT" && ./setup_auth_env.sh)
fi

cd "$ROOT/collab-server" || exit 1

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "Starting OpenDraft Collaboration Server..."
npm run dev
