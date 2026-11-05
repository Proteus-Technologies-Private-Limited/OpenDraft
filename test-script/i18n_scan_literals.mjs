#!/usr/bin/env node
/**
 * Finds user-visible English still written into the UI code instead of being
 * looked up with t().
 *
 *   node test-script/i18n_scan_literals.mjs            # summary per file
 *   node test-script/i18n_scan_literals.mjs --all      # every hit
 *   node test-script/i18n_scan_literals.mjs --file frontend/src/components/Toast.tsx
 *   node test-script/i18n_scan_literals.mjs --max 0    # exit 1 if any hit (CI gate)
 *
 * What it flags (in .ts/.tsx under frontend/src, tests excluded):
 *   - JSX text with letters:           <button>Save</button>
 *   - string-literal UI attributes:    title="Save"  placeholder='…'  aria-label=…
 *   - the same attributes given as {'…'} or {`…`} without ${}
 *   - object properties such as { label: 'Save', title: '…' }
 *   - toast / confirm / alert calls with a literal string
 *
 * Opt out on purpose (brand names, font names, code samples, release notes):
 *   // i18n-ignore            on the line, or the line above
 *   i18n-ignore-start / i18n-ignore-end   around a block (also inside {/* … *​/})
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require(path.resolve('frontend/node_modules/typescript'));
const SKIP_DIRS = ['node_modules', 'locales', 'test', '__snapshots__', 'i18n'];

const ROOT = path.resolve('frontend/src');
const ATTRS = new Set([
  'title', 'placeholder', 'aria-label', 'aria-description', 'alt', 'label',
  'tooltip', 'description', 'helperText', 'text', 'heading', 'subtitle', 'hint',
  'emptyText', 'emptyLabel', 'confirmLabel', 'cancelLabel', 'message',
]);
const CALLS = new Set(['showToast', 'confirm', 'alert', 'prompt']);
// Object properties that carry words a writer reads: { label: 'Save' }.
const PROPS = new Set(['label', 'title', 'description', 'tooltip', 'placeholder', 'hint', 'heading', 'subtitle', 'message', 'text', 'tip', 'helperText', 'emptyText', 'confirmLabel']);

// Files whose English is data or runs before translation can: reported as
// intentional, not as hits. Anything else must use t() or carry an i18n-ignore.
const DATA_FILES = [
  // Built-in template definitions: `name`/`label` are stored in documents and
  // compared by value. Components display them through utils/templateLabels.ts.
  /\/stores\/templates\//, /\/stores\/industryStandardTemplate\.ts$/, /\/stores\/formattingTypes\.ts$/,
  // The "failed to start" overlay: shown when the app could not even start, so
  // translations may not have loaded.
  /\/main\.tsx$/,
];

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.includes(e.name)) walk(p, out); }
    else if (/\.tsx?$/.test(e.name) && !/\.(test|d)\./.test(e.name)) out.push(p);
  }
  return out;
}

// Text that is not a sentence a translator needs: symbols, entities, single
// characters, numbers, code-ish tokens.
function looksTranslatable(raw) {
  const s = raw.replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return false;
  const letters = (s.match(/\p{L}/gu) || []).length;
  if (letters < 2) return false;
  if (/^[\w.\-/:#@%+]+$/.test(s) && !/[a-z]{3,}\s/i.test(s) && /[\d_./:#@]/.test(s)) return false; // ids, paths, versions
  return true;
}

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const ignored = new Set();
  let inBlock = false;
  lines.forEach((l, i) => {
    if (/i18n-ignore-start/.test(l)) inBlock = true;
    if (inBlock || /i18n-ignore(?!-)/.test(l)) { ignored.add(i); if (/i18n-ignore(?!-)/.test(l) && !inBlock) ignored.add(i + 1); }
    if (/i18n-ignore-end/.test(l)) inBlock = false;
  });
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  const add = (node, kind, text) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    if (ignored.has(line)) return;
    hits.push({ file: path.relative(process.cwd(), file), line: line + 1, kind, text: text.replace(/\s+/g, ' ').trim().slice(0, 90) });
  };
  const literalOf = (init) => {
    if (!init) return null;
    if (ts.isStringLiteral(init)) return init.text;
    if (ts.isJsxExpression(init) && init.expression) {
      const e = init.expression;
      if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
    }
    return null;
  };
  const visit = (n) => {
    if (ts.isJsxText(n)) {
      if (looksTranslatable(n.text)) add(n, 'text', n.text);
    } else if (ts.isJsxAttribute(n) && ATTRS.has(n.name.getText(sf))) {
      const v = literalOf(n.initializer);
      if (v && looksTranslatable(v)) add(n, 'attr:' + n.name.getText(sf), v);
    } else if (ts.isPropertyAssignment(n) && n.name && (ts.isIdentifier(n.name) || ts.isStringLiteral(n.name)) && PROPS.has(n.name.text)
      && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer)) && looksTranslatable(n.initializer.text)) {
      add(n, 'prop:' + n.name.text, n.initializer.text);
    } else if (ts.isCallExpression(n) && CALLS.has(n.expression.getText(sf))) {
      const a = n.arguments[0];
      if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) && looksTranslatable(a.text)) add(a, 'call:' + n.expression.getText(sf), a.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

const only = opt('--file');
const files = only ? [path.resolve(only)] : walk(ROOT).filter((f) => !DATA_FILES.some((re) => re.test(f)));
const all = files.flatMap(scan);
const byFile = new Map();
for (const h of all) byFile.set(h.file, (byFile.get(h.file) || 0) + 1);

if (flag('--all') || only) {
  for (const h of all) console.log(`${h.file}:${h.line}  [${h.kind}]  ${h.text}`);
  console.log('');
}
const rows = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
if (!only) for (const [f, c] of rows.slice(0, flag('--all') ? rows.length : 40)) console.log(String(c).padStart(5), f);
console.log(`\n${all.length} literal(s) in ${byFile.size} file(s) of ${files.length}`);
const max = opt('--max');
if (max !== undefined && all.length > Number(max)) process.exit(1);
