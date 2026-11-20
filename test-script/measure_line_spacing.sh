#!/usr/bin/env bash
# Line spacing in a real browser: every option draws its lines exactly
# 16px × multiplier apart (the pitch pagination counts), using the CSS the
# editor injects against the app's real screenplay.css — plus the .fdx export →
# import round trip through the real parser, which needs a browser DOM.
#
# The companion to measure_line_pitch.sh (which pins standard spacing at 6
# lines per inch). No dev server needed: the app's modules are bundled with
# esbuild and the page is opened from disk in headless Chrome.
#
# Usage: ./test-script/measure_line_spacing.sh
# Output: test-script/output/line-spacing/result.txt  (exit 1 on any failure)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERE="$ROOT/test-script/line-spacing"
OUT="$ROOT/test-script/output/line-spacing"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ESBUILD="$ROOT/frontend/node_modules/.bin/esbuild"
[[ -x "$ESBUILD" ]] || ESBUILD="$ROOT/node_modules/.bin/esbuild"
mkdir -p "$OUT"

if [[ ! -x "$CHROME" ]]; then echo "Google Chrome not found at $CHROME" >&2; exit 2; fi
if [[ ! -x "$ESBUILD" ]]; then echo "esbuild not found (run npm install in frontend/)" >&2; exit 2; fi

# import.meta.env: config.ts reads it at module scope and esbuild's iife output
# leaves it empty (see fdx-browser-harness/run.sh). import.meta.glob is Vite's
# locale loader, pulled in through the template store's i18n import: stubbed to
# no files, so strings fall back to their keys — nothing here reads them.
"$ESBUILD" "$HERE/entry.ts" --bundle --format=iife --outfile="$OUT/bundle.js" --loader:.ts=ts \
  --define:process.env.NODE_ENV='"production"' \
  --define:import.meta.env='{"MODE":"production","DEV":false,"PROD":true,"BASE_URL":"/"}' \
  --define:import.meta.glob=__viteGlobStub \
  --banner:js='var __viteGlobStub = function () { return {}; };' \
  --log-level=error

FONTS="$ROOT/frontend/public/fonts"
cat > "$OUT/page.html" <<HTML
<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="file://$ROOT/frontend/src/styles/screenplay.css">
<style>
@font-face { font-family: 'Courier Prime'; src: url('file://$FONTS/CourierPrime-Regular.ttf'); font-weight: normal; font-style: normal; }
@font-face { font-family: 'Courier Prime'; src: url('file://$FONTS/CourierPrime-Bold.ttf'); font-weight: bold; font-style: normal; }
@font-face { font-family: 'Courier Prime'; src: url('file://$FONTS/CourierPrime-Italic.ttf'); font-weight: normal; font-style: italic; }
body { margin: 0; }
.page { width: 8.5in; box-sizing: border-box; }
</style>
<style id="generated"></style>
</head>
<body>
<div class="page"><div class="screenplay-content ProseMirror" id="content">
  <div class="screenplay-element action" id="plain">The rain hammers the roof. Somewhere below, a dog barks twice and falls silent. MARA stands at the window, counting the cars that pass, losing count, starting again.</div>
  <div class="screenplay-element action" id="styled">She turns. <b>Bold words</b> sit beside <i>italic ones</i> and <u>underlined ones</u>, then plain text again, long enough to wrap onto a second and a third line of the page.</div>
  <div class="screenplay-element action" id="mixed">Mixed scripts: café, naïve, Ελληνικά, кириллица, हिन्दी, 日本語, and an emoji 🎬 on one line, then more ordinary words to make it wrap onto the next line.</div>
  <div class="screenplay-element dialogue" id="dialogue">I don't know what you want me to say. I came back, didn't I? That has to count for something, even now, even here.</div>
  <div class="screenplay-element action sp-title-region" id="title">A stray line inside the title-page region stays on the standard twelve point grid however the rest of the page is spaced.</div>
  <div class="screenplay-element action sp-paragraph-grid" id="split">First line of a long paragraph<br>second line<span class="sp-paragraph-page-break"></span>third line on the next page</div>
</div></div>
<pre id="result"></pre>
<script src="file://$OUT/bundle.js"></script>
</body></html>
HTML

"$CHROME" --headless=new --disable-gpu --allow-file-access-from-files \
  --virtual-time-budget=5000 --dump-dom "file://$OUT/page.html" 2>/dev/null \
  | sed -n '/<pre id="result">/,/<\/pre>/p' \
  | sed -e 's/<pre id="result">//' -e 's/<\/pre>.*//' > "$OUT/result.txt"

cat "$OUT/result.txt"
grep -q '^ALL PASSED$' "$OUT/result.txt"
