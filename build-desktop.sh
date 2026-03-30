#!/bin/bash
# ============================================================================
# OpenDraft — Desktop Build Script (.dmg distribution)
# Builds, signs, and notarizes the app for direct download distribution.
#
# Tauri handles signing and notarization automatically when the correct
# environment variables are set. Credentials are loaded from .env.
# ============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_DIR="$PROJECT_ROOT/backend"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
VENV_DIR="$PROJECT_ROOT/venv"

# Load credentials from .env
if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

if [ -z "$APPLE_PASSWORD" ] || [ "$APPLE_PASSWORD" = "REPLACE_WITH_APP_SPECIFIC_PASSWORD" ]; then
    echo "Error: APPLE_PASSWORD not set."
    echo "Set it in .env (project root) or as an environment variable."
    echo "Generate an app-specific password at https://appleid.apple.com"
    exit 1
fi

# Signing identity — used by both PyInstaller (for embedded libs) and Tauri (for app bundle)
export APPLE_SIGNING_IDENTITY="Developer ID Application: Base Information Management Pvt. Ltd. (335RGMFDB6)"
export CODESIGN_IDENTITY="$APPLE_SIGNING_IDENTITY"

# Detect the Rust target triple for sidecar naming
TARGET_TRIPLE=$(rustc -vV | grep '^host:' | awk '{print $2}')
echo "=== OpenDraft Desktop Build ==="
echo "Target: $TARGET_TRIPLE"
echo "Signing: $APPLE_SIGNING_IDENTITY"
echo ""

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

# ── Step 5: Build, sign, and notarize with Tauri ───────────────────────────
# Tauri automatically signs all binaries (including sidecars) and notarizes
# when APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID
# are set in the environment.
echo ""
echo "=== Step 5/5: Building Tauri app (with signing + notarization) ==="
cd "$PROJECT_ROOT"
"$FRONTEND_DIR/node_modules/.bin/tauri" build

DMG_FILE=$(find "$TAURI_DIR/target/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)

echo ""
echo "=== Desktop build complete! ==="
echo "Signed + notarized .dmg: $DMG_FILE"
