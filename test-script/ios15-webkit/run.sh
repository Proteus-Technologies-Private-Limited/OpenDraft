#!/usr/bin/env bash
# Reproduce the App Store "Loading timed out" review (iOS 15) without an
# iOS 15 simulator — Xcode 27 only downloads iOS 26+ runtimes.
#
# Loads two builds of the frontend in Playwright's WebKit from late 2021
# (the iOS 15 generation of JavaScriptCore) and reports whether each renders:
#   before — frontend/ as committed at a git ref (default HEAD)
#   after  — frontend/dist as currently built from the working tree
#
#   ./test-script/ios15-webkit/run.sh [git-ref]   # needs Docker
#
# Screenshots + JSON go to test-script/output/ios15/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REF="${1:-HEAD}"
PW_VERSION="${PW_VERSION:-1.15.0}"   # Playwright 1.15 ships WebKit 15.0
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-focal"
OUT="$ROOT/test-script/output/ios15"
WORK="$OUT/work"
mkdir -p "$OUT" "$WORK"

command -v docker >/dev/null || { echo "Docker is required" >&2; exit 2; }
[ -d "$ROOT/frontend/dist" ] || { echo "No frontend/dist — run: cd frontend && npm run build" >&2; exit 2; }

echo "==> Building 'before' frontend from $REF"
rm -rf "$WORK/before-src"
mkdir -p "$WORK/before-src"
git -C "$ROOT" archive "$REF" frontend src-tauri/tauri.conf.json | tar -x -C "$WORK/before-src"
ln -s "$ROOT/frontend/node_modules" "$WORK/before-src/frontend/node_modules"
( cd "$WORK/before-src/frontend" && npx vite build --logLevel error >"$WORK/before-build.log" 2>&1 ) \
  || { echo "before build failed — see $WORK/before-build.log" >&2; exit 2; }

echo "==> Copying 'after' frontend from the working tree's frontend/dist"
rm -rf "$WORK/after-dist"
cp -R "$ROOT/frontend/dist" "$WORK/after-dist"

run_check() {
  local label="$1" dist="$2" strip="${3:-0}"
  echo "==> [$label] loading in WebKit (Playwright $PW_VERSION)"
  docker run --rm --platform linux/amd64 --ipc=host \
    -v "$ROOT/test-script/ios15-webkit:/check:ro" \
    -v "$dist:/dist:ro" \
    -v "$OUT:/out" \
    -e PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    -e STRIP_BUILTINS="$strip" \
    "$IMAGE" bash -lc "
      set -e
      mkdir -p /tmp/pw && cd /tmp/pw
      npm init -y >/dev/null 2>&1
      npm i --silent --no-audit --no-fund playwright-core@$PW_VERSION >/dev/null 2>&1
      cp /check/check.js . && node check.js /dist $label /out
    " | tee "$OUT/$label.json"
  return "${PIPESTATUS[0]}"
}

set +e
run_check before "$WORK/before-src/frontend/dist"; BEFORE=$?
run_check after "$WORK/after-dist"; AFTER=$?
# This WebKit already has Safari 15.4's built-ins (Array#at, structuredClone…);
# remove them to stand in for iOS 15.0–15.3 and exercise the polyfills.
run_check after-ios15.0 "$WORK/after-dist" 1; AFTER150=$?
set -e

echo
echo "before ($REF): $([ $BEFORE -eq 0 ] && echo RENDERED || echo "FAILED (exit $BEFORE)")"
echo "after (working tree): $([ $AFTER -eq 0 ] && echo RENDERED || echo "FAILED (exit $AFTER)")"
echo "after, 15.0 built-ins: $([ $AFTER150 -eq 0 ] && echo RENDERED || echo "FAILED (exit $AFTER150)")"
# Expected for the iOS 15 fix: before fails, both after runs render.
[ $BEFORE -ne 0 ] && [ $AFTER -eq 0 ] && [ $AFTER150 -eq 0 ]
