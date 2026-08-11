/*
 * Batch check of Fade In / Open Screenplay Format import against a corpus of
 * real files (vendor templates, the published OSF 1.2 / 2.0 / 2.1 / 4.0 sample
 * documents, and anything else dropped into the folder).
 *
 * Prints, per file, the element histogram and every warning, so a whole-file
 * mapping failure ("everything became Action") is visible at a glance.
 *
 *   npx vite-node test-script/osf-corpus.mjs [dir-or-file ...]
 *
 * Defaults to test-script/samples.  Pass --verbose to list every element.
 */
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
globalThis.DOMParser = DOMParser;
// The editor store reads localStorage/window at module scope (see
// frontend/src/test/setup.ts, which does the same for the unit suite).
const mem = new Map();
globalThis.localStorage = globalThis.sessionStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0,
};
globalThis.window = { location: { origin: 'http://localhost', href: 'http://localhost/', pathname: '/' },
  localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage,
  navigator: { userAgent: 'node' }, addEventListener() {}, removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };

const { parseScreenplayImport, extensionOf, isBinaryImportExtension } =
  await import('../frontend/src/utils/importScreenplay.ts');
const { default: JSZip } = await import('jszip');

/** The document.xml inside a .fadein archive, for the independent re-read. */
async function unzipDocument(buf) {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('document.xml') || zip.file(/(^|\/)document\.xml$/i)[0];
  return entry.async('string');
}

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const targets = args.filter((a) => !a.startsWith('--'));
const roots = targets.length > 0 ? targets : ['test-script/samples'];

const IMPORTABLE = new Set(['.fadein', '.osf']);
function collect(path) {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).flatMap((entry) => collect(join(path, entry)));
  }
  return IMPORTABLE.has(extname(path).toLowerCase()) ? [path] : [];
}

/** Walk the doc, counting element types (dual-dialogue columns included). */
function histogram(nodes, counts = new Map()) {
  for (const n of nodes) {
    if (n.type === 'dualDialogue' || n.type === 'dualDialogueColumn') {
      counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
      histogram(n.content ?? [], counts);
      continue;
    }
    counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  }
  return counts;
}

function textOf(node) {
  return (node.content ?? []).map((c) => (c.type === 'hardBreak' ? '⏎' : c.text ?? '')).join('');
}

/**
 * Body paragraphs in document order, dual-dialogue columns flattened back to
 * the run of paragraphs they were built from.
 */
function flatBody(nodes) {
  return nodes.flatMap((n) => {
    if (n.type === 'titlePage') return [];
    if (n.type === 'dualDialogue') return (n.content ?? []).flatMap((col) => col.content ?? []);
    return [n];
  });
}

/**
 * What the file itself says, read independently of the parser: the text of
 * every <paragraphs>/<para>, with 1.2's escaped pseudo-HTML stripped.  Used to
 * prove the import drops neither paragraphs nor characters.
 */
function sourceParagraphs(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  const version = parseInt(root.getAttribute('version') || '', 10);
  const legacy = !Number.isFinite(version) || version < 20;
  const paras = Array.from(root.getElementsByTagName('paragraphs'))
    .filter((el) => el.parentNode === root)
    .flatMap((el) => Array.from(el.getElementsByTagName('para')));

  const texts = paras.map((para) => {
    let text = Array.from(para.getElementsByTagName('text'))
      .map((t) => t.textContent || '')
      .join('')
      .replace(/\r\n?/g, '\n');
    if (legacy) {
      text = text.replace(/<(\/?)(b|i|u|s|strike|br|font|size|bgcolor)(?:="[^"]*")?>/gi, (_, close, tag) =>
        !close && tag.toLowerCase() === 'br' ? '\n' : '');
    }
    return text.replace(/\n/g, '⏎');
  });
  return texts;
}

/** Trailing empty paragraphs are dropped on import by design — ignore them. */
function withoutTrailingEmpties(texts) {
  const out = [...texts];
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out;
}

/** Compare imported text against the file's own, reporting the first mismatch. */
function checkFidelity(nodes, sourceTexts) {
  const got = withoutTrailingEmpties(
    flatBody(nodes).map((n) => {
      const text = textOf(n);
      // Parentheticals are bracketed on import; compare against the bare form.
      return n.type === 'parenthetical' ? text.replace(/^\((.*)\)$/s, '$1') : text;
    }),
  );
  const expected = withoutTrailingEmpties(sourceTexts);
  if (got.length !== expected.length) {
    return `paragraph count ${got.length}, file has ${expected.length}`;
  }
  for (let i = 0; i < got.length; i++) {
    if (got[i] !== expected[i]) {
      return `paragraph ${i + 1}: imported ${JSON.stringify(got[i])}, file has ${JSON.stringify(expected[i])}`;
    }
  }
  return null;
}

let failures = 0;
const files = roots.flatMap(collect).sort();
if (files.length === 0) console.error('No .fadein/.osf files found in', roots.join(', '));

for (const file of files) {
  const name = basename(file);
  const buf = readFileSync(file);
  const data = isBinaryImportExtension(extensionOf(name))
    ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    : buf.toString('utf8');

  console.log('\n' + '='.repeat(78));
  console.log(name);
  let r;
  try {
    r = await parseScreenplayImport(name, data);
  } catch (err) {
    failures++;
    console.log('  THREW:', err.message);
    continue;
  }

  const counts = [...histogram(r.doc.content)].sort((a, b) => b[1] - a[1]);
  const body = r.doc.content.filter((n) => n.type !== 'titlePage');
  const flat = body.length > 3 && new Set(body.map((n) => n.type)).size === 1;
  if (flat) failures++;

  console.log('  title    :', JSON.stringify(r.title));
  console.log('  elements :', counts.map(([t, c]) => `${t}×${c}`).join('  '));
  if (flat) console.log(`  ⚠ FLAT — every one of the ${body.length} body elements is "${body[0].type}"`);

  const xml = isBinaryImportExtension(extensionOf(name))
    ? await unzipDocument(buf)
    : buf.toString('utf8');
  const mismatch = checkFidelity(r.doc.content, sourceParagraphs(xml));
  if (mismatch) {
    failures++;
    console.log('  ⚠ TEXT   —', mismatch);
  } else {
    console.log('  text     : matches the file, paragraph for paragraph');
  }
  for (const w of r.warnings) console.log('  warn     :', w);
  if (verbose) {
    for (const n of body) console.log(`     ${n.type.padEnd(14)} ${JSON.stringify(textOf(n)).slice(0, 70)}`);
  }
}

console.log(`\n${files.length} file(s), ${failures} with a flat or failed import.`);
process.exit(failures > 0 ? 1 : 0);
