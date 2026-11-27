/**
 * Three-way merge of two saved copies of one script, git style.
 *
 * `base` is the copy both sides last agreed on (what was last synced), `device`
 * is this device's copy and `cloud` the copy in OpenDraft Cloud. A change made
 * on only one side is taken automatically; the same change made on both is
 * taken once; different changes to the same place are a **conflict** the writer
 * resolves. Without a base, nothing can be told about who changed what, so every
 * difference is a conflict, and an item found on only one side is kept rather
 * than read as a deletion.
 *
 * The script body is merged paragraph by paragraph (top-level nodes compared
 * whole, attributes and marks included), the way git merges lines: both sides
 * are aligned against the base, regions where only one side differs from the
 * base are taken from it, and regions where both differ are split further —
 * paragraph by paragraph when nothing was added, removed or moved, else by
 * diffing each side against the base within the region — so only changes that
 * really overlap become conflicts.
 *
 * The `_`-prefixed metadata beside the body (see saveContent.ts) is merged per
 * key. Lists of records with an `id` (notes, tags, character profiles, beats …)
 * are merged record by record, lists of words as sets, plugin data (`_pluginData`)
 * plugin by plugin, and anything else as one value.
 *
 * Track-changes proposals live in `_reviewSnapshot`; inputs are first restored
 * with `restoreReviewContent`, so suggestions are merged as part of the
 * paragraphs they mark, and the result is wrapped again by `prepareReviewSave`.
 */

import type { JSONContent } from '@tiptap/core';
import { prepareReviewSave, restoreReviewContent, REVIEW_SNAPSHOT_KEY } from './reviewSave';
import { jsonBlockText } from './nodeText';
import { PLUGIN_DATA_KEY } from './pluginData';

export type ScriptContent = Record<string, unknown>;
export type MergeSide = 'device' | 'cloud';
/** How a conflict is settled. `both` keeps this device's text first, then the cloud's. */
export type MergeChoice = 'device' | 'cloud' | 'both';

export interface TextConflict {
  kind: 'text';
  id: string;
  /** The paragraphs as last synced (empty when there is no base, or they were added). */
  base: JSONContent[];
  device: JSONContent[];
  cloud: JSONContent[];
  /** The scene heading the conflict falls under, for orientation. */
  scene: string | null;
}

export interface ItemConflict {
  kind: 'item';
  id: string;
  /** The metadata key, e.g. `_notes` or `_spellCheckEnabled`. */
  key: string;
  /** The record id for a list of records; absent for a whole value. */
  itemId?: string;
  /** A short human name for the record (a character's name, a note's text). */
  label: string;
  /** `undefined` when the record was deleted on that side. */
  device: unknown;
  cloud: unknown;
}

export type MergeConflict = TextConflict | ItemConflict;

/** One stretch of the merged script body, in reading order. */
export type MergeSegment =
  | { kind: 'same'; blocks: JSONContent[] }
  /** Changed on one side only (or identically on both), taken automatically. */
  | { kind: 'auto'; from: MergeSide | 'both'; blocks: JSONContent[]; replaced: JSONContent[] }
  | { kind: 'conflict'; conflictId: string };

export interface ScriptMergeResult {
  segments: MergeSegment[];
  conflicts: MergeConflict[];
  /** Metadata that merged cleanly. Keys in conflict are absent until chosen. */
  metadata: ScriptContent;
  /** Changes to the script body taken from each side without asking. */
  autoFromDevice: number;
  autoFromCloud: number;
  /** No base was known, so every difference had to be asked about. */
  twoWay: boolean;
  /** Device and cloud are already the same. */
  identical: boolean;
}

// ── Canonical comparison ───────────────────────────────────────────────────

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
      .join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

// ── Sequence alignment ─────────────────────────────────────────────────────

/** Above this many table cells the alignment falls back to linear memory. */
const MAX_TABLE_CELLS = 4_000_000;

function lcsRow(a: string[], a0: number, a1: number, b: string[], b0: number, b1: number, reverse: boolean): Int32Array {
  const m = b1 - b0;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  if (!reverse) {
    for (let i = a0; i < a1; i++) {
      for (let j = 0; j < m; j++) cur[j + 1] = a[i] === b[b0 + j] ? prev[j] + 1 : Math.max(prev[j + 1], cur[j]);
      [prev, cur] = [cur, prev];
      cur.fill(0);
    }
  } else {
    for (let i = a1 - 1; i >= a0; i--) {
      for (let j = m - 1; j >= 0; j--) cur[j] = a[i] === b[b0 + j] ? prev[j + 1] + 1 : Math.max(prev[j], cur[j + 1]);
      [prev, cur] = [cur, prev];
      cur.fill(0);
    }
  }
  return prev;
}

function hirschberg(a: string[], a0: number, a1: number, b: string[], b0: number, b1: number, out: Array<[number, number]>) {
  if (a0 >= a1 || b0 >= b1) return;
  if (a1 - a0 === 1) {
    for (let j = b0; j < b1; j++) if (a[a0] === b[j]) { out.push([a0, j]); return; }
    return;
  }
  const mid = a0 + ((a1 - a0) >> 1);
  const left = lcsRow(a, a0, mid, b, b0, b1, false);
  const right = lcsRow(a, mid, a1, b, b0, b1, true);
  let best = -1;
  let split = b0;
  for (let j = 0; j <= b1 - b0; j++) {
    if (left[j] + right[j] > best) { best = left[j] + right[j]; split = b0 + j; }
  }
  hirschberg(a, a0, mid, b, b0, split, out);
  hirschberg(a, mid, a1, b, split, b1, out);
}

/** Longest common subsequence of two key lists, as ascending index pairs. */
export function alignKeys(a: string[], b: string[]): Array<[number, number]> {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix
    && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < prefix; k++) pairs.push([k, k]);
  const a0 = prefix, a1 = a.length - suffix, b0 = prefix, b1 = b.length - suffix;
  const n = a1 - a0, m = b1 - b0;
  if (n > 0 && m > 0) {
    if (n * m <= MAX_TABLE_CELLS) {
      const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
      for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
          dp[i][j] = a[a0 + i - 1] === b[b0 + j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
      const middle: Array<[number, number]> = [];
      let i = n, j = m;
      while (i > 0 && j > 0) {
        if (a[a0 + i - 1] === b[b0 + j - 1]) { middle.push([a0 + i - 1, b0 + j - 1]); i--; j--; }
        else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
        else j--;
      }
      pairs.push(...middle.reverse());
    } else {
      hirschberg(a, a0, a1, b, b0, b1, pairs);
    }
  }
  for (let k = 0; k < suffix; k++) pairs.push([a.length - suffix + k, b.length - suffix + k]);
  return pairs;
}

interface Region {
  stable: boolean;
  base: [number, number];
  device: [number, number];
  cloud: [number, number];
}

/** diff3: split three sequences into stable runs (equal on all three) and the
 * unstable regions between them. */
export function diff3Regions(base: string[], device: string[], cloud: string[]): Region[] {
  const toDevice = new Map(alignKeys(base, device));
  const toCloud = new Map(alignKeys(base, cloud));
  const regions: Region[] = [];
  let b = 0, d = 0, c = 0;
  const pushUnstable = (b1: number, d1: number, c1: number) => {
    if (b1 > b || d1 > d || c1 > c) regions.push({ stable: false, base: [b, b1], device: [d, d1], cloud: [c, c1] });
  };
  for (let i = 0; i < base.length; i++) {
    const di = toDevice.get(i);
    const ci = toCloud.get(i);
    if (di === undefined || ci === undefined || di < d || ci < c) continue;
    pushUnstable(i, di, ci);
    const last = regions[regions.length - 1];
    if (last?.stable && last.base[1] === i && last.device[1] === di && last.cloud[1] === ci) {
      last.base[1]++; last.device[1]++; last.cloud[1]++;
    } else {
      regions.push({ stable: true, base: [i, i + 1], device: [di, di + 1], cloud: [ci, ci + 1] });
    }
    b = i + 1; d = di + 1; c = ci + 1;
  }
  pushUnstable(base.length, device.length, cloud.length);
  return regions;
}

// ── The script body ────────────────────────────────────────────────────────

function blocksOf(content: ScriptContent | null): JSONContent[] {
  const blocks = content?.content;
  return Array.isArray(blocks) ? blocks as JSONContent[] : [];
}

const SCENE_TYPES = new Set(['sceneHeading', 'heading']);

function sceneBefore(blocks: JSONContent[], end: number): string | null {
  for (let i = Math.min(end, blocks.length) - 1; i >= 0; i--) {
    if (SCENE_TYPES.has(String(blocks[i]?.type))) return jsonBlockText(blocks[i]).trim() || null;
  }
  return null;
}

/** When both sides changed one region, keep the parts at its edges that they
 * changed identically out of the conflict, so it shows only what really differs. */
function trimCommon(device: JSONContent[], cloud: JSONContent[], deviceKeys: string[], cloudKeys: string[]) {
  let head = 0;
  while (head < deviceKeys.length && head < cloudKeys.length && deviceKeys[head] === cloudKeys[head]) head++;
  let tail = 0;
  while (tail < deviceKeys.length - head && tail < cloudKeys.length - head
    && deviceKeys[deviceKeys.length - 1 - tail] === cloudKeys[cloudKeys.length - 1 - tail]) tail++;
  return {
    head: device.slice(0, head),
    tail: device.slice(device.length - tail),
    device: device.slice(head, device.length - tail),
    cloud: cloud.slice(head, cloud.length - tail),
  };
}

/** One side's change to a region: base paragraphs [b0, b1) became side
 * paragraphs [s0, s1). b0 === b1 is an insertion at that gap. */
interface Hunk { side: MergeSide; b0: number; b1: number; s0: number; s1: number }

function hunksOf(side: MergeSide, baseKeys: string[], sideKeys: string[]): { hunks: Hunk[]; matched: Map<number, number> } {
  const pairs = alignKeys(baseKeys, sideKeys);
  const hunks: Hunk[] = [];
  let b = 0, s = 0;
  for (const [i, j] of [...pairs, [baseKeys.length, sideKeys.length] as [number, number]]) {
    if (i > b || j > s) hunks.push({ side, b0: b, b1: i, s0: s, s1: j });
    b = i + 1; s = j + 1;
  }
  return { hunks, matched: new Map(pairs) };
}

/** Two changes from different sides touch the same base paragraphs (or insert
 * at the same place). A change that only borders another does not. */
function overlaps(x: Hunk, y: Hunk): boolean {
  const xi = x.b0 === x.b1, yi = y.b0 === y.b1;
  if (xi && yi) return x.b0 === y.b0;
  if (xi) return y.b0 < x.b0 && x.b0 < y.b1;
  if (yi) return x.b0 < y.b0 && y.b0 < x.b1;
  return x.b0 < y.b1 && y.b0 < x.b1;
}

interface HunkGroup { b0: number; b1: number; hunks: Hunk[] }

/** Diff each side against the base within one region and group the changes
 * that overlap; each group is taken from its one side, or is a conflict. */
function groupHunks(device: Hunk[], cloud: Hunk[]): HunkGroup[] {
  const all = [...device, ...cloud];
  const parent = all.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // Both lists are in base order and disjoint, so each device change is only
  // checked against the cloud changes near it.
  let from = 0;
  for (let i = 0; i < device.length; i++) {
    while (from < cloud.length && cloud[from].b1 < device[i].b0) from++;
    for (let j = from; j < cloud.length; j++) {
      if (cloud[j].b0 > device[i].b1) break;
      if (overlaps(device[i], cloud[j])) parent[find(i)] = find(device.length + j);
    }
  }
  const groups = new Map<number, HunkGroup>();
  all.forEach((hunk, i) => {
    const root = find(i);
    const group = groups.get(root);
    if (!group) groups.set(root, { b0: hunk.b0, b1: hunk.b1, hunks: [hunk] });
    else {
      group.b0 = Math.min(group.b0, hunk.b0);
      group.b1 = Math.max(group.b1, hunk.b1);
      group.hunks.push(hunk);
    }
  });
  // An insertion at a gap goes before a change that starts there.
  return [...groups.values()].sort((a, b) => a.b0 - b.b0 || a.b1 - b.b1);
}

/** What one side holds in place of base paragraphs [b0, b1) of a group. */
function sideRange(group: HunkGroup, side: MergeSide, matched: Map<number, number>): [number, number] | null {
  const own = group.hunks.filter(hunk => hunk.side === side);
  if (group.b0 === group.b1) return own.length ? [own[0].s0, own[0].s1] : null;
  const first = own.find(hunk => hunk.b0 === group.b0);
  const last = own.find(hunk => hunk.b1 === group.b1);
  const start = first ? first.s0 : matched.get(group.b0);
  const end = last ? last.s1 : (matched.get(group.b1 - 1) ?? -2) + 1;
  return start === undefined || end < start ? null : [start, end];
}

function mergeBody(
  base: JSONContent[], device: JSONContent[], cloud: JSONContent[], twoWay: boolean,
  conflicts: MergeConflict[], counts: { device: number; cloud: number },
): MergeSegment[] {
  const keys = (blocks: JSONContent[]) => blocks.map(canonical);
  const deviceKeys = keys(device), cloudKeys = keys(cloud);
  // Without a base, the paragraphs the two copies share stand in for it: they
  // anchor the alignment, and everything between them is asked about.
  if (twoWay) base = alignKeys(deviceKeys, cloudKeys).map(([i]) => device[i]);
  const baseKeys = keys(base);
  const segments: MergeSegment[] = [];
  const push = (segment: MergeSegment) => {
    const last = segments[segments.length - 1];
    if (segment.kind === 'same' && last?.kind === 'same') last.blocks.push(...segment.blocks);
    else if (segment.kind !== 'same' || segment.blocks.length) segments.push(segment);
  };

  /** Base paragraphs [b0, b1) became device [d0, d1) and cloud [c0, c1). Takes
   * them when only one side (or both alike) changed them; false otherwise. */
  const settle = (b0: number, b1: number, d0: number, d1: number, c0: number, c1: number): boolean => {
    const b = base.slice(b0, b1), d = device.slice(d0, d1), c = cloud.slice(c0, c1);
    const bk = baseKeys.slice(b0, b1).join('\n');
    const dk = deviceKeys.slice(d0, d1).join('\n');
    const ck = cloudKeys.slice(c0, c1).join('\n');
    if (dk === ck) {
      if (dk === bk && !twoWay) push({ kind: 'same', blocks: d });
      else if (d.length || b.length) push({ kind: 'auto', from: 'both', blocks: d, replaced: b });
      return true;
    }
    if (twoWay) return false;
    if (dk === bk) { counts.cloud++; push({ kind: 'auto', from: 'cloud', blocks: c, replaced: b }); return true; }
    if (ck === bk) { counts.device++; push({ kind: 'auto', from: 'device', blocks: d, replaced: b }); return true; }
    return false;
  };

  /** Both sides changed the same place: ask, leaving out what they changed alike at its edges. */
  const ask = (b0: number, b1: number, d0: number, d1: number, c0: number, c1: number) => {
    const d = device.slice(d0, d1), c = cloud.slice(c0, c1);
    const trimmed = trimCommon(d, c, deviceKeys.slice(d0, d1), cloudKeys.slice(c0, c1));
    if (trimmed.head.length) push({ kind: 'auto', from: 'both', blocks: trimmed.head, replaced: [] });
    const id = `text-${conflicts.length}`;
    conflicts.push({
      kind: 'text', id, base: base.slice(b0, b1), device: trimmed.device, cloud: trimmed.cloud,
      scene: sceneBefore(device, d0 + trimmed.head.length + 1) ?? sceneBefore(cloud, c0 + 1),
    });
    push({ kind: 'conflict', conflictId: id });
    if (trimmed.tail.length) push({ kind: 'auto', from: 'both', blocks: trimmed.tail, replaced: [] });
  };

  /** Diff each side against the base within one region, then take each change
   * that no change on the other side overlaps from its own side, and ask only
   * about those that do. False when that would not split the region. */
  const mergeHunks = (region: Region): boolean => {
    const [rb, rbEnd] = region.base, [rd, rdEnd] = region.device, [rc, rcEnd] = region.cloud;
    const bks = baseKeys.slice(rb, rbEnd);
    const dev = hunksOf('device', bks, deviceKeys.slice(rd, rdEnd));
    const cl = hunksOf('cloud', bks, cloudKeys.slice(rc, rcEnd));
    const groups = groupHunks(dev.hunks, cl.hunks);
    if (groups.length < 2) return false;
    // Where a side stands at a gap of the base, for a group it adds nothing to.
    const gapAt = (side: { hunks: Hunk[]; matched: Map<number, number> }, gap: number): number => {
      if (gap === 0) return 0;
      const before = side.matched.get(gap - 1);
      if (before !== undefined) return before + 1;
      return side.hunks.find(hunk => hunk.b0 < gap && hunk.b1 >= gap)?.s1 ?? 0;
    };
    // Plan the whole region first, so anything inconsistent falls back to one question.
    const plan: Array<{ group: HunkGroup; d: [number, number]; c: [number, number] }> = [];
    let cursor = 0;
    for (const group of groups) {
      if (group.b0 < cursor) return false;
      const d = sideRange(group, 'device', dev.matched) ?? (group.b0 === group.b1 ? [gapAt(dev, group.b0), gapAt(dev, group.b0)] : null);
      const c = sideRange(group, 'cloud', cl.matched) ?? (group.b0 === group.b1 ? [gapAt(cl, group.b0), gapAt(cl, group.b0)] : null);
      if (!d || !c) return false;
      for (let i = cursor; i < group.b0; i++) if (!dev.matched.has(i) || !cl.matched.has(i)) return false;
      plan.push({ group, d: d as [number, number], c: c as [number, number] });
      cursor = group.b1;
    }
    for (let i = cursor; i < bks.length; i++) if (!dev.matched.has(i) || !cl.matched.has(i)) return false;
    cursor = 0;
    const keep = (to: number) => {
      for (let i = cursor; i < to; i++) push({ kind: 'same', blocks: [device[rd + dev.matched.get(i)!]] });
    };
    for (const { group, d, c } of plan) {
      keep(group.b0);
      const args = [rb + group.b0, rb + group.b1, rd + d[0], rd + d[1], rc + c[0], rc + c[1]] as const;
      if (!settle(...args)) ask(...args);
      cursor = group.b1;
    }
    keep(bks.length);
    return true;
  };

  for (const region of diff3Regions(baseKeys, deviceKeys, cloudKeys)) {
    const [b0, b1] = region.base, [d0, d1] = region.device, [c0, c1] = region.cloud;
    if (region.stable) { push({ kind: 'same', blocks: device.slice(d0, d1) }); continue; }
    if (settle(b0, b1, d0, d1, c0, c1)) continue;
    // Neighbouring paragraphs edited on different sides (a line of dialogue
    // here, its parenthetical there; a line removed here, the next one edited
    // there and a line added after it) are one region to diff3, which git would
    // call a conflict. Diff each side against the base within the region so
    // each change no change on the other side overlaps is taken on its own.
    // Paragraphs are never paired up by position: a side that replaced two
    // paragraphs with two others may have edited one and removed the other.
    if (!twoWay && mergeHunks(region)) continue;
    ask(b0, b1, d0, d1, c0, c1);
  }
  return segments;
}

// ── Metadata ───────────────────────────────────────────────────────────────

type Rec = Record<string, unknown> & { id: string };

const isRecordList = (value: unknown): value is Rec[] =>
  Array.isArray(value) && value.length > 0
  && value.every(item => !!item && typeof item === 'object' && !Array.isArray(item)
    && typeof (item as { id?: unknown }).id === 'string');

const isPrimitiveList = (value: unknown): value is Array<string | number | boolean> =>
  Array.isArray(value) && value.length > 0 && value.every(item => item === null || typeof item !== 'object');

/** A list either side could be: empty lists fit both shapes. */
const listKind = (...values: unknown[]): 'records' | 'primitives' | null => {
  const present = values.filter(value => Array.isArray(value) && value.length > 0);
  if (!present.length || !values.every(value => value === undefined || Array.isArray(value))) return null;
  if (present.every(isRecordList)) return 'records';
  if (present.every(isPrimitiveList)) return 'primitives';
  return null;
};

/** A readable name for a record, from whichever of the usual fields it has. */
export function recordLabel(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const item = record as Record<string, unknown>;
  for (const field of ['name', 'title', 'text', 'label', 'content', 'description', 'note']) {
    const value = item[field];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 80);
  }
  return '';
}

function mergeRecords(
  key: string, base: Rec[] | undefined, device: Rec[] | undefined, cloud: Rec[] | undefined,
  twoWay: boolean, conflicts: MergeConflict[],
): Rec[] {
  const byId = (list: Rec[] | undefined) => new Map((list ?? []).map(item => [item.id, item]));
  const b = byId(base), d = byId(device), c = byId(cloud);
  // Device order first; records only the cloud has go in after the record that
  // precedes them there, so a new note lands near where it was written.
  const order: string[] = [...d.keys()];
  const cloudOrder = [...c.keys()];
  cloudOrder.forEach((id, index) => {
    if (d.has(id)) return;
    const previous = cloudOrder.slice(0, index).reverse().find(other => order.includes(other));
    order.splice(previous === undefined ? order.length : order.indexOf(previous) + 1, 0, id);
  });
  const merged: Rec[] = [];
  for (const id of order) {
    const bv = b.get(id), dv = d.get(id), cv = c.get(id);
    let value: Rec | undefined;
    if (same(dv, cv)) value = dv;
    else if (twoWay && (dv === undefined || cv === undefined)) value = dv ?? cv; // keep, never assume a deletion
    else if (!twoWay && same(dv, bv)) value = cv;
    else if (!twoWay && same(cv, bv)) value = dv;
    else {
      conflicts.push({
        kind: 'item', id: `item-${conflicts.length}`, key, itemId: id,
        label: recordLabel(dv) || recordLabel(cv) || recordLabel(bv), device: dv, cloud: cv,
      });
      // A placeholder keeps the record's place for the choice made later.
      merged.push({ id, __conflict: conflicts[conflicts.length - 1].id } as Rec);
      continue;
    }
    if (value !== undefined) merged.push(value);
  }
  return merged;
}

function mergePrimitives(base: unknown[] | undefined, device: unknown[] | undefined, cloud: unknown[] | undefined, twoWay: boolean) {
  const b = new Set((base ?? []).map(canonical));
  const d = new Set((device ?? []).map(canonical));
  const c = new Set((cloud ?? []).map(canonical));
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const value of [...(device ?? []), ...(cloud ?? [])]) {
    const key = canonical(value);
    if (seen.has(key)) continue;
    seen.add(key);
    // Removed on one side, still there unchanged on the other: removed.
    const removed = !twoWay && b.has(key) && (!d.has(key) || !c.has(key));
    if (!removed) out.push(value);
  }
  return out;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Metadata kept as a map of independent entries, merged entry by entry. */
const KEYED_MAPS = new Set([PLUGIN_DATA_KEY]);

/** Merge a map entry by entry, e.g. `_pluginData` by plugin id, so two plugins
 * changing their own data on different sides do not clash. An entry both sides
 * changed differently is a conflict, held in place by a marker. */
function mergeKeyed(
  key: string, base: Record<string, unknown> | undefined, device: Record<string, unknown> | undefined,
  cloud: Record<string, unknown> | undefined, twoWay: boolean, conflicts: MergeConflict[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of new Set([...Object.keys(device ?? {}), ...Object.keys(cloud ?? {})])) {
    const bv = base?.[id], dv = device?.[id], cv = cloud?.[id];
    let value: unknown;
    if (same(dv, cv)) value = dv;
    else if (twoWay && (dv === undefined || cv === undefined)) value = dv ?? cv;
    else if (!twoWay && same(dv, bv)) value = cv;
    else if (!twoWay && same(cv, bv)) value = dv;
    else {
      const conflictId = `item-${conflicts.length}`;
      conflicts.push({ kind: 'item', id: conflictId, key, itemId: id, label: id, device: dv, cloud: cv });
      out[id] = { __conflict: conflictId };
      continue;
    }
    if (value !== undefined) out[id] = value;
  }
  return out;
}

function mergeMetadata(
  base: ScriptContent | null, device: ScriptContent, cloud: ScriptContent, twoWay: boolean,
  conflicts: MergeConflict[],
): ScriptContent {
  const out: ScriptContent = {};
  const keys = new Set([...Object.keys(device), ...Object.keys(cloud)]);
  keys.delete('content');
  for (const key of keys) {
    const bv = base?.[key], dv = device[key], cv = cloud[key];
    if (same(dv, cv)) { if (dv !== undefined) out[key] = dv; continue; }
    // Not counted as changes: an editor writes default settings on its first
    // save, and the count the writer sees is of changes to the script itself.
    if (!twoWay && same(dv, bv)) { if (cv !== undefined) out[key] = cv; continue; }
    if (!twoWay && same(cv, bv)) { if (dv !== undefined) out[key] = dv; continue; }
    if (twoWay && (dv === undefined || cv === undefined)) { out[key] = dv ?? cv; continue; }
    const kind = listKind(bv, dv, cv);
    if (KEYED_MAPS.has(key) && [bv, dv, cv].every(value => value === undefined || isPlainObject(value))) {
      out[key] = mergeKeyed(key, bv as Record<string, unknown> | undefined, dv as Record<string, unknown> | undefined,
        cv as Record<string, unknown> | undefined, twoWay, conflicts);
    } else if (kind === 'records') {
      out[key] = mergeRecords(key, bv as Rec[] | undefined, dv as Rec[] | undefined, cv as Rec[] | undefined, twoWay, conflicts);
    } else if (kind === 'primitives') {
      out[key] = mergePrimitives(bv as unknown[] | undefined, dv as unknown[] | undefined, cv as unknown[] | undefined, twoWay);
    } else {
      conflicts.push({ kind: 'item', id: `item-${conflicts.length}`, key, label: '', device: dv, cloud: cv });
    }
  }
  return out;
}

// ── Public API ─────────────────────────────────────────────────────────────

function restored(content: ScriptContent | null | undefined): ScriptContent | null {
  if (!content || typeof content !== 'object') return null;
  const full = { ...restoreReviewContent(content) };
  delete full[REVIEW_SNAPSHOT_KEY];
  return full;
}

export function mergeScripts(
  base: ScriptContent | null | undefined, device: ScriptContent, cloud: ScriptContent,
): ScriptMergeResult {
  const b = restored(base);
  const d = restored(device) ?? {};
  const c = restored(cloud) ?? {};
  const twoWay = !b;
  const conflicts: MergeConflict[] = [];
  const counts = { device: 0, cloud: 0 };
  const segments = mergeBody(blocksOf(b), blocksOf(d), blocksOf(c), twoWay, conflicts, counts);
  const metadata = mergeMetadata(b, d, c, twoWay, conflicts);
  return {
    segments, conflicts, metadata, twoWay,
    autoFromDevice: counts.device, autoFromCloud: counts.cloud,
    identical: same(d, c),
  };
}

/** A conflict's options. A whole value or a single record cannot be kept twice. */
export function choicesFor(conflict: MergeConflict): MergeChoice[] {
  if (conflict.kind === 'text') return ['device', 'cloud', 'both'];
  return ['device', 'cloud'];
}

/** Every conflict has a choice. */
export function mergeComplete(result: ScriptMergeResult, choices: Record<string, MergeChoice | undefined>) {
  return result.conflicts.every(conflict => !!choices[conflict.id]);
}

/** Build the merged script from the result and the writer's choices. A conflict
 * left without a choice keeps this device's side. */
export function applyMerge(result: ScriptMergeResult, choices: Record<string, MergeChoice | undefined>): ScriptContent {
  const conflicts = new Map(result.conflicts.map(conflict => [conflict.id, conflict]));
  const pick = (id: string) => choices[id] ?? 'device';
  const body: JSONContent[] = [];
  for (const segment of result.segments) {
    if (segment.kind !== 'conflict') { body.push(...segment.blocks); continue; }
    const conflict = conflicts.get(segment.conflictId);
    if (conflict?.kind !== 'text') continue;
    const choice = pick(conflict.id);
    if (choice === 'device' || choice === 'both') body.push(...conflict.device);
    if (choice === 'cloud' || choice === 'both') body.push(...conflict.cloud);
  }
  const markerOf = (item: unknown) => item && typeof item === 'object' ? (item as { __conflict?: string }).__conflict : undefined;
  const chosenFor = (marker: string) => {
    const conflict = conflicts.get(marker) as ItemConflict | undefined;
    return conflict && (pick(marker) === 'cloud' ? conflict.cloud : conflict.device);
  };
  const metadata: ScriptContent = {};
  for (const [key, value] of Object.entries(result.metadata)) {
    if (Array.isArray(value)) {
      metadata[key] = value.flatMap(item => {
        const marker = markerOf(item);
        if (!marker) return [item];
        const chosen = chosenFor(marker);
        return chosen === undefined ? [] : [chosen];
      });
    } else if (KEYED_MAPS.has(key) && isPlainObject(value)) {
      const entries: Record<string, unknown> = {};
      for (const [id, item] of Object.entries(value)) {
        const marker = markerOf(item);
        const chosen = marker ? chosenFor(marker) : item;
        if (chosen !== undefined) entries[id] = chosen;
      }
      metadata[key] = entries;
    } else {
      metadata[key] = value;
    }
  }
  for (const conflict of result.conflicts) {
    if (conflict.kind !== 'item' || conflict.itemId !== undefined) continue;
    const chosen = pick(conflict.id) === 'cloud' ? conflict.cloud : conflict.device;
    if (chosen !== undefined) metadata[conflict.key] = chosen;
  }
  // An empty document still needs one block to open in the editor.
  const content = body.length ? body : [{ type: 'sceneHeading', content: [] }];
  return prepareReviewSave({ type: 'doc', ...metadata, content });
}

/** Merge without asking: the merged script when nothing conflicts, else null. */
export function autoMerge(
  base: ScriptContent | null | undefined, device: ScriptContent, cloud: ScriptContent,
): ScriptContent | null {
  if (!base) return null;
  const result = mergeScripts(base, device, cloud);
  return result.conflicts.length ? null : applyMerge(result, {});
}

/** The copies a merge was built from. `device` is absent when the caller keeps
 * its own (an open editor's text). */
export interface MergeCopies {
  base: ScriptContent | null;
  device?: ScriptContent;
  cloud: ScriptContent;
  /** The cloud revision `cloud` was read at: a merge built on it is saved only onto it. */
  cloudRevision?: string;
}

/** Marks an error as "the merge was built on a copy that has changed since":
 * nothing was saved, and the dialog builds the merge again from `copies`. */
export function withMergeCopies<E extends Error>(error: E, copies: MergeCopies): E & { mergeCopies: MergeCopies } {
  return Object.assign(error, { mergeCopies: copies });
}

/** The copies to rebuild a merge from, when `error` says it went out of date. */
export function outdatedMergeCopies(error: unknown): MergeCopies | null {
  const copies = error && typeof error === 'object' ? (error as { mergeCopies?: MergeCopies }).mergeCopies : undefined;
  return copies && typeof copies === 'object' && copies.cloud && typeof copies.cloud === 'object' ? copies : null;
}

/** Plain text of some paragraphs, for previews. */
export function blocksText(blocks: JSONContent[]): string[] {
  return blocks.map(block => jsonBlockText(block));
}
