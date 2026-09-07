#!/bin/bash
#
# Remove the bundled Wayland client libraries from the built AppImage.
#
# linuxdeploy (which the Tauri AppImage bundler drives) walks ldd and copies
# every dependency it finds into AppDir/usr/lib, including libwayland-client.
# It does NOT bundle Mesa — libEGL always comes from the user's machine. The
# AppRun then puts AppDir/usr/lib ahead of the system path, so on a host newer
# than the ubuntu-22.04 build runner the host's own libEGL_mesa gets resolved
# against our five-year-old libwayland-client, fails to find symbols it needs
# (wl_fixes_interface, wl_display_create_queue_with_name, ...), and libEGL
# reports EGL_BAD_PARAMETER. WebKit then has no renderer and the window comes
# up blank white — reported from Arch + GNOME/Wayland as issue #113, where
# LD_PRELOAD=/usr/lib/libwayland-client.so.0 worked around it by forcing the
# host copy to win. test-script/repro_issue_113_egl.sh reproduces the whole
# chain against real Arch Mesa in a container.
#
# libwayland is host-ABI-coupled for exactly this reason and sits on the
# upstream AppImage excludelist; the linuxdeploy build Tauri fetches misses it.
# Every desktop that can run a GTK3 app already ships it, so dropping ours is
# strictly a fix.
#
# Repacking reuses the AppImage's own runtime — the ELF prefix the file already
# starts with — rather than downloading appimagetool, so a release build depends
# on nothing new from the network.
#
# Optional argument: a path to an AppImage. Defaults to the release bundle.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APPIMAGE="${1:-}"
if [ -z "$APPIMAGE" ]; then
  APPIMAGE=$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name "*.AppImage" 2>/dev/null | head -1)
fi
if [ -z "$APPIMAGE" ] || [ ! -f "$APPIMAGE" ]; then
  echo "::error::No AppImage found to repack."
  exit 1
fi
echo "Repacking $(basename "$APPIMAGE")"

for TOOL in mksquashfs unsquashfs; do
  if ! command -v "$TOOL" >/dev/null; then
    echo "::error::$TOOL not found — install squashfs-tools before this step."
    exit 1
  fi
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

read -r OFFSET COMP BLOCK < <("$HERE/appimage-squashfs.py" "$APPIMAGE") || {
  echo "::error::Could not read the squashfs image inside $(basename "$APPIMAGE")."
  exit 1
}
echo "Runtime is $OFFSET bytes; squashfs starts there ($COMP, ${BLOCK}-byte blocks)."

APPDIR="$WORK/squashfs-root"
unsquashfs -o "$OFFSET" -d "$APPDIR" -q -no-progress "$APPIMAGE" >/dev/null
if [ ! -f "$APPDIR/AppRun" ]; then
  echo "::error::Unpacked $(basename "$APPIMAGE") has no AppRun — the bundle layout is not what this script expects."
  exit 1
fi

BUNDLED=$(find "$APPDIR/usr/lib" -maxdepth 1 -name "libwayland-*" | sort)
if [ -z "$BUNDLED" ]; then
  echo "No bundled Wayland libraries — linuxdeploy already excludes them, leaving the AppImage untouched."
  exit 0
fi
echo "Removing:"
while IFS= read -r LIB; do
  echo "  $(basename "$LIB")"
  rm -f "$LIB"
done <<< "$BUNDLED"

# Rebuild with the compressor and block size the file already used: the runtime
# we are about to re-attach is the only thing that will ever mount this, so
# whatever it reads today it will still read.
mksquashfs "$APPDIR" "$WORK/fs.squashfs" \
  -root-owned -noappend -no-progress -quiet \
  -comp "$COMP" -b "$BLOCK"

head -c "$OFFSET" "$APPIMAGE" > "$WORK/repacked"
cat "$WORK/fs.squashfs" >> "$WORK/repacked"
chmod +x "$WORK/repacked"

# A truncated or empty filesystem would still look like a valid AppImage, so
# read the payload back out of the repacked file before it replaces the one
# that ships.
read -r NEW_OFFSET _ _ < <("$HERE/appimage-squashfs.py" "$WORK/repacked") || {
  echo "::error::The repacked AppImage has no readable squashfs image — refusing to ship it."
  exit 1
}
if ! unsquashfs -l -o "$NEW_OFFSET" "$WORK/repacked" | grep -q "squashfs-root/AppRun$"; then
  echo "::error::The repacked AppImage does not contain AppRun — refusing to ship it."
  exit 1
fi

mv "$WORK/repacked" "$APPIMAGE"
chmod +x "$APPIMAGE"
echo "Repacked $(basename "$APPIMAGE") ($(du -h "$APPIMAGE" | cut -f1))"
