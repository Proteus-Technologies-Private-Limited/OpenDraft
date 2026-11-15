#!/usr/bin/env bash
# Launch a released/native build with disposable storage, then measure it.
set -euo pipefail
if (( $# < 2 || $# > 3 )); then
  echo 'Usage: launch.sh /absolute/path/to/opendraft /absolute/output [default|compositing-off]' >&2
  exit 2
fi
app=$(realpath "$1")
output=$(realpath -m "$2")
mode=${3:-default}
case "$mode" in
  default) unset WEBKIT_DISABLE_DMABUF_RENDERER WEBKIT_DISABLE_COMPOSITING_MODE ;;
  compositing-off) export WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1 ;;
  *) echo 'Unknown rendering comparison' >&2; exit 2 ;;
esac
for dependency in node xdotool curl; do command -v "$dependency" >/dev/null; done
[[ -x "$app" && -n "${DISPLAY:-}" ]]
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
profile_root=$(mktemp -d "${TMPDIR:-/tmp}/opendraft-native-scroll.XXXXXXXX")
mkdir -p "$profile_root"/{data,config,cache,runtime} "$output"
chmod 700 "$profile_root/runtime"
export XDG_DATA_HOME="$profile_root/data" XDG_CONFIG_HOME="$profile_root/config"
export XDG_CACHE_HOME="$profile_root/cache" XDG_RUNTIME_DIR="$profile_root/runtime"
export TAURI_WEBVIEW_AUTOMATION=true
# Pick an unused port; stop any existing OpenDraft before running this script.
port=${OPENDRAFT_INSPECTOR_PORT:-9229}
export WEBKIT_INSPECTOR_HTTP_SERVER="127.0.0.1:$port"
"$app" > "$output/app.log" 2>&1 &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true' EXIT
ready=false
for ((i=0; i<240; i++)); do
  kill -0 "$app_pid" 2>/dev/null || { echo 'Native app exited; see app.log' >&2; exit 1; }
  if curl --silent --max-time 1 "http://127.0.0.1:$port/" | grep -q '/socket/' &&
      [[ $(xdotool search --onlyvisible --pid "$app_pid" 2>/dev/null | wc -l) -eq 1 ]]; then
    ready=true
    break
  fi
  sleep 0.25
done
[[ "$ready" = true ]] || { echo 'Native inspector/window did not become ready' >&2; exit 1; }
# Set OPENDRAFT_DISPLAY_PID to Xvfb's PID to include display-server CPU.
args=(--allow-synthetic-document "--profile-root=$profile_root" "--pid=$app_pid"
  "--inspector=http://127.0.0.1:$port" "--output=$output" "--mode=$mode" --repetitions=3 --profile)
if [[ -n "${OPENDRAFT_DISPLAY_PID:-}" ]]; then args+=("--display-pid=$OPENDRAFT_DISPLAY_PID"); fi
node "$script_dir/run.mjs" "${args[@]}"
if [[ "${OPENDRAFT_SHADOW_COMPARISON:-0}" = 1 ]]; then
  node "$script_dir/run.mjs" "${args[@]}" --shadow-comparison "--output=$output/shadow-comparison"
fi
printf 'Disposable profile retained at %s\n' "$profile_root"
