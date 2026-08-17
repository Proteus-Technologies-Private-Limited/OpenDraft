#!/bin/bash
# Bundle the FDX modules for the browser and serve the harness.
#   ./run.sh          bundle + serve on 8791
#   ./run.sh bundle   bundle only
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

# --define:import.meta.env is the non-obvious part. config.ts reads
# import.meta.env at module scope; esbuild's iife output leaves import.meta
# empty, so without this the bundle throws on load and window.fdx never
# appears — with no console error, because the throw happens during the
# script's own evaluation.
"$ROOT/node_modules/.bin/esbuild" "$HERE/harness-entry.ts" \
  --bundle --format=iife --outfile="$HERE/harness.js" --loader:.ts=ts \
  --define:process.env.NODE_ENV='"production"' \
  --define:import.meta.env='{"MODE":"production","DEV":false,"PROD":true}' \
  --log-level=error

echo "bundled $HERE/harness.js"
[ "${1:-serve}" = "bundle" ] && exit 0
exec node "$HERE/server.mjs"
