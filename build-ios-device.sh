#!/bin/bash
# ============================================================================
# OpenDraft — iOS Device Build Script
# Builds the iOS app, patches Info.plist with file associations,
# re-signs, re-exports the IPA, and installs on a connected device.
#
# Usage:
#   ./build-ios-device.sh              # build + install
#   ./build-ios-device.sh --no-install # build only (IPA at build/patched-export/)
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

SIGN_IDENTITY="Apple Distribution: Base Information Management Pvt. Ltd. (335RGMFDB6)"
BUILD_DIR="src-tauri/gen/apple/build"

# ── Step 1: Build the iOS app ───────────────────────────────────────────────
echo "==> Building frontend..."
cd frontend && npm run build && cd ..

echo "==> Building iOS app (release, aarch64)..."
frontend/node_modules/.bin/tauri ios build --target aarch64

# ── Step 2: Patch Info.plist with file associations ─────────────────────────
echo "==> Patching Info.plist with file association declarations..."

ARCHIVE=$(find "$BUILD_DIR" -maxdepth 1 -name "*.xcarchive" | head -1)
if [ -z "$ARCHIVE" ]; then
  echo "Error: No .xcarchive found in $BUILD_DIR"
  exit 1
fi
APP_PATH="$ARCHIVE/Products/Applications/OpenDraft.app"
if [ ! -d "$APP_PATH" ]; then
  echo "Error: No .app found in xcarchive"
  exit 1
fi

python3 - "$APP_PATH/Info.plist" << 'PYEOF'
import plistlib, sys

plist_path = sys.argv[1]
with open(plist_path, "rb") as f:
    plist = plistlib.load(f)

plist["LSSupportsOpeningDocumentsInPlace"] = True
plist["UISupportsDocumentBrowser"] = True

plist["CFBundleDocumentTypes"] = [
    {"CFBundleTypeName": "Final Draft Screenplay", "CFBundleTypeRole": "Editor",
     "LSHandlerRank": "Default", "LSItemContentTypes": ["com.finaldraft.fdx"]},
    {"CFBundleTypeName": "Fountain Screenplay", "CFBundleTypeRole": "Editor",
     "LSHandlerRank": "Default", "LSItemContentTypes": ["com.proteus.opendraft.fountain"]},
    {"CFBundleTypeName": "OpenDraft Screenplay", "CFBundleTypeRole": "Editor",
     "LSHandlerRank": "Owner", "LSItemContentTypes": ["com.proteus.opendraft.document"]},
    {"CFBundleTypeName": "Text File", "CFBundleTypeRole": "Editor",
     "LSHandlerRank": "Alternate", "LSItemContentTypes": ["public.plain-text"]},
]

plist["UTImportedTypeDeclarations"] = [
    {"UTTypeIdentifier": "com.finaldraft.fdx", "UTTypeDescription": "Final Draft Screenplay",
     "UTTypeConformsTo": ["public.xml"],
     "UTTypeTagSpecification": {"public.filename-extension": ["fdx"], "public.mime-type": "application/xml"}},
    {"UTTypeIdentifier": "com.proteus.opendraft.fountain", "UTTypeDescription": "Fountain Screenplay",
     "UTTypeConformsTo": ["public.plain-text"],
     "UTTypeTagSpecification": {"public.filename-extension": ["fountain"], "public.mime-type": "text/plain"}},
    {"UTTypeIdentifier": "com.proteus.opendraft.document", "UTTypeDescription": "OpenDraft Screenplay",
     "UTTypeConformsTo": ["public.json"],
     "UTTypeTagSpecification": {"public.filename-extension": ["odraft"], "public.mime-type": "application/json"}},
]

with open(plist_path, "wb") as f:
    plistlib.dump(plist, f)
print(f"  Patched: {plist_path}")
PYEOF

# ── Step 3: Re-sign the .app ───────────────────────────────────────────────
echo "==> Re-signing .app..."
codesign -d --entitlements :- "$APP_PATH" > /tmp/opendraft_ent.plist 2>/dev/null
codesign --force --sign "$SIGN_IDENTITY" --entitlements /tmp/opendraft_ent.plist "$APP_PATH"
echo "  Signed with: $SIGN_IDENTITY"

# ── Step 4: Re-export IPA ──────────────────────────────────────────────────
echo "==> Re-exporting IPA..."
EXPORT_DIR="$BUILD_DIR/patched-export"
rm -rf "$EXPORT_DIR"

EXPORT_OPTIONS=$(find src-tauri/gen/apple/build -maxdepth 1 -name "ExportOptions.plist" | head -1)
if [ -z "$EXPORT_OPTIONS" ]; then
  echo "Error: No ExportOptions.plist found"
  exit 1
fi

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -quiet

PATCHED_IPA=$(find "$EXPORT_DIR" -name "*.ipa" | head -1)
echo "  IPA: $PATCHED_IPA"

# ── Step 5: Install on device (unless --no-install) ────────────────────────
if [ "$1" = "--no-install" ]; then
  echo "==> Done (--no-install). IPA at: $PATCHED_IPA"
  exit 0
fi

echo "==> Installing on connected device..."
# Extract the UUID (8-4-4-4-12 hex pattern) from the first available device line
DEVICE_ID=$(xcrun devicectl list devices 2>/dev/null | grep -v "unavailable" | grep "available" | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)
if [ -z "$DEVICE_ID" ]; then
  echo "Error: No available iOS device found. Connect a device and try again."
  echo "  IPA is at: $PATCHED_IPA"
  exit 1
fi

echo "  Device: $DEVICE_ID"
xcrun devicectl device install app --device "$DEVICE_ID" "$PATCHED_IPA"

echo ""
echo "==> Done! Unlock your device and launch OpenDraft."
