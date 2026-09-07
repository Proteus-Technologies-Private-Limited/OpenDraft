#!/usr/bin/env bash
# Reproduce issue #113 — the Linux AppImage shows a blank white window on
# Arch/GNOME/Wayland, with "Could not create default EGL display:
# EGL_BAD_PARAMETER" on the console.
#
# Needs only Docker (works on an Apple Silicon Mac, via amd64 emulation).
# No Linux VM, no GPU and no Wayland compositor required: the failure is a
# library-resolution problem, so loading the host's Mesa EGL driver against the
# AppImage's bundled libwayland-client is enough to trigger it.
#
# Usage:
#   ./test-script/repro_issue_113_egl.sh                  # released 2.1.0
#   ./test-script/repro_issue_113_egl.sh 2.1.1            # another release
#   ./test-script/repro_issue_113_egl.sh path/to.AppImage # a local build
#
# Exits 0 when the AppImage is safe on a current distro, 1 when it reproduces
# the bug.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/test-script/output/issue-113"
TARGET="${1:-2.1.0}"

mkdir -p "$OUT"

if ! command -v docker >/dev/null; then
  echo "error: docker is required" >&2; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "error: the Docker daemon is not running (open -a Docker)" >&2; exit 1
fi

# ------------------------------------------------------------------- 1. artifact
if [[ -f "$TARGET" ]]; then
  APPIMAGE="$(cd "$(dirname "$TARGET")" && pwd)/$(basename "$TARGET")"
else
  APPIMAGE="$OUT/OpenDraft_${TARGET}_amd64.AppImage"
  if [[ ! -f "$APPIMAGE" ]]; then
    echo "==> downloading OpenDraft_${TARGET}_amd64.AppImage"
    gh release download "v${TARGET}" -p "OpenDraft_${TARGET}_amd64.AppImage" -D "$OUT"
  fi
fi
echo "==> $(basename "$APPIMAGE")"

# ---------------------------------------------------------------- 2. unpack it
# Reuses the release script's superblock reader, so this stays in step with
# whatever the AppImage layout turns out to be.
read -r OFFSET _ _ < <("$ROOT/.github/scripts/appimage-squashfs.py" "$APPIMAGE")
echo "==> squashfs at offset $OFFSET"

# Only libwayland-client is ever extracted. The AppDir root holds names that
# collide on a case-insensitive macOS volume, and the listing answers every
# other question without unpacking 90 MB of WebKit.
APPDIR="$OUT/AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR"
docker run --rm -v "$(dirname "$APPIMAGE")":/in -v "$APPDIR":/out alpine:3.20 sh -c \
  "apk add -q squashfs-tools \
   && unsquashfs -l -o $OFFSET '/in/$(basename "$APPIMAGE")' > /out/listing.txt \
   && unsquashfs -o $OFFSET -d /out/lib -q -no-progress \
        '/in/$(basename "$APPIMAGE")' 'usr/lib/libwayland-*' >/dev/null 2>&1 || true"

LIBS=$(grep -oE 'squashfs-root/usr/lib/[^/]+$' "$APPDIR/listing.txt" | sed 's|.*/||' | sort -u)

echo
echo "==> Wayland libraries bundled inside the AppImage:"
echo "$LIBS" | grep -E '^libwayland-' | sed 's/^/    /' \
  || echo "    (none — nothing to collide with the host's Mesa)"
echo "==> Mesa/EGL bundled inside the AppImage (expected: none, it comes from the host):"
echo "$LIBS" | grep -E 'libEGL|libGLX|libGL\.so|libglapi|libgbm|mesa' | sed 's/^/    /' \
  || echo "    (none)"

BUNDLED_CLIENT="$APPDIR/lib/usr/lib/libwayland-client.so.0"
if [[ ! -f "$BUNDLED_CLIENT" ]]; then
  echo
  echo "PASS: no bundled libwayland-client, so the host's libEGL resolves cleanly."
  exit 0
fi

# ------------------------------------------------------- 3. reproduce at runtime
# On the reporter's machine the host Mesa is what loads, but AppRun puts
# $APPDIR/usr/lib ahead of it on the search path, so Mesa binds to the stale
# Ubuntu 22.04 libwayland-client shipped in the AppImage. Forcing that same
# stale copy with LD_PRELOAD is the exact inverse of the reporter's workaround.
echo
echo "==> loading the host EGL driver under x86_64 Arch (current Mesa)"
docker run --rm --platform linux/amd64 -v "$(dirname "$BUNDLED_CLIENT")":/bundled archlinux:latest bash -c '
set -e
# pacman 7 lands in seccomp trouble under qemu-user emulation
pacman -Sy --noconfirm --disable-sandbox mesa wayland binutils python >/dev/null 2>&1
echo "    host: $(pacman -Q wayland mesa | tr "\n" " ")"

cat > /tmp/loadegl.py <<"PY"
import ctypes, os, sys
try:
    ctypes.CDLL("/usr/lib/libEGL_mesa.so.0", mode=os.RTLD_NOW | os.RTLD_LOCAL)
    print("    OK    Mesa EGL driver loaded -> the app renders")
except OSError as e:
    print("    FAIL ", e)
    print("          libEGL reports this to its caller as EGL_BAD_PARAMETER,")
    print("          WebKit gets no renderer, and the window comes up blank.")
    sys.exit(1)
PY

echo
echo "  [A] host libwayland-client  (== the reporter LD_PRELOAD workaround)"
python3 /tmp/loadegl.py || true

echo
echo "  [B] AppImage bundled libwayland-client  (== plain ./OpenDraft.AppImage)"
set +e
LD_PRELOAD=/bundled/libwayland-client.so.0 python3 /tmp/loadegl.py
RC=$?
set -e

echo
echo "  symbols current Mesa needs that the bundled libwayland-client lacks:"
nm -D --undefined-only /usr/lib/libEGL_mesa.so.0 | grep -o "wl_[a-z_]*" | sort -u > /tmp/needed
nm -D --defined-only /bundled/libwayland-client.so.0 | grep -o "wl_[a-z_]*" | sort -u > /tmp/bundled
comm -23 /tmp/needed /tmp/bundled | sed "s/^/    /"

exit $RC
' && { echo; echo "PASS: the bundled libwayland-client still satisfies current Mesa."; exit 0; }

echo
echo "FAIL: reproduced issue #113 — this AppImage shows a blank window on a current distro."
echo "      Fix: .github/scripts/fix-appimage-wayland.sh <appimage>"
exit 1
