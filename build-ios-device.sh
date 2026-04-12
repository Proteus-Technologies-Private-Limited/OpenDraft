#!/bin/bash
# ============================================================================
# OpenDraft — iOS Build Script
# Builds the iOS app, patches Info.plist with file associations,
# re-signs, re-exports the IPA, and installs on a connected device or simulator.
#
# Usage:
#   ./build-ios-device.sh                          # build + install on device
#   ./build-ios-device.sh --no-install             # build only (IPA at build/patched-export/)
#   ./build-ios-device.sh --sim                    # build + install on booted simulator
#   ./build-ios-device.sh --sim "iPhone 15"        # build + install on named simulator
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

SIGN_IDENTITY="Apple Distribution: Base Information Management Pvt. Ltd. (335RGMFDB6)"
BUILD_DIR="src-tauri/gen/apple/build"

# Parse arguments
SIM_MODE=false
SIM_DEVICE=""
NO_INSTALL=false
for arg in "$@"; do
  case "$arg" in
    --sim) SIM_MODE=true ;;
    --no-install) NO_INSTALL=true ;;
    *) SIM_DEVICE="$arg" ;;
  esac
done

# ── Step 1: Build the iOS app ───────────────────────────────────────────────
echo "==> Building frontend..."
cd frontend && npm run build && cd ..

# Patch tauri.conf.json for iOS (single window, no splashscreen)
echo "==> Patching tauri.conf.json for iOS..."
cp src-tauri/tauri.conf.json src-tauri/tauri.conf.json.bak
python3 -c "
import json
with open('src-tauri/tauri.conf.json') as f:
    cfg = json.load(f)
cfg['build']['beforeBuildCommand'] = ''
cfg['build']['beforeDevCommand'] = ''
cfg['bundle'].pop('externalBin', None)
cfg['app']['windows'] = [{
    'label': 'main',
    'url': 'index.html',
    'title': 'OpenDraft',
    'width': 1280,
    'height': 800,
    'resizable': True,
    'fullscreen': False,
    'visible': True
}]
with open('src-tauri/tauri.conf.json', 'w') as f:
    json.dump(cfg, f, indent=2)
"

# Restore tauri.conf.json on exit (even if build fails)
trap 'mv src-tauri/tauri.conf.json.bak src-tauri/tauri.conf.json 2>/dev/null; echo "  Restored tauri.conf.json"' EXIT

if [ "$SIM_MODE" = true ]; then
  echo "==> Building iOS app for simulator (debug, aarch64-sim)..."
  APPLE_SIGNING_IDENTITY="-" frontend/node_modules/.bin/tauri ios build --target aarch64-sim --debug
else
  echo "==> Building iOS app (release, aarch64)..."
  frontend/node_modules/.bin/tauri ios build --target aarch64
fi

# ── Step 2: Patch Info.plist with file associations ─────────────────────────
echo "==> Patching Info.plist with file association declarations..."

if [ "$SIM_MODE" = true ]; then
  APP_PATH="$BUILD_DIR/arm64-sim/OpenDraft.app"
  if [ ! -d "$APP_PATH" ]; then
    APP_PATH=$(find "$BUILD_DIR" -name "OpenDraft.app" -path "*sim*" | head -1)
  fi
  if [ ! -d "$APP_PATH" ]; then
    echo "Error: No simulator .app found in $BUILD_DIR"
    exit 1
  fi
else
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
fi

python3 - "$APP_PATH/Info.plist" << 'PYEOF'
import plistlib, sys

plist_path = sys.argv[1]
with open(plist_path, "rb") as f:
    plist = plistlib.load(f)

plist["LSSupportsOpeningDocumentsInPlace"] = True

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

# ── Step 3+4+5: Re-sign, re-export, install ───────────────────────────────
if [ "$SIM_MODE" = true ]; then
  # Simulator: no signing needed, just install directly
  if [ "$NO_INSTALL" = true ]; then
    echo "==> Done (--no-install). App at: $APP_PATH"
    exit 0
  fi

  # Boot simulator if device name provided
  if [ -n "$SIM_DEVICE" ]; then
    echo "==> Booting simulator: $SIM_DEVICE"
    xcrun simctl boot "$SIM_DEVICE" 2>/dev/null || true
  else
    SIM_DEVICE=$(xcrun simctl list devices booted | grep -oE '"[^"]+"' | head -1 | tr -d '"')
    if [ -z "$SIM_DEVICE" ]; then
      echo ""
      echo "No simulator is booted. Either:"
      echo "  1. Boot one first:  xcrun simctl boot \"iPhone 15\""
      echo "  2. Pass a name:     ./build-ios-device.sh --sim \"iPhone 15\""
      echo ""
      echo "App is ready at: $APP_PATH"
      exit 0
    fi
  fi

  echo "==> Installing on simulator: $SIM_DEVICE"
  xcrun simctl install "$SIM_DEVICE" "$APP_PATH"
  xcrun simctl launch "$SIM_DEVICE" com.proteus.opendraft
  open -a Simulator

  echo ""
  echo "==> Done! OpenDraft launched on $SIM_DEVICE"
else
  # Device: re-sign, re-export IPA, install
  echo "==> Re-signing .app..."
  codesign -d --entitlements :- "$APP_PATH" > /tmp/opendraft_ent.plist 2>/dev/null
  codesign --force --sign "$SIGN_IDENTITY" --entitlements /tmp/opendraft_ent.plist "$APP_PATH"
  echo "  Signed with: $SIGN_IDENTITY"

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

  if [ "$NO_INSTALL" = true ]; then
    echo "==> Done (--no-install). IPA at: $PATCHED_IPA"
    exit 0
  fi

  echo "==> Installing on connected device..."
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
fi
