#!/usr/bin/env bash
# Drive the OpenDraft iPad simulator: tap in *points*, capture to test-script/output/.
#
# idb reports this device as 834x1210 points / 1668x2420 pixels, so a coordinate
# read off a screenshot is half the pixel value. `shot` prints both the file and
# the app's current route, which is what most of these checks are actually about.
#
#   ./test-script/ipad-sim.sh shot before-tap
#   ./test-script/ipad-sim.sh tap 241 262
#   ./test-script/ipad-sim.sh relaunch
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UDID="${OPENDRAFT_SIM_UDID:-A07CFEF6-A4C6-408F-A648-5C5115F525A8}"
BUNDLE=com.proteus.opendraft
IDB="$ROOT/venv/bin/idb"
export PATH=/opt/homebrew/bin:$PATH

case "${1:-}" in
  tap)    "$IDB" ui tap --udid "$UDID" "$2" "$3"; sleep "${4:-1}" ;;
  text)   "$IDB" ui text --udid "$UDID" "$2" ;;
  shot)   out="$ROOT/test-script/output/${2:-sim}.png"
          xcrun simctl io "$UDID" screenshot --type=png "$out" >/dev/null 2>&1
          echo "$out" ;;
  relaunch) xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
          xcrun simctl launch "$UDID" "$BUNDLE" ;;
  install) xcrun simctl install "$UDID" "$2"; xcrun simctl terminate "$UDID" "$BUNDLE" >/dev/null 2>&1 || true
          xcrun simctl launch "$UDID" "$BUNDLE" ;;
  *) echo "usage: $0 {tap X Y [settle] | text STR | shot NAME | relaunch | install APP}" >&2; exit 2 ;;
esac
