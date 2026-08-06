/*
 * End-to-end check of screenplay import.
 *
 * Runs a real file through the same dispatcher File > Import uses, and prints
 * the element tree it produces. Useful for eyeballing a .fadein/.osf/.fdx from
 * the wild; the unit suite (frontend/src/utils/*.test.ts) covers the rules.
 *
 *   npx vite-node test-script/import-e2e.mjs path/to/Script.fadein
 */
import { DOMParser } from '@xmldom/xmldom';
import { readFileSync } from 'node:fs';
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
const { parseScreenplayImport } = await import('../frontend/src/utils/importScreenplay.ts');

const path = process.argv[2];
if (!path) {
  console.error('usage: vite-node test-script/import-e2e.mjs <file>');
  process.exit(1);
}
const { extensionOf, isBinaryImportExtension } = await import('../frontend/src/utils/importScreenplay.ts');
const name = path.replace(/^.*[\\/]/, '');
const buf = readFileSync(path);
const data = isBinaryImportExtension(extensionOf(name))
  ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  : buf.toString('utf8');
const r = await parseScreenplayImport(name, data);

console.log('format :', r.formatLabel);
console.log('title  :', JSON.stringify(r.title));
console.log('warn   :', r.warnings);
console.log('nodes  :');
for (const n of r.doc.content) {
  const t = (n.content ?? []).map(c => c.text ?? '⏎').join('');
  console.log(`  ${n.type.padEnd(14)} ${JSON.stringify(t).slice(0, 62)}${n.attrs ? '  attrs=' + JSON.stringify(n.attrs).slice(0,80) : ''}`);
}
