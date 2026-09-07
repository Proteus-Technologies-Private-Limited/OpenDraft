#!/bin/bash
#
# Read back off the AppImage that actually ships: no host-ABI-coupled Wayland
# library may be bundled inside it, and the payload must still be intact.
#
# The strip in fix-appimage-wayland.sh is easy to lose silently — a Tauri
# upgrade that moves the bundle path, a linuxdeploy change, a refactor that
# drops the step. The symptom is a blank white window on any distro newer than
# the build runner (issue #113), which nothing else here would notice and which
# arrives as a bug report days after the tag. So check the artifact, the same
# way the Android job reads 16 KB page alignment back off the APK.
#
# Optional argument: a path to an AppImage. Defaults to the release bundle.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  APPIMAGE=$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name "*.AppImage" 2>/dev/null | head -1)
fi
if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
  echo "::error::No AppImage to verify."
  exit 1
fi

if ! command -v unsquashfs >/dev/null; then
  echo "::error::unsquashfs not found — install squashfs-tools before this step."
  exit 1
fi

read -r OFFSET _ _ < <("$HERE/appimage-squashfs.py" "$APPIMAGE") || {
  echo "::error::Could not read the squashfs image inside $(basename "$APPIMAGE")."
  exit 1
}

LISTING=$(unsquashfs -l -o "$OFFSET" "$APPIMAGE")
NAME=$(basename "$APPIMAGE")
FAILED=0

BUNDLED=$(echo "$LISTING" | grep -oE 'squashfs-root/usr/lib/libwayland-[^/]*$' | sort -u || true)
if [ -n "$BUNDLED" ]; then
  while IFS= read -r LIB; do
    echo "::error::$NAME bundles $(basename "$LIB") — the host's libEGL resolves against it and fails with EGL_BAD_PARAMETER on any distro newer than the build runner (issue #113)."
  done <<< "$BUNDLED"
  FAILED=1
fi

# A repack that silently produced an empty or truncated filesystem would clear
# the check above for the wrong reason.
for REQUIRED in AppRun usr/bin/opendraft usr/lib/libwebkit2gtk-4.1.so.0; do
  if ! echo "$LISTING" | grep -q "squashfs-root/$REQUIRED\$"; then
    echo "::error::$REQUIRED is missing from $NAME — the bundle is incomplete."
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi

echo "Verified: $NAME bundles no Wayland libraries and carries a complete AppDir."
