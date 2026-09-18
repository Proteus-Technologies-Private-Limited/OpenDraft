#!/usr/bin/env bash
# Tap the booted iPad simulator using coordinates read off a landscape screenshot.
#
# The simulator's HID coordinate space is PORTRAIT-native (834 x 1210 points)
# while the app is running landscape, so a point read off the screenshot has to
# be rotated before idb will hit it:  tap_x = 834 - ly,  tap_y = lx.
#
# Usage: ipad_tap.sh <x> <y> [screenshot_width]
#   x, y             pixel coordinates as read off the landscape screenshot
#   screenshot_width the width of the image those coordinates came from
#                    (default 2000, which is how Read renders the 2420px shot)
set -euo pipefail

UDID="${IPAD_UDID:-BA067EE5-8590-4E3B-A9F4-086F8B110BFC}"
IDB="${IDB:-$(cd "$(dirname "$0")/.." && pwd)/venv/bin/idb}"

if [ $# -lt 2 ]; then
  echo "usage: $0 <x> <y> [screenshot_width]" >&2
  exit 2
fi

DX="$1"; DY="$2"; W="${3:-2000}"

read -r TX TY < <(awk -v dx="$DX" -v dy="$DY" -v w="$W" 'BEGIN {
  # The landscape screenshot is 2420 x 1668 px = 1210 x 834 points.
  h = w * 1668 / 2420
  lx = dx * 1210 / w
  ly = dy * 834 / h
  printf "%d %d\n", 834 - ly, lx
}')

"$IDB" ui tap --udid "$UDID" "$TX" "$TY"
