#!/bin/bash
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_DIR="$PROJECT_ROOT/backend"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
VENV_DIR="$PROJECT_ROOT/venv"

# Detect the Rust target triple for sidecar naming
TARGET_TRIPLE=$(rustc -vV | grep '^host:' | awk '{print $2}')
echo "=== Target triple: $TARGET_TRIPLE ==="

# ── Step 1: Build the frontend with Tauri API base ──────────────────────────
echo ""
echo "=== Step 1/5: Building frontend ==="
cd "$FRONTEND_DIR"
VITE_API_BASE="http://localhost:18321/api" npm run build

# ── Step 2: Copy frontend dist to backend static (for PyInstaller bundle) ───
echo ""
echo "=== Step 2/5: Deploying frontend to backend/static ==="
rm -rf "$BACKEND_DIR/static"
cp -r "$FRONTEND_DIR/dist" "$BACKEND_DIR/static"

# ── Step 3: Build backend binary with PyInstaller ───────────────────────────
echo ""
echo "=== Step 3/5: Building backend sidecar with PyInstaller ==="
cd "$BACKEND_DIR"

# Ensure pyinstaller is installed in the venv
"$VENV_DIR/bin/pip" install pyinstaller --quiet

"$VENV_DIR/bin/pyinstaller" \
    --noconfirm \
    --clean \
    opendraft-api.spec

# ── Step 4: Copy sidecar binary to Tauri binaries dir ──────────────────────
echo ""
echo "=== Step 4/5: Installing sidecar binary ==="
mkdir -p "$TAURI_DIR/binaries"
cp "$BACKEND_DIR/dist/opendraft-api" \
   "$TAURI_DIR/binaries/opendraft-api-$TARGET_TRIPLE"
chmod +x "$TAURI_DIR/binaries/opendraft-api-$TARGET_TRIPLE"

# ── Step 5: Build the Tauri desktop app ─────────────────────────────────────
echo ""
echo "=== Step 5/5: Building Tauri desktop app ==="
cd "$PROJECT_ROOT"
"$FRONTEND_DIR/node_modules/.bin/tauri" build

echo ""
echo "=== Desktop build complete! ==="
echo "Look for the installer in: src-tauri/target/release/bundle/"
