/**
 * Builds a page that runs OpenDraft's own device-font detection and shows what
 * it found, so the answer can be read off a device that cannot be driven.
 *
 * The simulator has no input API, so a page that reports its result by drawing
 * it is the only way to get iPadOS to tell us which fonts it really has.
 *
 * Usage: node probe-page.mjs <output.html>
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, 'probe.html');

const bundled = await build({
  entryPoints: [process.env.PROBE_SRC || join(here, '../../frontend/src/utils/deviceFonts.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'OD',
  write: false,
  platform: 'browser',
});

writeFileSync(out, `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Font probe</title>
<style>
  body { font: 15px/1.5 -apple-system, sans-serif; margin: 16px; background: #111; color: #eee; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .n { font-size: 42px; font-weight: 700; color: #4a9eff; }
  code { color: #9ad; }
  ul { columns: 3; font-size: 13px; padding-left: 18px; }
  .k { color: #888; }
</style>
<h1>OpenDraft device-font probe — ${process.env.PROBE_LABEL || 'current'}</h1>
<div id="out">running…</div>
<script>${bundled.outputFiles[0].text}</script>
<script>
  const found = OD.detectDeviceFonts();
  const names = found.map(f => f.name);
  document.getElementById('out').innerHTML =
    '<p class="k">navigator.platform: <code>' + navigator.platform + '</code> · maxTouchPoints: <code>'
      + navigator.maxTouchPoints + '</code></p>'
    + '<p class="k">queryLocalFonts available: <code>' + OD.canQueryLocalFonts() + '</code></p>'
    + '<p><span class="n">' + names.length + '</span> fonts found on this device</p>'
    + '<ul>' + names.map(n => '<li>' + n + '</li>').join('') + '</ul>';
</script>
`);
console.log('wrote', out);
