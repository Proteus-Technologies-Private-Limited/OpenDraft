/*
 * Round-trip check of the Fade In / Open Screenplay Format *writer* against a
 * corpus of real files.
 *
 * The unit tests write documents this exporter built itself, which proves the
 * two halves agree but says nothing about files written by Fade In. This reads
 * the real ones: parse → export → parse, and compares the two documents. A
 * mapping this exporter gets wrong shows up as an element that changed type or
 * text between the passes.
 *
 *   npx vite-node test-script/osf-roundtrip.mjs [dir-or-file ...]
 *
 * Defaults to test-script/samples.  Pass --verbose to list every difference.
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

const { parseOSF, parseFadeIn } = await import('../frontend/src/utils/osfParser.ts');
const { exportOSF, exportFadeIn } = await import('../frontend/src/utils/osfExporter.ts');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const targets = args.filter((a) => !a.startsWith('--'));
const roots = targets.length > 0 ? targets : ['test-script/samples'];

const READABLE = new Set(['.fadein', '.osf']);
function collect(path) {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).flatMap((entry) => collect(join(path, entry)));
  }
  return READABLE.has(extname(path).toLowerCase()) ? [path] : [];
}

/** Flatten to one comparable line per element: "type\ttext". */
function outline(nodes, into = []) {
  for (const node of nodes) {
    if (node.type === 'dualDialogue' || node.type === 'dualDialogueColumn') {
      into.push(node.type);
      outline(node.content ?? [], into);
      continue;
    }
    into.push(`${node.type}\t${text(node)}`);
  }
  return into;
}

function text(node) {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(text).join('');
}

/** Title-page fields, which live in attributes rather than in the text. */
function titlePage(doc) {
  const node = (doc.content ?? []).find((n) => n.type === 'titlePage');
  if (!node) return '';
  return Object.entries(node.attrs ?? {})
    .filter(([, v]) => typeof v === 'string' && v.trim() !== '')
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('|');
}

const files = roots.flatMap(collect).sort();
if (files.length === 0) {
  console.error(`No .fadein/.osf files under: ${roots.join(', ')}`);
  process.exit(1);
}

let failures = 0;

for (const file of files) {
  const name = basename(file);
  try {
    const isArchive = extname(file).toLowerCase() === '.fadein';
    const bytes = readFileSync(file);
    const first = isArchive
      ? await parseFadeIn(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      : parseOSF(bytes.toString('utf8'));

    // Written back out the way OpenDraft would save this file...
    const rewritten = isArchive
      ? await exportFadeIn(first.doc)
      : exportOSF(first.doc);

    // ...and read again, with no memory of the first pass.
    const second = isArchive
      ? await parseFadeIn(
          rewritten.buffer.slice(rewritten.byteOffset, rewritten.byteOffset + rewritten.byteLength),
        )
      : parseOSF(rewritten);

    const before = outline(first.doc.content ?? []);
    const after = outline(second.doc.content ?? []);
    const diffs = [];

    if (before.length !== after.length) {
      diffs.push(`element count ${before.length} → ${after.length}`);
    }
    for (let i = 0; i < Math.min(before.length, after.length); i++) {
      if (before[i] !== after[i]) {
        diffs.push(`#${i}: ${JSON.stringify(before[i])} → ${JSON.stringify(after[i])}`);
      }
    }
    if (titlePage(first.doc) !== titlePage(second.doc)) {
      diffs.push(`title page: ${titlePage(first.doc)} → ${titlePage(second.doc)}`);
    }

    if (diffs.length === 0) {
      console.log(`✓ ${name}  (${before.length} elements)`);
    } else {
      failures++;
      console.log(`✗ ${name}  (${diffs.length} difference${diffs.length === 1 ? '' : 's'})`);
      for (const d of (verbose ? diffs : diffs.slice(0, 5))) console.log(`    ${d}`);
      if (!verbose && diffs.length > 5) console.log(`    …and ${diffs.length - 5} more (--verbose)`);
    }
  } catch (err) {
    failures++;
    console.log(`✗ ${name}  ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\n${files.length - failures}/${files.length} files round-tripped unchanged.`);
process.exit(failures === 0 ? 0 : 1);
