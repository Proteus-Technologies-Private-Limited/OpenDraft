/*
 * Stage a browser check of the OSF parser.
 *
 * The unit suite and osf-corpus.mjs both run under @xmldom/xmldom, but the app
 * parses with the WebView's own DOMParser.  This builds a page that runs the
 * shipped parser against the corpus in a real browser and diffs the result
 * against what Node produced, so a DOM difference cannot hide behind green
 * tests.
 *
 *   npx vite-node test-script/osf-browser-check.mjs [outdir]
 *   npx http-server <outdir>        (or: python3 -m http.server -d <outdir>)
 *
 * Then open the page: it prints PASS/FAIL per file.
 */
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import JSZip from 'jszip';

globalThis.DOMParser = DOMParser;
const { parseOSF } = await import('../frontend/src/utils/osfParser.ts');

// Runs from wherever vite-node was started (usually frontend/), so anchor
// every path to the repo root.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = process.argv[2] || join(repoRoot, 'test-script/output/osf-browser-check');
const sampleDir = join(repoRoot, 'test-script/samples');
mkdirSync(join(outDir, 'xml'), { recursive: true });

/** Every corpus file, reduced to the document.xml the parser actually reads. */
function collect(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collect(path);
    return ['.fadein', '.osf'].includes(extname(entry.name).toLowerCase()) ? [path] : [];
  });
}

const expected = [];
for (const path of collect(sampleDir).sort()) {
  const buf = readFileSync(path);
  let xml;
  if (extname(path).toLowerCase() === '.fadein') {
    const zip = await JSZip.loadAsync(buf);
    const entry = zip.file('document.xml') || zip.file(/(^|\/)document\.xml$/i)[0];
    xml = await entry.async('string');
  } else {
    xml = buf.toString('utf8');
  }

  const name = basename(path);
  writeFileSync(join(outDir, 'xml', `${name}.xml`), xml);
  const { doc, scriptTitle, warnings, documentFont } = parseOSF(xml);
  expected.push({ name, title: scriptTitle, warnings, documentFont, doc });
}
writeFileSync(join(outDir, 'expected.json'), JSON.stringify(expected));

await build({
  stdin: {
    contents: `
      import { parseOSF } from '${repoRoot}/frontend/src/utils/osfParser.ts';
      window.parseOSF = parseOSF;
    `,
    resolveDir: repoRoot,
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  outfile: join(outDir, 'parser.js'),
  logLevel: 'warning',
});

writeFileSync(
  join(outDir, 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>OSF parser — browser DOM check</title>
<style>body{font:13px ui-monospace,monospace;padding:16px} .fail{color:#b00} .pass{color:#070}</style>
<h1>OSF parser under the browser's own DOMParser</h1>
<pre id="out">running…</pre>
<script src="parser.js"></script>
<script>
(async () => {
  const expected = await (await fetch('expected.json')).json();
  const lines = [];
  let failed = 0;
  for (const want of expected) {
    const xml = await (await fetch('xml/' + encodeURIComponent(want.name) + '.xml')).text();
    let got;
    try {
      got = window.parseOSF(xml);
    } catch (err) {
      failed++; lines.push('<span class="fail">THREW ' + want.name + ': ' + err.message + '</span>'); continue;
    }
    const same = JSON.stringify(got.doc) === JSON.stringify(want.doc)
      && got.scriptTitle === want.title
      && JSON.stringify(got.warnings) === JSON.stringify(want.warnings)
      && JSON.stringify(got.documentFont) === JSON.stringify(want.documentFont);
    if (!same) {
      failed++;
      const g = JSON.stringify(got.doc), w = JSON.stringify(want.doc);
      let i = 0; while (i < g.length && g[i] === w[i]) i++;
      lines.push('<span class="fail">DIFFERS ' + want.name + ' at char ' + i + ': browser ' +
        JSON.stringify(g.slice(i - 60, i + 60)) + ' vs node ' + JSON.stringify(w.slice(i - 60, i + 60)) + '</span>');
    } else {
      lines.push('<span class="pass">PASS ' + want.name + '</span>');
    }
  }
  lines.push('');
  lines.push(failed === 0
    ? '<span class="pass">RESULT: all ' + expected.length + ' files parse identically in the browser.</span>'
    : '<span class="fail">RESULT: ' + failed + ' of ' + expected.length + ' differ.</span>');
  document.getElementById('out').innerHTML = lines.join('\\n');
  console.log('OSF browser check:', failed === 0 ? 'ALL PASS' : failed + ' FAILED');
})();
</script>`,
);

console.log(`Staged ${expected.length} files in ${outDir}`);
console.log(`Serve it:  python3 -m http.server -d ${outDir} 8099`);
