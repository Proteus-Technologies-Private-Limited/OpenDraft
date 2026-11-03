// Times computeScriptDiff on synthetic feature-length scripts.
// Usage: node --experimental-strip-types test-script/bench_script_diff.mjs <path/to/scriptDiff.ts>
import { pathToFileURL } from 'node:url';

const target = process.argv[2];
if (!target) { console.error('usage: bench_script_diff.mjs <scriptDiff.ts>'); process.exit(2); }
let computeScriptDiff;
try {
  ({ computeScriptDiff } = await import(pathToFileURL(target).href));
} catch (err) {
  console.error(`Could not load ${target}: ${err.message}`); process.exit(1);
}

const WORDS = 'the a door opens slowly she turns away he waits in silence rain falls on glass light flickers somewhere below footsteps echo through hallway old man coughs'.split(' ');
let seed = 1;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const sentence = (n) => Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ');
const block = (type, text) => ({ type, content: [{ type: 'text', text }] });

function script(blocks, tag = '') {
  const out = [];
  for (let s = 0; out.length < blocks; s++) {
    out.push(block('sceneHeading', `INT. ROOM ${s}${tag} - DAY`));
    out.push(block('action', `${sentence(40)} ${s}${tag}`));
    for (let d = 0; d < 4; d++) {
      out.push(block('character', `PERSON ${d}`));
      out.push(block('dialogue', `${sentence(15)} ${s}.${d}${tag}`));
    }
  }
  return { type: 'doc', content: out.slice(0, blocks) };
}
const clone = (d) => structuredClone(d);

function run(label, a, b) {
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  let peak = before;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 1);
  const t0 = performance.now();
  let res;
  try { res = computeScriptDiff(a, b); } catch (err) { clearInterval(timer); console.log(`${label}: THREW ${err.message}`); return; }
  const ms = performance.now() - t0;
  clearInterval(timer);
  peak = Math.max(peak, process.memoryUsage().heapUsed);
  const s = res.summary;
  console.log(`${label.padEnd(44)} ${ms.toFixed(0).padStart(6)} ms  heap +${((peak - before) / 1e6).toFixed(0).padStart(4)} MB  add ${s.totalAdded} del ${s.totalDeleted} mod ${s.totalModified} mov ${s.totalMoved}`);
}

const N = 3900; // just under the PR's 16M-cell alignment cap
const base = script(N);

// 1. Two small edits far apart: alignment table spans the whole script.
{ const b = clone(base); b.content[5].content[0].text += ' x'; b.content[N - 5].content[0].text += ' y'; run('1 two edits, start+end', base, b); }
// 2. One scene rewritten (50 blocks replaced by 60 different ones).
{ const b = clone(base); const fresh = script(60, 'r').content; b.content.splice(1000, 50, ...fresh); run('2 one scene rewritten', base, b); }
// 3. Act rewritten: 500 blocks replaced by 500 with a different element order.
{ const b = clone(base); const fresh = script(500, 'q').content.reverse(); b.content.splice(1000, 500, ...fresh); run('3 500-block act rewritten', base, b); }
// 4. Large move: 1500 blocks cut from the front and pasted at the end.
{ const b = clone(base); const cut = b.content.splice(100, 1500); b.content.push(...cut); run('4 1500 blocks moved to the end', base, b); }
// 5. Whole script replaced by another one.
{ run('5 entirely different script', base, script(N, 'z')); }

// 6. Worst case for rewrite pairing: a 500x500 run (the cap) where no pair
//    shares half its words, with long action paragraphs, so every removed
//    paragraph is scored against every added one.
{
  const WORDS2 = 'zebra quartz violin meadow copper falcon harbor ember lantern orchid saddle thistle walnut cobalt ripple sparrow tundra velvet'.split(' ');
  const other = (n) => Array.from({ length: n }, () => WORDS2[Math.floor(rnd() * WORDS2.length)]).join(' ');
  const b = clone(base);
  const fresh = [];
  for (let k = 0; k < 500; k++) fresh.push(k % 2 ? block('action', other(60)) : block('dialogue', other(60)));
  b.content.splice(1000, 500, ...fresh.slice(0, 499));
  run('6 500-block run, nothing pairs (60 words)', base, b);
}
// 7. Unbounded move scan: a differently shaped script, so nothing aligns and
//    every removed block is searched for among every added one.
{
  const b = { type: 'doc', content: script(N, 'w').content.filter((n) => n.type !== 'character') };
  run('7 different shape, nothing aligns', base, b);
}

// 8. Exactly 500x500 scores at the pairing cap, with disjoint vocabularies.
// Different element types prevent the equal-shape positional fast path.
{
  const oldWords = 'candle river mountain forest window paper garden shadow'.split(' ');
  const newWords = 'quartz zebra violin copper falcon harbor orchid saddle'.split(' ');
  const paragraphs = (words, type, tag) => ({
    type: 'doc',
    content: Array.from({ length: 500 }, (_, i) => {
      const text = Array.from({ length: 60 }, (_, j) => words[(i + j) % words.length]).join(' ');
      return block(type, `${text} ${tag}${i}`);
    }),
  });
  run('8 exact 500x500, disjoint 60-word blocks',
    paragraphs(oldWords, 'action', 'old'), paragraphs(newWords, 'general', 'new'));
}
