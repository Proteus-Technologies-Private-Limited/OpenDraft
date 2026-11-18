#!/usr/bin/env bash
# Measures the screen line pitch of the script page in a real browser, against
# the 6 lines per inch (12pt Courier) that Final Draft and the printed page use.
#
# Builds a static page from the app's own screenplay.css rules for the page and
# its text, renders it in headless Chrome, and reads each line's top back with
# getClientRects(). No dev server needed.
#
# Usage: ./test-script/measure_line_pitch.sh
# Output: test-script/output/line-pitch/result.txt
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/test-script/output/line-pitch"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT"

if [[ ! -x "$CHROME" ]]; then
  echo "Google Chrome not found at $CHROME" >&2
  exit 2
fi

FONTS="$ROOT/frontend/public/fonts"

cat > "$OUT/page.html" <<HTML
<!doctype html>
<html><head><meta charset="utf-8">
<style>
@font-face { font-family: 'Courier Prime'; src: url('file://$FONTS/CourierPrime-Regular.ttf'); font-weight: normal; font-style: normal; }
@font-face { font-family: 'Courier Prime'; src: url('file://$FONTS/CourierPrime-Bold.ttf'); font-weight: bold; font-style: normal; }
@font-face { font-family: 'Courier Prime'; src: url('file://$FONTS/CourierPrime-Italic.ttf'); font-weight: normal; font-style: italic; }
:root {
  --screenplay-font: 'Courier Final Draft', 'Courier Prime', 'Courier New', 'Courier', monospace;
  --screenplay-font-size: 12pt;
  --screenplay-line-height: 1;
}
body { margin: 0; }
.page { width: 8.5in; padding: 1in 1in 1in 1.5in; box-sizing: border-box; }
.screenplay-content {
  font-family: var(--screenplay-font);
  font-size: var(--screenplay-font-size);
  line-height: var(--screenplay-line-height);
  letter-spacing: -0.31px;
}
.screenplay-element { margin: 0; white-space: pre-wrap; }
.dialogue { padding-left: 1in; width: 3.5in; }
</style></head>
<body>
<div class="page"><div class="screenplay-content">
  <p class="screenplay-element action" id="plain">The rain hammers the roof. Somewhere below, a dog barks twice and falls silent. MARA stands at the window, counting the cars that pass, losing count, starting again.</p>
  <p class="screenplay-element action" id="styled">She turns. <b>Bold words</b> sit beside <i>italic ones</i> and <u>underlined ones</u>, then plain text again, long enough to wrap onto a second and a third line of the page.</p>
  <p class="screenplay-element action" id="mixed">Mixed scripts: café, naïve, Ελληνικά, кириллица, हिन्दी, 日本語, and an emoji 🎬 on one line, then more ordinary words to make it wrap onto the next line.</p>
  <p class="screenplay-element dialogue" id="dialogue">I don't know what you want me to say. I came back, didn't I? That has to count for something, even now, even here.</p>
</div></div>
<pre id="result"></pre>
<script>
function lineTops(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  const tops = [];
  for (const r of range.getClientRects()) {
    const top = Math.round(r.top * 100) / 100;
    if (r.width > 0 && !tops.some((t) => Math.abs(t - top) < 2)) tops.push(top);
  }
  return tops.sort((a, b) => a - b);
}
function measure() {
  const pxPerInch = 96;
  const target = pxPerInch / 6; // 6 lines per inch = 16px
  const out = ['Target pitch (6 lines/inch, 12pt): ' + target + 'px'];
  const family = getComputedStyle(document.querySelector('.screenplay-content')).fontFamily;
  out.push('Font stack: ' + family);
  // Which face actually drew the text: a font that is missing falls through
  // the stack, so compare widths against each candidate on its own.
  const probe = document.createElement('span');
  probe.textContent = 'MMMMMMMMMMiiiiiiiiii';
  probe.style.cssText = 'position:absolute;visibility:hidden;font-size:12pt;letter-spacing:0';
  document.body.appendChild(probe);
  const widthOf = (f) => { probe.style.fontFamily = f; return probe.getBoundingClientRect().width; };
  const used = widthOf(family);
  const face = ["'Courier Final Draft'", "'Courier Prime'", "'Courier New'", 'Courier']
    .find((f) => widthOf(f + ', serif') !== widthOf('serif') && Math.abs(widthOf(f + ', serif') - used) < 0.01);
  probe.remove();
  out.push('Face in use: ' + (face || 'generic monospace'));
  for (const id of ['plain', 'styled', 'mixed', 'dialogue']) {
    const el = document.getElementById(id);
    const tops = lineTops(el);
    const pitches = tops.slice(1).map((t, i) => Math.round((t - tops[i]) * 100) / 100);
    const box = el.getBoundingClientRect().height;
    out.push(id + ': ' + tops.length + ' lines, pitches ' + JSON.stringify(pitches) +
      ', block height ' + box + 'px (expected ' + tops.length * target + 'px)');
  }
  document.getElementById('result').textContent = out.join('\n');
}
document.fonts.ready.then(() => setTimeout(measure, 200));
</script>
</body></html>
HTML

"$CHROME" --headless=new --disable-gpu --allow-file-access-from-files \
  --virtual-time-budget=3000 --dump-dom "file://$OUT/page.html" 2>/dev/null \
  | sed -n '/<pre id="result">/,/<\/pre>/p' \
  | sed -e 's/<pre id="result">//' -e 's/<\/pre>.*//' > "$OUT/result.txt"

cat "$OUT/result.txt"
