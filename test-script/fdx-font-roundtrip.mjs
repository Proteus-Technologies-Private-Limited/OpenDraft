/*
 * Final Draft font round trip, in a real browser DOM.
 *
 * fdxParser is built on querySelector (including `:scope >`), which
 * @xmldom/xmldom does not implement, so the node suite cannot drive it — see
 * the note in src/utils/fdxFonts.test.ts.  This stages a page that exports a
 * script to FDX and reads it straight back with the shipped parser, then
 * checks the typefaces survived.
 *
 *   npx vite-node ../test-script/fdx-font-roundtrip.mjs      (from frontend/)
 *   python3 -m http.server -d test-script/output/fdx-font-roundtrip 8097
 *
 * Then open the page, or dump it headless:
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --dump-dom http://127.0.0.1:8097/index.html
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'test-script/output/fdx-font-roundtrip');
mkdirSync(outDir, { recursive: true });

await build({
  stdin: {
    contents: `
      import { exportFDX } from '${repoRoot}/frontend/src/utils/fdxExporter.ts';
      import { parseFDXFull } from '${repoRoot}/frontend/src/utils/fdxParser.ts';
      window.exportFDX = exportFDX;
      window.parseFDXFull = parseFDXFull;
    `,
    resolveDir: repoRoot,
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  outfile: join(outDir, 'fdx.js'),
  logLevel: 'warning',
});

writeFileSync(
  join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>FDX font round trip</title>
<style>body{font:13px ui-monospace,monospace;padding:16px}.fail{color:#b00}.pass{color:#070}</style>
<h1>FDX font round trip, real DOM</h1>
<pre id="out">running…</pre>
<script src="fdx.js"></script>
<script>
const lines = [];
let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  lines.push((ok ? '<span class="pass">PASS ' : '<span class="fail">FAIL ') + label +
    (ok ? '' : ' — got ' + JSON.stringify(got) + ', wanted ' + JSON.stringify(want)) + '</span>');
};

const text = (s, font) => ({ type: 'text', text: s,
  ...(font ? { marks: [{ type: 'textStyle', attrs: { fontFamily: font } }] } : {}) });
const script = (styledFont) => ({ type: 'doc', content: [
  { type: 'sceneHeading', content: [text('INT. LIBRARY - DAY')] },
  { type: 'action', content: [text('A PROGRAMMER types.')] },
  ...(styledFont ? [{ type: 'action', content: [text('A note.', styledFont)] }] : []),
  { type: 'character', content: [text('PROGRAMMER')] },
  { type: 'dialogue', content: [text('Eureka.')] },
]});
// Find by text, not by index: the exported file may carry a title page, which
// comes back as an extra leading node.
const nodeWith = (doc, wanted) => doc.content.find(
  (n) => (n.content || []).map((r) => r.text || '').join('') === wanted) || { content: [] };
const marksOf = (doc, wanted) => (nodeWith(doc, wanted).content || []).flatMap((r) => r.marks || []);
const allMarks = (doc) => doc.content.flatMap((n) => (n.content || []).flatMap((r) => r.marks || []));

// 1. A Courier script: no document font set, no marks anywhere.
{
  const parsed = window.parseFDXFull(window.exportFDX(script()));
  check('courier script keeps Courier', parsed.documentFont, { family: 'Courier Prime', size: '12' });
  check('courier script carries no font marks', allMarks(parsed.doc), []);
}

// 2. A script set in Times New Roman.
{
  const xml = window.exportFDX(script(), 'T', undefined, undefined, undefined, undefined, undefined,
    undefined, { family: 'Times New Roman', size: 12 });
  const parsed = window.parseFDXFull(xml);
  check('document font survives the round trip', parsed.documentFont,
    { family: 'Times New Roman', size: '12' });
  check('its runs need no marks', allMarks(parsed.doc), []);
}

// 3. A Times New Roman script with one Arial section.
{
  const xml = window.exportFDX(script('Arial'), 'T', undefined, undefined, undefined, undefined,
    undefined, undefined, { family: 'Times New Roman', size: 12 });
  const parsed = window.parseFDXFull(xml);
  check('document font survives alongside a section font', parsed.documentFont.family, 'Times New Roman');
  check('the plain action keeps no mark', marksOf(parsed.doc, 'A PROGRAMMER types.'), []);
  check('the styled section keeps Arial', marksOf(parsed.doc, 'A note.'),
    [{ type: 'textStyle', attrs: { fontFamily: 'Arial' } }]);
}

// 4. An 11pt manuscript: the size is the document's, not a fixed 12.
{
  const xml = window.exportFDX(script(), 'T', undefined, undefined, undefined, undefined, undefined,
    undefined, { family: 'Georgia', size: 11 });
  const parsed = window.parseFDXFull(xml);
  check('point size survives', parsed.documentFont, { family: 'Georgia', size: '11' });
  check('11pt runs need no size mark', allMarks(parsed.doc), []);
}

lines.push('');
lines.push(failed === 0
  ? '<span class="pass">RESULT: the FDX round trip keeps every font.</span>'
  : '<span class="fail">RESULT: ' + failed + ' check(s) failed.</span>');
document.getElementById('out').innerHTML = lines.join('\\n');
</script>`,
);

console.log(`Staged in ${outDir}`);
console.log(`Serve it:  python3 -m http.server -d ${outDir} 8097`);
