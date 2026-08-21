/**
 * Cost of one crash-recovery capture, as useRecoverySnapshot performs it:
 *   buildSaveContent() -> editor.getJSON() (deep copy of the PM doc)
 *   JSON.stringify(content)        // the change-detection compare
 *   JSON.stringify(snapshot)       // inside writeRecoverySnapshot
 *   string compare against the previous snapshot
 * localStorage.setItem is not measurable here and is reported separately.
 */

const LOREM = 'The room is quiet except for the hum of the refrigerator and the slow tick of a clock nobody has bothered to reset since the power went out.';
const LINE = 'I told you this was going to happen. I told you and you smiled at me like I was making it up.';

function screenplay(pages) {
  // ~55 lines/page; a mixed feature averages ~9 blocks per page.
  const blocks = [];
  const scenes = Math.round(pages / 2.5);
  const perScene = Math.round((pages * 9) / scenes);
  for (let s = 0; s < scenes; s++) {
    blocks.push({
      type: 'sceneHeading',
      attrs: { sceneNumber: String(s + 1), locked: false, synopsis: '', sceneColor: '', timingOverride: null, sequenceId: null },
      content: [{ type: 'text', text: `INT. APARTMENT ${s} - NIGHT` }],
    });
    for (let i = 0; i < perScene; i++) {
      if (i % 3 === 0) {
        blocks.push({ type: 'action', content: [{ type: 'text', text: LOREM.slice(0, 60 + ((i * 17) % 80)) }] });
      } else {
        blocks.push({ type: 'character', content: [{ type: 'text', text: i % 2 ? 'MARGARET' : 'DEV' }] });
        blocks.push({ type: 'dialogue', content: [{ type: 'text', text: LINE.slice(0, 40 + ((i * 13) % 60)) }] });
      }
    }
  }
  return { type: 'doc', content: blocks };
}

function metadata(scenes) {
  const beats = Array.from({ length: scenes }, (_, i) => ({
    id: `beat-${i}`, title: `Beat ${i}`, description: LOREM, column: i % 4, color: '#88aaff', order: i,
  }));
  const notes = Array.from({ length: 120 }, (_, i) => ({
    id: `n-${i}`, text: LOREM, author: 'Kandarp', createdAt: 1700000000000 + i, resolved: false,
  }));
  return {
    _notes: notes, _generalNotes: LOREM.repeat(6), _tags: [], _tagCategories: [],
    _characterProfiles: Array.from({ length: 25 }, (_, i) => ({ name: `CHAR ${i}`, bio: LOREM, arc: LOREM })),
    _characterRelationships: [], _beats: beats, _beatColumns: ['Act I', 'Act IIa', 'Act IIb', 'Act III'],
    _beatArrangeMode: 'column', _templateId: 'screenplay', _ignoredWords: [], _ignoredOnce: [],
    _customDictWords: [], _enabledGlobalDicts: ['en_US'], _projectDictEnabled: true,
    _enabledLanguages: ['en'], _ignoredGrammarRules: [], _ignoredGrammarOnce: [],
    _spellCheckEnabled: true, _grammarCheckEnabled: true, _sceneNumbersVisible: true,
    _sceneNumbersLocked: false, _pageLayout: { paper: 'letter', margins: {} }, _sceneHeadingSpaceBefore: 2,
  };
}

function deepCopy(node) { // stand-in for ProseMirror Node.toJSON()
  if (Array.isArray(node)) return node.map(deepCopy);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = deepCopy(node[k]);
    return out;
  }
  return node;
}

function bench(label, fn, runs = 30) {
  fn(); fn();
  const t = [];
  for (let i = 0; i < runs; i++) { const s = performance.now(); fn(); t.push(performance.now() - s); }
  t.sort((a, b) => a - b);
  return { label, median: t[Math.floor(runs / 2)], p95: t[Math.floor(runs * 0.95)] };
}

for (const pages of [60, 120, 200, 350]) {
  const doc = screenplay(pages);
  const meta = metadata(Math.round(pages / 2.5));
  const blocks = doc.content.length;

  const build = () => ({ ...deepCopy(doc), ...meta });
  const content = build();
  const json = JSON.stringify(content);
  const snapshot = { version: 1, sessionId: 'x', savedAt: Date.now(), title: 'T', projectId: 'p', scriptId: 's', content };
  const serialized = JSON.stringify(snapshot);
  const prev = json.slice(0, -3) + 'zz}'; // differs only at the end: worst-case compare

  const rBuild = bench('getJSON + spread', build);
  const rStr1 = bench('stringify(content)', () => JSON.stringify(content));
  const rStr2 = bench('stringify(snapshot)', () => JSON.stringify(snapshot));
  const rCmp = bench('compare vs previous', () => json === prev, 200);

  const total = rBuild.median + rStr1.median + rStr2.median + rCmp.median;
  console.log(
    `\n${pages} pages  (${blocks} blocks, doc+meta = ${(serialized.length / 1024).toFixed(0)} KB` +
    `${serialized.length > 3_500_000 ? '  *** OVER THE 3.5MB LIMIT — NOT SNAPSHOTTED ***' : ''})`,
  );
  for (const r of [rBuild, rStr1, rStr2, rCmp]) {
    console.log(`   ${r.label.padEnd(22)} ${r.median.toFixed(2).padStart(7)} ms   (p95 ${r.p95.toFixed(2)})`);
  }
  console.log(`   ${'JS work per capture'.padEnd(22)} ${total.toFixed(2).padStart(7)} ms`);
}
