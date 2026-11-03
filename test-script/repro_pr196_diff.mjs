// Re-checks the PR #196 review cases against a bundled scriptDiff.
// Usage: node test-script/repro_pr196_diff.mjs <path/to/bundled-scriptDiff.mjs>
import { pathToFileURL } from 'node:url';

const target = process.argv[2];
if (!target) { console.error('usage: repro_pr196_diff.mjs <bundled scriptDiff.mjs>'); process.exit(2); }
let computeScriptDiff;
try {
  ({ computeScriptDiff } = await import(pathToFileURL(target).href));
} catch (err) {
  console.error(`Could not load ${target}: ${err.message}`); process.exit(1);
}

const WORDS = 'the a door opens slowly she turns away he waits in silence rain falls on glass light flickers somewhere below footsteps echo through hallway old man coughs'.split(' ');
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const sentence = (n) => Array.from({ length: n }, () => WORDS[Math.floor(rnd() * WORDS.length)]).join(' ');
const block = (type, text) => ({ type, content: [{ type: 'text', text }] });
const doc = (content) => ({ type: 'doc', content });

function script(blocks) {
  const out = [];
  for (let s = 0; out.length < blocks; s++) {
    out.push(block('sceneHeading', `INT. ROOM ${s} - DAY`));
    out.push(block('action', `${sentence(40)} ${s}`));
    for (let d = 0; d < 4; d++) {
      out.push(block('character', `PERSON ${d}`));
      out.push(block('dialogue', `${sentence(15)} ${s}.${d}`));
    }
  }
  return doc(out.slice(0, blocks));
}

let failures = 0;
function check(label, a, b, expect) {
  let res;
  const t0 = performance.now();
  try { res = computeScriptDiff(a, b); } catch (err) { console.log(`FAIL ${label}: threw ${err.message}`); failures++; return; }
  const ms = performance.now() - t0;
  const s = res.summary;
  const got = { add: s.totalAdded, del: s.totalDeleted, mod: s.totalModified, mov: s.totalMoved };
  const bad = Object.entries(expect).filter(([k, v]) => got[k] !== v);
  if (bad.length) failures++;
  console.log(`${bad.length ? 'FAIL' : 'ok  '} ${label.padEnd(46)} ${ms.toFixed(0).padStart(5)} ms  ${JSON.stringify(got)}${bad.length ? '  expected ' + JSON.stringify(expect) : ''}`);
  return res;
}

const N = 4100;
const base = script(N);

// Review case 1: two distant edits above the alignment cap.
{ const b = structuredClone(base); b.content[5].content[0].text += ' x'; b.content[N - 5].content[0].text += ' y';
  check('4100 blocks: edits near start and end', base, b, { add: 0, del: 0, mod: 2, mov: 0 }); }
// Review case 2: one inserted line plus one edit.
{ const b = structuredClone(base); b.content.splice(10, 0, block('action', 'A brand new line nobody wrote before.')); b.content[N - 5].content[0].text += ' y';
  check('4100 blocks: one insert + one edit', base, b, { add: 1, del: 0, mod: 1, mov: 0 }); }
// Larger: 8000 blocks, edits at both ends (linear memory path).
{ const big = script(8000); const b = structuredClone(big); b.content[3].content[0].text += ' x'; b.content[7990].content[0].text += ' y';
  check('8000 blocks: edits near start and end', big, b, { add: 0, del: 0, mod: 2, mov: 0 }); }

// Repeated cue is not a move.
{
  const a = doc([block('sceneHeading', 'INT. A - DAY'), block('character', 'JOHN'), block('dialogue', 'I was never here.'),
    block('sceneHeading', 'INT. B - NIGHT'), block('action', 'Quiet room.')]);
  const b = doc([block('sceneHeading', 'INT. A - DAY'),
    block('sceneHeading', 'INT. B - NIGHT'), block('action', 'Quiet room.'), block('character', 'JOHN'), block('dialogue', 'Completely different words entirely.')]);
  check('repeated JOHN cue in another scene', a, b, { mov: 0 });
}
// Unique dialogue line moved between scenes IS a move.
{
  const line = 'The ledger is in the safe behind the painting.';
  const a = doc([block('sceneHeading', 'INT. A - DAY'), block('action', line), block('sceneHeading', 'INT. B - NIGHT'), block('action', 'Quiet room.')]);
  const b = doc([block('sceneHeading', 'INT. A - DAY'), block('sceneHeading', 'INT. B - NIGHT'), block('action', 'Quiet room.'), block('action', line)]);
  check('unique action line moved to another scene', a, b, { mov: 1 });
}
// V.O. cues with different names are not a rewrite.
{
  const a = doc([block('sceneHeading', 'INT. A - DAY'), block('character', 'MARY (V.O.)'), block('dialogue', 'Hello there friend.')]);
  const b = doc([block('sceneHeading', 'INT. A - DAY'), block('character', 'JOHN (V.O.)'), block('dialogue', 'Hello there friend.')]);
  check('MARY (V.O.) -> JOHN (V.O.) not paired', a, b, { mod: 0, add: 1, del: 1 });
}
// Headings sharing only INT./DAY are not paired; a changed time on the same location is.
{
  const a = doc([block('sceneHeading', 'INT. KITCHEN - DAY'), block('action', 'x y z.')]);
  const b = doc([block('sceneHeading', 'INT. GARAGE - DAY'), block('action', 'x y z.')]);
  check('KITCHEN - DAY -> GARAGE - DAY not paired', a, b, { mod: 0, add: 1, del: 1 });
  const c = doc([block('sceneHeading', 'INT. KITCHEN - NIGHT'), block('action', 'x y z.')]);
  check('KITCHEN - DAY -> KITCHEN - NIGHT paired', a, c, { mod: 1, add: 0, del: 0 });
}
// Identical text is never "modified".
{
  const a = script(300); const b = structuredClone(a); b.content.splice(150, 1);
  const res = check('300 blocks, one deletion', a, b, { del: 1, mod: 0 });
  const idMods = (res?.blocks ?? res?.rows ?? []).filter((r) => r.kind === 'modified' && r.oldText === r.newText).length;
  if (idMods) { failures++; console.log(`FAIL identical-text modified rows: ${idMods}`); }
}

// A deletion that followed a moved block stays in its own scene, not at the
// moved block's new place.
{
  const a = doc([block('sceneHeading', 'EXT. STREET - NIGHT'), block('action', 'She turns down an alley and listens hard.'),
    block('action', 'Then: FOOTSTEPS behind her.'), block('action', 'Sarah does not run.'),
    block('sceneHeading', 'INT. CAFE - DAY'), block('action', 'Cups clatter.')]);
  const b = doc([block('sceneHeading', 'EXT. STREET - NIGHT'), block('action', 'Sarah does not run.'),
    block('sceneHeading', 'INT. CAFE - DAY'), block('action', 'Cups clatter.'), block('action', 'She turns down an alley and listens hard.')]);
  const res = check('deletion after a moved block', a, b, { del: 1, mov: 1 });
  const rows = res?.blocks ?? [];
  const del = rows.findIndex((r) => r.type === 'deleted');
  const cafe = rows.findIndex((r) => r.elementType === 'sceneHeading' && /CAFE/.test(r.newText ?? r.oldText ?? ''));
  if (del < 0 || cafe < 0 || del > cafe) {
    failures++;
    console.log(`FAIL deletion shown at row ${del}, after the CAFE heading at row ${cafe} (should be in STREET)`);
  } else {
    console.log('ok   deletion stays in its own scene');
  }
}

console.log(failures ? `\n${failures} failing case(s)` : '\nall cases pass');
process.exit(failures ? 1 : 0);
