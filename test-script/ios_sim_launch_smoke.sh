#!/usr/bin/env bash
# Launch the iOS Simulator build of OpenDraft and fail if it does not stay up.
#
# 2.16.0 reached TestFlight and App Review aborting on every iOS launch: the
# editor asked for the displays, tao asserted the main thread, and the app
# closed about a second after it opened. CI compiled the iOS app but never ran
# it. This runs it: a fresh simulator, a clean install, one launch, and a wait
# long enough for the editor and its panels to mount.
#
#   ./test-script/ios_sim_launch_smoke.sh [path/to/OpenDraft.app]
#
# Build the app first (debug is fine; the abort happens in debug too):
#   cd frontend && npm run build && cd ..
#   APPLE_SIGNING_IDENTITY="-" frontend/node_modules/.bin/tauri ios build --target aarch64-sim --debug
#
# Environment:
#   SETTLE_SECONDS  how long the app must stay up (default 30)
#   OUT_DIR         console log and screenshot (default test-script/output/ios-launch)
#
# Fails (exit 1) when the app is not running after SETTLE_SECONDS, when a new
# OpenDraft crash report appears, or when the console shows a Rust panic.
# Exit 2 is a setup problem (no app, no iOS runtime).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/src-tauri/gen/apple/build/arm64-sim/OpenDraft.app}"
BUNDLE=com.proteus.opendraft
SETTLE="${SETTLE_SECONDS:-30}"
OUT="${OUT_DIR:-$ROOT/test-script/output/ios-launch}"
REPORTS="$HOME/Library/Logs/DiagnosticReports"
mkdir -p "$OUT"

[ -d "$APP" ] || { echo "No app at $APP — build it first (see the header)." >&2; exit 2; }

# A throwaway iPhone on the newest iOS runtime, so no earlier data or state
# hides a launch problem, and the developer's own simulators are left alone.
read -r RUNTIME DEVICE_TYPE < <(xcrun simctl list runtimes -j | python3 -c '
import json, re, sys
runtimes = [r for r in json.load(sys.stdin)["runtimes"]
            if r.get("isAvailable") and r.get("platform") == "iOS"]
# Newest first; a device-specific runtime (e.g. iOS-27-2-iPhone19-4 for the
# iPhone Duo) after the general one of the same version.
general = lambda r: bool(re.fullmatch(r"com\.apple\.CoreSimulator\.SimRuntime\.iOS-\d+-\d+", r["identifier"]))
runtimes.sort(key=lambda r: ([int(p) for p in r["version"].split(".")], general(r)), reverse=True)
for r in runtimes:
    phones = [d for d in r.get("supportedDeviceTypes", [])
              if d.get("productFamily") == "iPhone"]
    plain = [d for d in phones if not re.search(r"Duo|SE|Fold", d.get("name", ""))]
    if phones:
        print(r["identifier"], (plain or phones)[-1]["identifier"])
        break
')
[ -n "${RUNTIME:-}" ] || { echo "No iOS simulator runtime with an iPhone is installed." >&2; exit 2; }

UDID=$(xcrun simctl create "OpenDraft launch smoke" "$DEVICE_TYPE" "$RUNTIME")
CONSOLE_PID=""
cleanup() {
  [ -n "$CONSOLE_PID" ] && kill "$CONSOLE_PID" 2>/dev/null || true
  xcrun simctl shutdown "$UDID" >/dev/null 2>&1 || true
  xcrun simctl delete "$UDID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> $DEVICE_TYPE on $RUNTIME ($UDID)"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl install "$UDID" "$APP"

crash_reports() { ls "$REPORTS"/OpenDraft-*.ips 2>/dev/null | sort || true; }
BEFORE="$(crash_reports)"

echo "==> Launching; the app must stay up for ${SETTLE}s"
xcrun simctl launch --console-pty "$UDID" "$BUNDLE" > "$OUT/console.log" 2>&1 &
CONSOLE_PID=$!
sleep "$SETTLE"

xcrun simctl io "$UDID" screenshot "$OUT/launch.png" >/dev/null 2>&1 || true

FAILED=0
# Read the list first: `launchctl list | grep -q` under pipefail fails whenever
# grep stops early and launchctl takes the SIGPIPE.
SERVICES="$(xcrun simctl spawn "$UDID" launchctl list 2>/dev/null || true)"
if ! grep -q "UIKitApplication:$BUNDLE" <<<"$SERVICES"; then
  echo "FAIL: OpenDraft is not running ${SETTLE}s after launch." >&2
  FAILED=1
fi

NEW_REPORTS="$(comm -13 <(echo "$BEFORE") <(crash_reports) | grep . || true)"
if [ -n "$NEW_REPORTS" ]; then
  echo "FAIL: new crash report(s):" >&2
  echo "$NEW_REPORTS" >&2
  for report in $NEW_REPORTS; do
    cp "$report" "$OUT/" 2>/dev/null || true
    # The crashing thread, symbolicated (a simulator build keeps its symbols).
    python3 - "$report" <<'PY' >&2 || true
import json, sys
raw = open(sys.argv[1]).read()
_, body = raw.split("\n", 1)
crash = json.loads(body)
images = crash["usedImages"]
thread = crash["threads"][crash["faultingThread"]]
print("  thread:", thread.get("name") or thread.get("queue") or crash["faultingThread"])
for frame in thread["frames"][:40]:
    symbol = frame.get("symbol")
    if symbol:
        where = f'{frame.get("sourceFile", "")}:{frame.get("sourceLine", "")}'.strip(":")
        print(f'    {images[frame["imageIndex"]].get("name")}  {symbol[:140]}  {where}')
PY
  done
  FAILED=1
fi

if grep -qE "panicked at|panic in a function that cannot unwind" "$OUT/console.log"; then
  echo "FAIL: Rust panic in the console:" >&2
  grep -E -A3 "panicked at|cannot unwind" "$OUT/console.log" | head -20 >&2
  FAILED=1
fi

if [ "$FAILED" -ne 0 ]; then
  echo "Console log and screenshot: $OUT" >&2
  exit 1
fi
echo "PASS: OpenDraft stayed up for ${SETTLE}s with no crash report or panic."
