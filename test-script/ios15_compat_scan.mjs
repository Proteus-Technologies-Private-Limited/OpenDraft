// Scan the built frontend (frontend/dist/assets/*.js) for syntax and APIs that
// iOS 15's WKWebView (Safari 15.0) cannot run.
//
//   node test-script/ios15_compat_scan.mjs [distDir]
//
// Syntax problems (a parse error in Safari 15 kills the whole module graph,
// so React never mounts and index.html's 8 s "Loading timed out" fires):
//   - class static blocks            (Safari 16.4)
//   - regex lookbehind (?<= (?<!     (Safari 16.4)  — literal OR new RegExp("...")
//   - regex v flag                   (Safari 17)
// Runtime APIs missing before 15.4 (throw TypeError/ReferenceError when hit):
//   Array#at, findLast, findLastIndex, Object.hasOwn, structuredClone,
//   crypto.randomUUID, toSorted/toReversed/toSpliced, Object.groupBy,
//   Promise.withResolvers, AbortSignal.timeout, Array.fromAsync.
//
// Exits 1 when a chunk loaded at startup would not load on Safari 15 (CI runs
// this after `npm run build` in .github/workflows/test.yml).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(path.join(root, 'frontend', 'package.json'));
let acorn;
try {
  acorn = require('acorn');
} catch (e) {
  console.error('acorn not found under frontend/node_modules:', e.message);
  process.exit(2);
}
// Minimal full-tree walk (acorn-walk is not installed).
const walk = {
  full(node, cb) {
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n.type !== 'string') continue;
      cb(n);
      for (const k in n) {
        const v = n[k];
        if (k === 'regex' || !v || typeof v !== 'object') continue;
        if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') stack.push(c); }
        else if (typeof v.type === 'string') stack.push(v);
      }
    }
  },
};

const dist = path.resolve(process.argv[2] || path.join(root, 'frontend', 'dist', 'assets'));
if (!fs.existsSync(dist)) {
  console.error(`No build at ${dist} — run "cd frontend && npm run build" first.`);
  process.exit(2);
}

// Which chunks load at startup: the entry plus its static imports (modulepreload).
const html = fs.existsSync(path.join(dist, '..', 'index.html'))
  ? fs.readFileSync(path.join(dist, '..', 'index.html'), 'utf8') : '';
const startup = new Set([...html.matchAll(/assets\/([^"']+\.js)/g)].map((m) => m[1]));

const API_PATTERNS = [
  ['Array#at', /\.at\((?:-?\d|[a-zA-Z_$])/],
  ['findLast/findLastIndex', /\.findLast(?:Index)?\(/],
  ['Object.hasOwn', /Object\.hasOwn\(/],
  ['structuredClone', /(?<![.\w$])structuredClone\(/],
  ['crypto.randomUUID', /randomUUID\(/],
  ['toSorted/toReversed/toSpliced', /\.to(?:Sorted|Reversed|Spliced)\(/],
  ['Object.groupBy/Map.groupBy', /(?:Object|Map)\.groupBy\(/],
  ['Promise.withResolvers', /Promise\.withResolvers\(/],
  ['AbortSignal.timeout', /AbortSignal\.timeout\(/],
  ['Array.fromAsync', /Array\.fromAsync\(/],
];

const isLookbehind = (p) => /\(\?<[=!]/.test(p);
const results = [];
let parseFailures = 0;

for (const file of fs.readdirSync(dist).filter((f) => /\.m?js$/.test(f)).sort()) {
  const code = fs.readFileSync(path.join(dist, file), 'utf8');
  const hits = [];
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  } catch (e) {
    parseFailures += 1;
    hits.push(`PARSE FAILED in acorn: ${e.message}`);
  }
  if (ast) {
    walk.full(ast, (node) => {
      if (node.type === 'StaticBlock') hits.push(`SYNTAX class static block @${node.start}`);
      if (node.type === 'Literal' && node.regex) {
        if (isLookbehind(node.regex.pattern)) hits.push(`SYNTAX regex lookbehind /${node.regex.pattern.slice(0, 60)}/ @${node.start}`);
        if (node.regex.flags.includes('v')) hits.push(`SYNTAX regex v flag @${node.start}`);
      }
      if ((node.type === 'NewExpression' || node.type === 'CallExpression')
        && node.callee.type === 'Identifier' && node.callee.name === 'RegExp') {
        const a = node.arguments[0];
        const s = a && (a.type === 'Literal' ? a.value
          : a.type === 'TemplateLiteral' ? a.quasis.map((q) => q.value.cooked).join('…') : null);
        if (typeof s === 'string' && isLookbehind(s)) hits.push(`RUNTIME new RegExp lookbehind "${s.slice(0, 60)}" @${node.start}`);
      }
    });
  }
  for (const [name, re] of API_PATTERNS) {
    const n = (code.match(new RegExp(re.source, 'g')) || []).length;
    if (n) hits.push(`API ${name} ×${n}`);
  }
  if (hits.length) results.push({ file, startup: startup.has(file), size: code.length, hits });
}

results.sort((a, b) => Number(b.startup) - Number(a.startup));
for (const r of results) {
  console.log(`\n${r.startup ? '[STARTUP] ' : ''}${r.file} (${(r.size / 1024).toFixed(0)} KB)`);
  const seen = new Map();
  for (const h of r.hits) {
    const key = h.replace(/ @\d+$/, '');
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [h, n] of seen) console.log(`   ${h}${n > 1 ? `  (×${n})` : ''}`);
}
// Fails on what stops the app loading at all: Safari-15 syntax in a startup
// chunk, or a lookbehind there that esbuild turned into `new RegExp(...)` —
// that one throws instead of failing to parse, so if it sits at module top
// level the startup chunk still dies. Lazy chunks (Kokoro, Whisper) and the
// API list are reported only: the APIs are polyfilled in index.html.
const blocking = results.filter((r) => r.startup
  && r.hits.some((h) => h.startsWith('SYNTAX') || h.startsWith('RUNTIME') || h.startsWith('PARSE')));
console.log(`\n${results.length} chunk(s) with findings; ${blocking.length} startup chunk(s) that would not load on Safari 15; ${parseFailures} acorn parse failure(s).`);
for (const r of blocking) console.log(`  FAIL ${r.file}`);
process.exit(blocking.length ? 1 : 0);
