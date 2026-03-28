#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_STATIC="$PROJECT_ROOT/backend/static"

echo "=== Building OpenDraft Frontend ==="
cd "$FRONTEND_DIR"
npm run build

echo "=== Deploying to FastAPI static directory ==="
rm -rf "$BACKEND_STATIC"
cp -r "$FRONTEND_DIR/dist" "$BACKEND_STATIC"

echo "=== Done ==="
echo "Frontend built and deployed to backend/static/"
echo "Start the backend server to serve the app."
