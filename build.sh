#!/bin/bash
# Build the web app into backend/static, then refresh the runtime plugins built
# from sibling repos in the server's plugins directory.
#
#   ./build.sh               core, then the plugins (OD-Sidekick)
#   ./build.sh --core-only   core only; plugin folders are left as they are
#
# Environment:
#   OD_SIDEKICK_DIR        the Sidekick checkout to build (default ../OD-Sidekick)
#   OPENDRAFT_PLUGINS_DIR  the server's plugins directory (default backend/plugins),
#                          the same variable the backend reads
#
# Core is always built without plugins compiled in: plugins reach the web app
# as folders in the plugins directory (backend/app/frontend_plugins.py), and
# backend/static is recreated on every run. A plugin is built from its checkout
# as it stands, uncommitted work included; nothing is pulled from git.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_STATIC="$PROJECT_ROOT/backend/static"
PLUGINS_DIR="${OPENDRAFT_PLUGINS_DIR:-$PROJECT_ROOT/backend/plugins}"
SIDEKICK_DIR="${OD_SIDEKICK_DIR:-$PROJECT_ROOT/../OD-Sidekick}"

CORE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --core-only) CORE_ONLY=1 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

echo "=== Building OpenDraft Frontend ==="
cd "$FRONTEND_DIR"
# A plugin entry left in the shell would compile that plugin into core, and the
# web app would then load it twice: once built in, once from its folder.
if [ -n "${OPENDRAFT_PLUGINS:-}" ]; then
  echo "Ignoring OPENDRAFT_PLUGINS for the web build (plugins are deployed as folders)."
fi
env -u OPENDRAFT_PLUGINS npm run build

echo "=== Deploying to FastAPI static directory ==="
rm -rf "$BACKEND_STATIC"
cp -r "$FRONTEND_DIR/dist" "$BACKEND_STATIC"
echo "Frontend built and deployed to backend/static/"

# Build a plugin's runtime folder in its own repo and swap it into the plugins
# directory. The old folder is replaced only once the new one is complete, so a
# failed build leaves the server running the version it had.
#   $1 checkout   $2 plugin id   $3 npm script that writes build/runtime/<id>/
deploy_runtime_plugin() {
  local repo="$1" id="$2" script="$3"
  local built="$repo/build/runtime/$id"

  if [ ! -d "$repo" ]; then
    echo "Skipping $id: no checkout at $repo (set OD_SIDEKICK_DIR to point at it)."
    return 0
  fi
  repo="$(cd "$repo" && pwd)"
  built="$repo/build/runtime/$id"

  # The plugin compiles against core through its ./core link; say so if that
  # is not this checkout, since the folder would be built for a different core.
  if [ -e "$repo/core" ]; then
    local linked
    linked="$(cd "$repo/core" && pwd -P)"
    if [ "$linked" != "$(cd "$PROJECT_ROOT" && pwd -P)" ]; then
      echo "Warning: $repo/core points at $linked, not this checkout ($PROJECT_ROOT)."
      echo "         Run 'npm run link-core -- $PROJECT_ROOT' in $repo to build against it."
    fi
  fi

  if [ ! -d "$repo/node_modules" ]; then
    echo "Installing $id dependencies..."
    (cd "$repo" && npm ci) || { echo "Error: npm ci failed in $repo" >&2; return 1; }
  fi

  rm -rf "$built"
  (cd "$repo" && npm run "$script") || { echo "Error: 'npm run $script' failed in $repo" >&2; return 1; }
  for file in plugin.json index.js; do
    if [ ! -f "$built/$file" ]; then
      echo "Error: the $id build did not produce $built/$file" >&2
      return 1
    fi
  done

  mkdir -p "$PLUGINS_DIR" || { echo "Error: cannot create $PLUGINS_DIR" >&2; return 1; }

  # A writer may have hidden the plugin with a leading "_": update it, hidden.
  local name="$id"
  if [ ! -e "$PLUGINS_DIR/$id" ] && [ -d "$PLUGINS_DIR/_$id" ]; then
    name="_$id"
  fi
  local target="$PLUGINS_DIR/$name"

  # A link is someone's own arrangement (docs/PLUGIN_DEVELOPMENT.md); leave it.
  if [ -L "$target" ]; then
    echo "Left $target alone: it is a link to $(readlink "$target")."
    return 0
  fi

  # Dot-prefixed, so the server never lists a half-copied folder.
  local staging="$PLUGINS_DIR/.$id.new.$$" previous="$PLUGINS_DIR/.$id.old.$$"
  rm -rf "$staging" "$previous"
  if ! cp -R "$built" "$staging"; then
    rm -rf "$staging"
    echo "Error: could not copy the $id build into $PLUGINS_DIR" >&2
    return 1
  fi
  if [ -e "$target" ] && ! mv "$target" "$previous"; then
    rm -rf "$staging"
    echo "Error: could not move the old $target aside" >&2
    return 1
  fi
  if ! mv "$staging" "$target"; then
    [ -e "$previous" ] && mv "$previous" "$target"
    rm -rf "$staging"
    echo "Error: could not put the new $id folder in place; the old one is restored" >&2
    return 1
  fi
  rm -rf "$previous"

  local version
  version="$(node -p "require('$target/plugin.json').version" 2>/dev/null || echo '?')"
  if [ "$name" = "$id" ]; then
    echo "Deployed $id $version to $target"
  else
    echo "Updated $id $version in $target (still hidden: rename it to $id to show it)"
  fi
}

if [ "$CORE_ONLY" -eq 0 ]; then
  echo "=== Building runtime plugins ==="
  if ! deploy_runtime_plugin "$SIDEKICK_DIR" od-sidekick package; then
    echo "Core is deployed; od-sidekick was not updated and keeps its previous folder." >&2
    exit 1
  fi
fi

echo "=== Done ==="
echo "Reload the page to pick up the new build; the backend needs no restart."
