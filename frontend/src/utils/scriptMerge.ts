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
 * base are taken from it, and regions where both differ become conflicts.
 *
 * The `_`-prefixed metadata beside the body (see saveContent.ts) is merged per
 * key. Lists of records with an `id` (notes, tags, character profiles, beats …)
 * are merged record by record, lists of words as sets, and anything else as one
 * value.
 *
 * Track-changes proposals live in `_reviewSnapshot`; inputs are first restored
 * with `restoreReviewContent`, so suggestions are merged as part of the
 * paragraphs they mark, and the result is wrapped again by `prepareReviewSave`.
 */

import type { JSONContent } from '@tiptap/core';
import { prepareReviewSave, restoreReviewContent, REVIEW_SNAPSHOT_KEY } from './reviewSave';
import { jsonBlockText } from './nodeText';

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

function slice<T>(list: T[], [from, to]: [number, number]): T[] {
  return list.slice(from, to);
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
  for (const region of diff3Regions(baseKeys, deviceKeys, cloudKeys)) {
    const b = slice(base, region.base), d = slice(device, region.device), c = slice(cloud, region.cloud);
    if (region.stable) { push({ kind: 'same', blocks: d }); continue; }
    const bk = slice(baseKeys, region.base).join('\n');
    const dk = slice(deviceKeys, region.device).join('\n');
    const ck = slice(cloudKeys, region.cloud).join('\n');
    if (dk === ck) {
      if (d.length || b.length) push({ kind: 'auto', from: 'both', blocks: d, replaced: b });
      continue;
    }
    if (!twoWay && dk === bk) { counts.cloud++; push({ kind: 'auto', from: 'cloud', blocks: c, replaced: b }); continue; }
    if (!twoWay && ck === bk) { counts.device++; push({ kind: 'auto', from: 'device', blocks: d, replaced: b }); continue; }
    // Neighbouring paragraphs edited on different sides (a line of dialogue
    // here, its parenthetical there) are one region to diff3, which git would
    // call a conflict. When no paragraph was added or removed, merge each one
    // on its own and ask only about those both sides changed.
    if (!twoWay && b.length > 1 && b.length === d.length && b.length === c.length) {
      const bks = slice(baseKeys, region.base), dks = slice(deviceKeys, region.device), cks = slice(cloudKeys, region.cloud);
      for (let i = 0; i < b.length; i++) {
        if (dks[i] === cks[i]) push(dks[i] === bks[i] ? { kind: 'same', blocks: [d[i]] } : { kind: 'auto', from: 'both', blocks: [d[i]], replaced: [b[i]] });
        else if (dks[i] === bks[i]) { counts.cloud++; push({ kind: 'auto', from: 'cloud', blocks: [c[i]], replaced: [b[i]] }); }
        else if (cks[i] === bks[i]) { counts.device++; push({ kind: 'auto', from: 'device', blocks: [d[i]], replaced: [b[i]] }); }
        else {
          const id = `text-${conflicts.length}`;
          conflicts.push({
            kind: 'text', id, base: [b[i]], device: [d[i]], cloud: [c[i]],
            scene: sceneBefore(device, region.device[0] + i + 1),
          });
          push({ kind: 'conflict', conflictId: id });
        }
      }
      continue;
    }
    const trimmed = trimCommon(d, c, slice(deviceKeys, region.device), slice(cloudKeys, region.cloud));
    if (trimmed.head.length) push({ kind: 'auto', from: 'both', blocks: trimmed.head, replaced: [] });
    const id = `text-${conflicts.length}`;
    conflicts.push({
      kind: 'text', id, base: b, device: trimmed.device, cloud: trimmed.cloud,
      scene: sceneBefore(device, region.device[0] + trimmed.head.length + 1) ?? sceneBefore(cloud, region.cloud[0] + 1),
    });
    push({ kind: 'conflict', conflictId: id });
    if (trimmed.tail.length) push({ kind: 'auto', from: 'both', blocks: trimmed.tail, replaced: [] });
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
    if (kind === 'records') {
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
  const metadata: ScriptContent = {};
  for (const [key, value] of Object.entries(result.metadata)) {
    metadata[key] = Array.isArray(value)
      ? value.flatMap(item => {
        const marker = item && typeof item === 'object' ? (item as { __conflict?: string }).__conflict : undefined;
        if (!marker) return [item];
        const conflict = conflicts.get(marker) as ItemConflict | undefined;
        const chosen = conflict && (pick(marker) === 'cloud' ? conflict.cloud : conflict.device);
        return chosen === undefined ? [] : [chosen];
      })
      : value;
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

/** Plain text of some paragraphs, for previews. */
export function blocksText(blocks: JSONContent[]): string[] {
  return blocks.map(block => jsonBlockText(block));
}
