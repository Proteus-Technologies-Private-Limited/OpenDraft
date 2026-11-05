#!/usr/bin/env node
/**
 * English fidelity: the English UI must not change by one character.
 *
 * For every source file changed since HEAD, takes the user-facing text that the
 * diff REMOVED (JSX text, string literals, attribute values) and checks that it
 * now exists verbatim in a locales/en/*.json value — whole, or as the fixed
 * parts of a value with {{placeholders}}/<tags> in it. What it cannot match is
 * printed for a human to look at: a typo while extracting, text that was
 * dropped, or something that was never UI text at all.
 *
 *   node test-script/i18n_en_fidelity.mjs             # summary + unmatched
 *   node test-script/i18n_en_fidelity.mjs --strict    # exit 1 if any unmatched
 *   node test-script/i18n_en_fidelity.mjs --file frontend/src/components/Toast.tsx
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const REPO = process.cwd();
const EN_DIR = path.join(REPO, 'frontend/src/locales/en');

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rarr: '→', larr: '←', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', times: '×', middot: '·', bull: '•', copy: '©', check: '✓' };
const norm = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m)
  .replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, ' ')
  .replace(/\s+/g, ' ').trim();

function flat(o, out = []) {
  for (const v of Object.values(o)) typeof v === 'string' ? out.push(v) : flat(v, out);
  return out;
}
const values = fs.readdirSync(EN_DIR).filter((f) => f.endsWith('.json')).flatMap((f) => flat(JSON.parse(fs.readFileSync(path.join(EN_DIR, f), 'utf8'))));
const normValues = values.map(norm);
const exact = new Set(normValues);
// A value's fixed text, with placeholders and tags cut out, as pieces.
const pieces = normValues.flatMap((v) => v.split(/\{\{[^}]*\}\}|<\/?[a-zA-Z0-9]+[^>]*>/).map((p) => p.trim()).filter((p) => p.length >= 3));
const pieceSet = new Set(pieces);
const haystack = normValues.join('\u0000');

// `${expr}` in a template literal is a placeholder in the JSON: check the fixed text between them.
const covered = (s) => {
  if (exact.has(s) || pieceSet.has(s) || haystack.includes(s)) return true;
  if (!s.includes('${')) return false;
  const fixed = s.split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/).map((p) => p.trim()).filter((p) => p.length >= 3 && /\p{L}{2,}/u.test(p));
  return fixed.length > 0 && fixed.every((p) => haystack.includes(p));
};

// Candidate user-facing strings in one removed source line.
function candidates(line) {
  const out = new Set();
  const t = line.replace(/^-/, '');
  for (const m of t.matchAll(/>([^<>{}]+)</g)) out.add(m[1]);                       // <b>text</b>
  for (const m of t.matchAll(/(?:^|[>}])\s*([A-Za-z][^<>{}=;]*[A-Za-z.!?:…])\s*(?:$|[<{])/g)) out.add(m[1]); // bare JSX text line
  for (const m of t.matchAll(/(?:title|placeholder|aria-label|alt|label|description|tooltip|hint|message|text)\s*[=:]\s*\{?\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) out.add(m[2]);
  for (const m of t.matchAll(/(['"`])((?:\\.|(?!\1).){4,})\1/g)) out.add(m[2]);
  return [...out].map(norm).filter((s) =>
    /\p{L}{3,}/u.test(s) && /\s|^[A-Z]/.test(s) && !/^[\w./:#@%+-]+$/.test(s) // skip ids, paths, classnames-like tokens
    && !/^(use |import |export |return |const |let |var |function |\/\/|\/\*|\*)/.test(s)
    && !/[;{}]\s*$/.test(s) && !/=>|===|!==|&&|\|\|/.test(s));
}

const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'frontend/src'], { encoding: 'utf8' })
  .split('\n').filter((f) => /\.tsx?$/.test(f) && !/\/(locales|i18n)\//.test(f) && !/\.test\./.test(f) && fs.existsSync(f));
const only = opt('--file');
const files = only ? [only] : changed;

let total = 0, missing = 0;
const report = [];
for (const f of files) {
  const diff = execFileSync('git', ['diff', '-U0', 'HEAD', '--', f], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  // Text that is still in the file after the change was not removed from the UI.
  const after = norm(fs.readFileSync(f, 'utf8'));
  const miss = new Set();
  for (const l of removed) for (const c of candidates(l)) {
    total++;
    if (covered(c) || after.includes(c)) continue;
    miss.add(c);
  }
  missing += miss.size;
  if (miss.size) report.push([f, [...miss]]);
}
for (const [f, list] of report) {
  console.log(`\n${f}  (${list.length})`);
  for (const s of list.slice(0, only ? 999 : 12)) console.log('   ✗', s.slice(0, 110));
  if (!only && list.length > 12) console.log(`   … ${list.length - 12} more`);
}
console.log(`\n${files.length} changed file(s); ${total} removed text fragment(s) checked; ${missing} not found in locales/en`);
if (args.includes('--strict') && missing) process.exit(1);
