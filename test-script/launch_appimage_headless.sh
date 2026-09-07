#!/usr/bin/env bash
# Launch the Linux AppImage for real, headless, and decide whether it rendered.
#
# This is the end-to-end version of test-script/repro_issue_113_egl.sh: instead
# of just loading the EGL driver, it boots the actual app under Xvfb inside an
# x86_64 Arch container (current Mesa — the thing that trips over our bundled
# libwayland-client) and screenshots the result. A blank white window is the
# symptom of issue #113; a rendered UI is the fix.
#
# No GPU and no compositor needed. Mesa falls back to software rendering under
# Xvfb, which is enough, because the bug is library resolution during EGL
# driver load rather than anything the GPU does. Works from an Apple Silicon
# Mac (x86 emulation), and unchanged on any x86_64 Linux box or cloud shell
# with Docker, where it runs natively and much faster.
#
# Usage:
#   ./test-script/launch_appimage_headless.sh path/to.AppImage
#   ./test-script/launch_appimage_headless.sh 2.1.0        # a release
#
# Exits 0 when the app rendered, 1 when it came up blank.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/test-script/output/issue-113"
TARGET="${1:-2.1.0}"
# WebKit start-up is slow under x86 emulation and quick on a native runner.
SETTLE="${SETTLE_SECONDS:-150}"

mkdir -p "$OUT"

if ! docker info >/dev/null 2>&1; then
  echo "error: the Docker daemon is not running (open -a Docker)" >&2; exit 1
fi

if [[ -f "$TARGET" ]]; then
  APPIMAGE="$(cd "$(dirname "$TARGET")" && pwd)/$(basename "$TARGET")"
else
  APPIMAGE="$OUT/OpenDraft_${TARGET}_amd64.AppImage"
  [[ -f "$APPIMAGE" ]] || gh release download "v${TARGET}" \
    -p "OpenDraft_${TARGET}_amd64.AppImage" -D "$OUT"
fi

STEM=$(basename "$APPIMAGE" .AppImage)
read -r OFFSET _ _ < <("$ROOT/.github/scripts/appimage-squashfs.py" "$APPIMAGE")

echo "==> $(basename "$APPIMAGE") (squashfs at $OFFSET), settling ${SETTLE}s after launch"

# The AppImage is bind-mounted as a single file rather than by directory: with
# a bare version argument it lives in $OUT, and mounting that both ro and rw
# would be a needless collision.
docker run --rm --platform linux/amd64 \
  -v "$APPIMAGE":/in/image.AppImage:ro -v "$OUT":/out \
  -e "OFFSET=$OFFSET" -e "STEM=$STEM" -e "SETTLE=$SETTLE" \
  archlinux:latest bash -c '
set -e
# pacman 7 lands in seccomp trouble under qemu-user emulation.
pacman -Sy --noconfirm --disable-sandbox \
  squashfs-tools mesa xorg-server-xvfb libx11 dbus fontconfig ttf-dejavu imagemagick \
  >/dev/null 2>&1
echo "    host: $(pacman -Q mesa wayland | tr "\n" " ")"

unsquashfs -o "$OFFSET" -d /tmp/app -q -no-progress /in/image.AppImage >/dev/null 2>&1
echo "    bundled libwayland-* in the AppDir: $(ls /tmp/app/usr/lib | grep -c "^libwayland-" || true)"

export XDG_RUNTIME_DIR=/tmp/xdg
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
Xvfb :99 -screen 0 1280x800x24 >/dev/null 2>&1 &
sleep 3
export DISPLAY=:99
eval "$(dbus-launch --sh-syntax)"

echo "    launching"
/tmp/app/AppRun > "/out/$STEM.log" 2>&1 &
APP=$!
sleep "$SETTLE"
import -window root "/out/$STEM.png" 2>/dev/null
kill $APP 2>/dev/null || true

# A blank window is one flat colour; a rendered UI is thousands.
COLOURS=$(identify -format "%k" "/out/$STEM.png")
echo "    unique colours in the screenshot: $COLOURS"

echo
echo "--- console output ---"
sed "/dbind-WARNING/d;/AT-SPI/d" "/out/$STEM.log" | head -20 | sed "s/^/    /"
echo

if grep -q "EGL_BAD_PARAMETER" "/out/$STEM.log"; then
  echo "FAIL: EGL display creation failed — this is issue #113, the window is blank."
  exit 1
fi
if [ "$COLOURS" -lt 100 ]; then
  echo "FAIL: the screenshot has only $COLOURS colours — nothing rendered."
  exit 1
fi
echo "PASS: the app rendered its UI."
' 2>&1 | grep -v "^WARNING: The requested image"

echo "==> screenshot: test-script/output/issue-113/$STEM.png"
echo "==> log:        test-script/output/issue-113/$STEM.log"
