#!/usr/bin/env bash
# Build a debug iOS-simulator OpenDraft.app around a given frontend dist.
#
#   test-script/upgrade_compat/build_sim_app.sh <frontend-dist-dir> <out.app>
#
# Same window config as build-ios-device.sh --sim (one visible main window, no
# sidecar), passed with --config so tauri.conf.json is never touched. The
# native shell is this checkout's; only the embedded frontend changes, which
# is where every byte of script, character, location and image storage lives.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="$(cd "$1" && pwd)"
OUT="$2"
cd "$ROOT"
[ -f "$DIST/index.html" ] || { echo "No index.html in $DIST" >&2; exit 2; }
CONFIG=$(python3 -c "
import json, sys
print(json.dumps({
  'build': {'beforeBuildCommand': '', 'beforeDevCommand': '', 'frontendDist': sys.argv[1]},
  'bundle': {'externalBin': None},
  'app': {'windows': [{'label': 'main', 'url': 'index.html', 'title': 'OpenDraft', 'width': 1280,
                       'height': 800, 'resizable': True, 'fullscreen': False, 'visible': True}]},
}))" "$DIST")
# A previous build's app makes Tauri's final rename fail (os error 66) after
# xcodebuild succeeded; move it out of the way first.
STALE="$ROOT/src-tauri/gen/apple/build/arm64-sim/OpenDraft.app"
[ -d "$STALE" ] && mv "$STALE" "$(mktemp -d)/"
APPLE_SIGNING_IDENTITY="-" frontend/node_modules/.bin/tauri ios build --target aarch64-sim --debug --config "$CONFIG"
rm -rf "$OUT"
cp -R "$STALE" "$OUT"
# Tauri rewrites the tracked Info.plist on every build.
git checkout -- src-tauri/gen/apple/opendraft_iOS/Info.plist 2>/dev/null || true
echo "Built $OUT"
