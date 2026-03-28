#!/bin/bash
# ============================================================================
# OpenDraft — Mac App Store Build Script
# Builds, signs, and packages the app for App Store submission.
# ============================================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_DIR="$PROJECT_ROOT/backend"
TAURI_DIR="$PROJECT_ROOT/src-tauri"
VENV_DIR="$PROJECT_ROOT/venv"
ENTITLEMENTS_DIR="$TAURI_DIR/entitlements"
PROVISION_PROFILE="$PROJECT_ROOT/certificates/OpenDraft_App_Store.provisionprofile"

APP_SIGN_ID="3rd Party Mac Developer Application: Base Information Management Pvt. Ltd. (335RGMFDB6)"
INSTALLER_SIGN_ID="3rd Party Mac Developer Installer: Base Information Management Pvt. Ltd. (335RGMFDB6)"

TARGET_TRIPLE=$(rustc -vV | grep '^host:' | awk '{print $2}')

echo "=== OpenDraft App Store Build ==="
echo "Target: $TARGET_TRIPLE"
echo ""

# Step 1: Build frontend
echo "=== Step 1/8: Building frontend ==="
cd "$FRONTEND_DIR"
VITE_API_BASE="http://localhost:18321/api" npm run build

# Step 2: Deploy frontend to backend/static
echo ""
echo "=== Step 2/8: Deploying frontend to backend/static ==="
rm -rf "$BACKEND_DIR/static"
cp -r "$FRONTEND_DIR/dist" "$BACKEND_DIR/static"

# Step 3: Build backend with PyInstaller
echo ""
echo "=== Step 3/8: Building backend sidecar ==="
cd "$BACKEND_DIR"
"$VENV_DIR/bin/pyinstaller" --noconfirm --clean opendraft-api.spec

# Step 4: Copy sidecar binary
echo ""
echo "=== Step 4/8: Installing sidecar binary ==="
mkdir -p "$TAURI_DIR/binaries"
cp "$BACKEND_DIR/dist/opendraft-api" \
   "$TAURI_DIR/binaries/opendraft-api-$TARGET_TRIPLE"
chmod +x "$TAURI_DIR/binaries/opendraft-api-$TARGET_TRIPLE"

# Step 5: Build Tauri app (unsigned — we re-sign below)
echo ""
echo "=== Step 5/8: Building Tauri app ==="
cd "$PROJECT_ROOT"
APPLE_SIGNING_IDENTITY="-" "$FRONTEND_DIR/node_modules/.bin/tauri" build --bundles app

APP_PATH="$TAURI_DIR/target/release/bundle/macos/OpenDraft.app"

# Step 6: Re-sign with App Store identity and entitlements
echo ""
echo "=== Step 6/8: Signing for App Store ==="

# Sign sidecar (deepest first)
echo "  Signing sidecar..."
codesign --force --options runtime \
    --entitlements "$ENTITLEMENTS_DIR/sidecar.entitlements" \
    --sign "$APP_SIGN_ID" \
    "$APP_PATH/Contents/MacOS/opendraft-api"

# Sign main binary
echo "  Signing main binary..."
codesign --force --options runtime \
    --entitlements "$ENTITLEMENTS_DIR/app.entitlements" \
    --sign "$APP_SIGN_ID" \
    "$APP_PATH/Contents/MacOS/opendraft"

# Sign the entire .app bundle
echo "  Signing app bundle..."
codesign --force --deep --options runtime \
    --entitlements "$ENTITLEMENTS_DIR/app.entitlements" \
    --sign "$APP_SIGN_ID" \
    "$APP_PATH"

# Verify
echo "  Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

# Step 7: Embed provisioning profile
echo ""
echo "=== Step 7/8: Embedding provisioning profile ==="
if [ ! -f "$PROVISION_PROFILE" ]; then
    echo "ERROR: Provisioning profile not found at: $PROVISION_PROFILE"
    exit 1
fi
cp "$PROVISION_PROFILE" "$APP_PATH/Contents/embedded.provisionprofile"

# Re-sign after embedding profile
codesign --force --deep --options runtime \
    --entitlements "$ENTITLEMENTS_DIR/app.entitlements" \
    --sign "$APP_SIGN_ID" \
    "$APP_PATH"

# Step 8: Build .pkg installer
echo ""
echo "=== Step 8/8: Building .pkg installer ==="
PKG_OUTPUT="$PROJECT_ROOT/OpenDraft.pkg"
productbuild --component "$APP_PATH" /Applications \
    --sign "$INSTALLER_SIGN_ID" \
    "$PKG_OUTPUT"

echo ""
echo "=== App Store build complete! ==="
echo "Package: $PKG_OUTPUT"
echo ""
echo "Next steps:"
echo "  1. Upload with: xcrun altool --upload-app --file OpenDraft.pkg --type macos --apple-id kandarp.baghar@proteustech.co --team-id 335RGMFDB6"
echo "  2. Or use the Transporter app from the Mac App Store"
echo "  3. Select the build in App Store Connect and submit for review"
