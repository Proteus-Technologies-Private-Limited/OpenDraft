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
TAURI_DIR="$PROJECT_ROOT/src-tauri"

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

# Signing identity — used by Tauri for app bundle
export APPLE_SIGNING_IDENTITY="Developer ID Application: Base Information Management Pvt. Ltd. (335RGMFDB6)"

# Detect the Rust target triple
TARGET_TRIPLE=$(rustc -vV | grep '^host:' | awk '{print $2}')
echo "=== OpenDraft Desktop Build ==="
echo "Target: $TARGET_TRIPLE"
echo "Signing: $APPLE_SIGNING_IDENTITY"
echo ""

# ── Step 1: Build the frontend ────────────────────────────────────────────────
echo ""
echo "=== Step 1/2: Building frontend ==="
cd "$FRONTEND_DIR"
npm run build

# ── Step 2: Build, sign, and notarize with Tauri ─────────────────────────────
# Tauri automatically signs all binaries and notarizes when
# APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD, and APPLE_TEAM_ID
# are set in the environment.
echo ""
echo "=== Step 2/2: Building Tauri app (with signing + notarization) ==="
cd "$PROJECT_ROOT"
"$FRONTEND_DIR/node_modules/.bin/tauri" build

DMG_FILE=$(find "$TAURI_DIR/target/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)

echo ""
echo "=== Desktop build complete! ==="
echo "Signed + notarized .dmg: $DMG_FILE"
