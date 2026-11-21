#!/usr/bin/env bash
# Run from src-tauri. Tests are opt-in so plain headless cargo test stays usable.
set -euo pipefail
runtime_root=$(mktemp -d "${TMPDIR:-/tmp}/opendraft-titlebar.XXXXXXXX")
chmod 700 "$runtime_root"
export XDG_RUNTIME_DIR="$runtime_root"
export WAYLAND_DISPLAY=opendraft-titlebar-ci
weston --backend=headless-backend.so --use-pixman --width=1600 --height=1000 \
  --socket="$WAYLAND_DISPLAY" --idle-time=0 --log="$runtime_root/weston.log" &
compositor_pid=$!
cleanup() {
  kill "$compositor_pid" 2>/dev/null || true
  wait "$compositor_pid" 2>/dev/null || true
  # dbus-run-session's xdg-desktop-portal can start xdg-document-portal, which
  # FUSE-mounts $XDG_RUNTIME_DIR/doc and may still hold it here. rm then fails
  # on the mountpoint, and under set -e that turned a passing run red.
  if mountpoint -q "$runtime_root/doc" 2>/dev/null; then
    fusermount3 -uz "$runtime_root/doc" 2>/dev/null \
      || fusermount -uz "$runtime_root/doc" 2>/dev/null || true
  fi
  rm -rf "$runtime_root" 2>/dev/null \
    || echo "warning: could not remove $runtime_root" >&2
}
trap cleanup EXIT
ready=false
for ((attempt=0; attempt<100; attempt++)); do
  if [[ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then ready=true; break; fi
  if ! kill -0 "$compositor_pid" 2>/dev/null; then break; fi
  sleep 0.1
done
if [[ "$ready" != true ]]; then cat "$runtime_root/weston.log"; exit 1; fi
GDK_BACKEND=wayland dbus-run-session -- cargo test --locked --lib \
  linux_titlebar::tests::real_tao_wayland_titlebars -- --ignored --exact --test-threads=1
GDK_BACKEND=x11 dbus-run-session -- xvfb-run -a cargo test --locked --lib \
  linux_titlebar::tests::real_tao_x11_decorations -- --ignored --exact --test-threads=1
