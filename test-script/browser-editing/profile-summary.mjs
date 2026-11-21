/** Summarize a Chrome .cpuprofile. Inclusive entries overlap; do not sum them. */
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

const file = process.argv[2];
if (!file) throw new Error('Usage: node profile-summary.mjs FILE.cpuprofile');
const bytes = fs.readFileSync(file);
const profile = JSON.parse(file.endsWith('.gz') ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8'));
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parents = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
const self = new Map(), inclusive = new Map();
const label = node => {
  const frame = node.callFrame;
  const source = frame.url ? frame.url.split('/').at(-1) : '(native)';
  return `${frame.functionName || '(anonymous)'} @ ${source}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
};
for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
  const id = profile.samples[i], ms = profile.timeDeltas[i] / 1000;
  const key = label(nodes.get(id));
  self.set(key, (self.get(key) ?? 0) + ms);
  const seen = new Set();
  for (let current = id; current !== undefined; current = parents.get(current)) {
    const key = label(nodes.get(current));
    if (!seen.has(key)) inclusive.set(key, (inclusive.get(key) ?? 0) + ms);
    seen.add(key);
  }
}
const sorted = counts => [...counts].sort((a, b) => b[1] - a[1])
  .map(([frame, ms]) => ({ frame, ms: Math.round(ms * 10) / 10 }));
console.log(JSON.stringify({
  durationMs: (profile.endTime - profile.startTime) / 1000,
  samples: profile.samples?.length ?? 0,
  self: sorted(self).slice(0, 25),
  inclusive: sorted(inclusive).slice(0, 30),
  paginationAndPersistence: sorted(inclusive).filter(entry => /buildDecorations|computeBreaks|caretVisible|saveScript|capture|setItem/.test(entry.frame)),
}, null, 2));
