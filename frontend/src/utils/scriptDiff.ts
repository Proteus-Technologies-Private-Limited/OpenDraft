/**
 * Screenplay-aware diff between two TipTap documents. Operates at node level
 * (scene heading, action, dialogue, etc.) rather than line/character level, so
 * changes are shown in terms of screenplay elements.
 *
 * Paragraphs are aligned by element and text (longest common subsequence). In
 * each run of differing paragraphs:
 *
 * - an edit in place - as many removed and added paragraphs, of the same
 *   elements, one after the other - is a **modification** with a word-level diff;
 * - otherwise removed and added paragraphs are paired in order when they share
 *   at least half their words, so a rewritten line is a modification rather
 *   than a deletion plus an addition;
 * - a removed paragraph whose exact text comes back elsewhere is **moved**;
 * - what remains is **added** or **deleted**.
 *
 * Duplicates are matched one to one, in order. The result follows the reading
 * order of the newer draft, with deletions where they were in the older one.
 */

import type { JSONContent } from '@tiptap/react';
import { jsonBlockText } from './nodeText';

export type ChangeType = 'added' | 'deleted' | 'modified' | 'moved' | 'unchanged';

export interface DiffBlock {
  type: ChangeType;
  elementType: string;           // e.g. sceneHeading, action, dialogue, character
  /** For a modified block whose element changed, the element in version A. */
  oldElementType?: string | null;
  sceneHeading: string | null;   // scene that this block belongs to in B (A for deletions)
  /** For a block that moved between scenes, the scene it came from. */
  oldSceneHeading?: string | null;
  oldText: string | null;        // text in version A (null for pure additions)
  newText: string | null;        // text in version B (null for pure deletions)
  oldIndex: number;              // block index in A (-1 if added)
  newIndex: number;              // block index in B (-1 if deleted)
  wordDiffs: WordDiff[] | null;  // only set for 'modified'
}

export interface WordDiff {
  text: string;
  kind: 'same' | 'added' | 'removed';
}

export interface DiffSummary {
  totalAdded: number;
  totalDeleted: number;
  totalModified: number;
  totalMoved: number;
  scenesChanged: string[];
  dialogueDelta: Array<{ character: string; added: number; removed: number }>;
}

export interface ScriptDiffResult {
  blocks: DiffBlock[];
  summary: DiffSummary;
}

interface FlatBlock {
  type: string;
  text: string;
}

/** Most cells for the paragraph alignment table. Bigger scripts fall back to
 *  matching the common prefix and suffix only, rather than freezing the tab. */
const MAX_ALIGN_CELLS = 16_000_000;

/** Most comparisons when pairing a run of edits. Bigger runs are reported as
 *  plain additions and deletions; the exact moves below still find themselves. */
const MAX_PAIR_CELLS = 250_000;

/** How many words two paragraphs must share to count as the same line rewritten
 *  (Dice coefficient over word multisets: 0 = nothing, 1 = identical). */
const CHANGE_SIMILARITY = 0.5;

// Hard breaks must appear in the extracted text, or two revisions differing
// only in where a break sits produce identical strings and the alignment below
// reports "no change" for an edit the writer really made.
const getText = jsonBlockText;

function flattenBlocks(doc: JSONContent): FlatBlock[] {
  const blocks: FlatBlock[] = [];
  for (const child of doc.content || []) {
    blocks.push({
      type: child.type || 'unknown',
      text: getText(child).trim(),
    });
  }
  return blocks;
}

const sameBlock = (a: FlatBlock, b: FlatBlock) => a.type === b.type && a.text === b.text;

/**
 * LCS lengths between a[a0..a1) and every prefix of b[b0..b1).
 * One row at a time: memory is O(m), not O(nm).
 */
function lcsPrefixLengths(
  a: FlatBlock[], a0: number, a1: number,
  b: FlatBlock[], b0: number, b1: number,
): Int32Array {
  const m = b1 - b0;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  for (let i = a0; i < a1; i++) {
    for (let j = 0; j < m; j++) {
      cur[j + 1] = sameBlock(a[i], b[b0 + j])
        ? prev[j] + 1
        : Math.max(prev[j + 1], cur[j]);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
    cur.fill(0);
  }
  return prev;
}

/**
 * LCS lengths between a[a0..a1) and every suffix of b[b0..b1), indexed by the
 * suffix start: result[j] is for b[b0 + j .. b1).
 */
function lcsSuffixLengths(
  a: FlatBlock[], a0: number, a1: number,
  b: FlatBlock[], b0: number, b1: number,
): Int32Array {
  const m = b1 - b0;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  for (let i = a1 - 1; i >= a0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      cur[j] = sameBlock(a[i], b[b0 + j])
        ? prev[j + 1] + 1
        : Math.max(prev[j], cur[j + 1]);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
    cur.fill(0);
  }
  return prev;
}

/**
 * Hirschberg's LCS: the exact alignment of the full table, with linear memory.
 * Used above MAX_ALIGN_CELLS, where the n×m table would be too large. A large
 * script with a few edits pays only for the common blocks it can match, and
 * identical blocks are always aligned instead of being paired as rewrites.
 */
function alignBlocksLinear(
  a: FlatBlock[], a0: number, a1: number,
  b: FlatBlock[], b0: number, b1: number,
  out: Array<[number, number]>,
): void {
  if (a0 >= a1 || b0 >= b1) return;
  if (a1 - a0 === 1) {
    for (let j = b0; j < b1; j++) {
      if (sameBlock(a[a0], b[j])) { out.push([a0, j]); break; }
    }
    return;
  }
  if (b1 - b0 === 1) {
    for (let i = a0; i < a1; i++) {
      if (sameBlock(a[i], b[b0])) { out.push([i, b0]); break; }
    }
    return;
  }

  const mid = a0 + ((a1 - a0) >> 1);
  const left = lcsPrefixLengths(a, a0, mid, b, b0, b1);
  const right = lcsSuffixLengths(a, mid, a1, b, b0, b1);
  const m = b1 - b0;
  let best = -1;
  let split = b0;
  for (let j = 0; j <= m; j++) {
    const value = left[j] + right[j];
    if (value > best) { best = value; split = b0 + j; }
  }
  alignBlocksLinear(a, a0, mid, b, b0, split, out);
  alignBlocksLinear(a, mid, a1, b, split, b1, out);
}

/** Longest-common-subsequence alignment, as ascending pairs of block indexes. */
function alignBlocks(a: FlatBlock[], b: FlatBlock[]): Array<[number, number]> {
  // The common start and end are certain matches, and keeping them out of the
  // table is what lets a normal script fit comfortably in memory.
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && sameBlock(a[prefix], b[prefix])) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix
    && suffix < b.length - prefix
    && sameBlock(a[a.length - 1 - suffix], b[b.length - 1 - suffix])
  ) suffix++;

  const pairs: Array<[number, number]> = [];
  for (let k = 0; k < prefix; k++) pairs.push([k, k]);

  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  if (n > 0 && m > 0) {
    if (n * m <= MAX_ALIGN_CELLS) {
      const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
      for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
          dp[i][j] = sameBlock(a[prefix + i - 1], b[prefix + j - 1])
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
      const middle: Array<[number, number]> = [];
      let i = n, j = m;
      while (i > 0 && j > 0) {
        if (sameBlock(a[prefix + i - 1], b[prefix + j - 1])) {
          middle.push([prefix + i - 1, prefix + j - 1]);
          i--; j--;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) {
          i--;
        } else {
          j--;
        }
      }
      middle.reverse();
      pairs.push(...middle);
    } else {
      // A large script: the same alignment, computed with linear memory.
      const middle: Array<[number, number]> = [];
      alignBlocksLinear(
        a, prefix, a.length - suffix,
        b, prefix, b.length - suffix,
        middle,
      );
      pairs.push(...middle);
    }
  }

  for (let k = 0; k < suffix; k++) {
    pairs.push([a.length - suffix + k, b.length - suffix + k]);
  }
  return pairs;
}

/** Word-level diff between two strings. */
function diffWords(a: string, b: string): WordDiff[] {
  const aWords = a.split(/(\s+)/);
  const bWords = b.split(/(\s+)/);
  const n = aWords.length;
  const m = bWords.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (aWords[i - 1] === bWords[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const result: WordDiff[] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (aWords[i - 1] === bWords[j - 1]) {
      result.unshift({ text: aWords[i - 1], kind: 'same' });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      result.unshift({ text: aWords[i - 1], kind: 'removed' });
      i--;
    } else {
      result.unshift({ text: bWords[j - 1], kind: 'added' });
      j--;
    }
  }
  while (i > 0) { result.unshift({ text: aWords[i - 1], kind: 'removed' }); i--; }
  while (j > 0) { result.unshift({ text: bWords[j - 1], kind: 'added' }); j--; }
  return result;
}

/**
 * Words that describe structure rather than content: scene-heading
 * environments and times, transition verbs, cue extensions. Ignoring them
 * stops "MARY (V.O.)" pairing with "JOHN (V.O.)", or two scene headings that
 * share only "INT." and "DAY".
 */
const STRUCTURAL_WORDS = new Set([
  'int', 'ext', 'interior', 'exterior', 'i', 'e',
  'day', 'night', 'morning', 'afternoon', 'evening', 'dawn', 'dusk',
  'continuous', 'later', 'moment', 'moments', 'same', 'time',
  'cut', 'to', 'fade', 'in', 'out', 'dissolve', 'smash', 'match', 'wipe',
  'iris', 'intercut', 'split', 'push', 'stock', 'jump', 'flashback', 'flashforward',
  'contd', "cont'd", 'continued', 'vo', 'os', 'oc',
]);

function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    // Cue extensions and their punctuation, before punctuation becomes words.
    .replace(/\b(?:v\.?o|o\.?s|o\.?c)\.?(?=\s|$|[)])/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((word) => word && !STRUCTURAL_WORDS.has(word));
}

/** Shared content words over all content words (0–1), counting repeated words
 *  only as often as both texts have them. Structural words do not count. */
function similarity(a: string, b: string): number {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.length === 0 || wb.length === 0) return 0;
  const pool = [...wb];
  let shared = 0;
  for (const word of wa) {
    const at = pool.indexOf(word);
    if (at >= 0) { pool.splice(at, 1); shared++; }
  }
  return (2 * shared) / (wa.length + wb.length);
}

/** Pair a run of removed and added indexes into modifications, in order.
 *  Identical blocks (same element and text) are returned separately as `same`,
 *  never as a modification. */
function pairRun(
  a: FlatBlock[],
  b: FlatBlock[],
  runA: number[],
  runB: number[],
): {
  changed: Array<[number, number]>;
  same: Array<[number, number]>;
  removed: number[];
  added: number[];
} {
  if (runA.length === 0) {
    return { changed: [], same: [], removed: [], added: [...runB] };
  }
  if (runB.length === 0) {
    return { changed: [], same: [], removed: [...runA], added: [] };
  }

  // Edited in place: the run is the same length and every element lines up.
  if (
    runA.length === runB.length
    && runA.every((ai, k) => a[ai].type === b[runB[k]].type)
  ) {
    const changed: Array<[number, number]> = [];
    const same: Array<[number, number]> = [];
    const removed: number[] = [];
    const added: number[] = [];
    runA.forEach((ai, k) => {
      const bi = runB[k];
      if (sameBlock(a[ai], b[bi])) {
        same.push([ai, bi]);
      } else if (similarity(a[ai].text, b[bi].text) >= CHANGE_SIMILARITY) {
        changed.push([ai, bi]);
      } else {
        // Same shape, nothing in common: a deletion and an addition, not a
        // rewrite. Position alone is not evidence that the writer rewrote it.
        removed.push(ai);
        added.push(bi);
      }
    });
    return { changed, same, removed, added };
  }

  const changed: Array<[number, number]> = [];
  const same: Array<[number, number]> = [];
  const removed: number[] = [];
  const usedB = new Array<boolean>(runB.length).fill(false);
  let nextB = 0;

  // Pathological run (a whole script pasted over another): stay linear, but
  // still align the blocks that are exactly the same.
  if (runA.length * runB.length > MAX_PAIR_CELLS) {
    for (const ai of runA) {
      let found = -1;
      for (let k = nextB; k < runB.length; k++) {
        if (!usedB[k] && sameBlock(a[ai], b[runB[k]])) { found = k; break; }
      }
      if (found >= 0) {
        same.push([ai, runB[found]]);
        usedB[found] = true;
        nextB = found + 1;
      } else {
        removed.push(ai);
      }
    }
  } else {
    for (const ai of runA) {
      let bestK = -1;
      let bestScore = -1;
      let exactK = -1;
      for (let k = nextB; k < runB.length; k++) {
        if (usedB[k]) continue;
        const bi = runB[k];
        if (sameBlock(a[ai], b[bi])) { exactK = k; break; }
        const score = similarity(a[ai].text, b[bi].text);
        if (score >= CHANGE_SIMILARITY && score > bestScore) {
          bestK = k;
          bestScore = score;
        }
      }
      if (exactK >= 0) {
        same.push([ai, runB[exactK]]);
        usedB[exactK] = true;
        nextB = exactK + 1;
      } else if (bestK >= 0) {
        changed.push([ai, runB[bestK]]);
        usedB[bestK] = true;
        nextB = bestK + 1;
      } else {
        removed.push(ai);
      }
    }
  }

  return {
    changed,
    same,
    removed,
    added: runB.filter((_, k) => !usedB[k]),
  };
}

/** The scene each block belongs to, in its own draft. */
function sceneNames(blocks: FlatBlock[]): string[] {
  let current = '';
  return blocks.map((block) => {
    if (block.type === 'sceneHeading') current = block.text;
    return current;
  });
}

/** The character a dialogue block answers, in its own draft. */
function precedingCharacters(blocks: FlatBlock[]): Array<string | null> {
  let current: string | null = null;
  return blocks.map((block) => {
    const before = current;
    if (block.type === 'character') current = block.text;
    return before;
  });
}

interface Entry {
  block: DiffBlock;
  /** Position in the newer draft, or the point a deletion belongs to. */
  key: number;
  /** Deletions come before the additions at the same point. */
  rank: number;
}

export function computeScriptDiff(docA: JSONContent, docB: JSONContent): ScriptDiffResult {
  const a = flattenBlocks(docA);
  const b = flattenBlocks(docB);
  const pairs = alignBlocks(a, b);
  const scenesA = sceneNames(a);
  const scenesB = sceneNames(b);
  const charactersA = precedingCharacters(a);
  const charactersB = precedingCharacters(b);

  const changed: Array<[number, number]> = [];
  const same: Array<[number, number]> = [];
  const removed: number[] = [];
  const added: number[] = [];

  // Runs of unmatched blocks between two aligned pairs.
  let prevA = 0;
  let prevB = 0;
  for (const [ai, bi] of [...pairs, [a.length, b.length] as [number, number]]) {
    const runA: number[] = [];
    const runB: number[] = [];
    for (let i = prevA; i < ai; i++) runA.push(i);
    for (let j = prevB; j < bi; j++) runB.push(j);
    const paired = pairRun(a, b, runA, runB);
    changed.push(...paired.changed);
    same.push(...paired.same);
    removed.push(...paired.removed);
    added.push(...paired.added);
    prevA = ai + 1;
    prevB = bi + 1;
  }

  // Moves: a deleted paragraph whose exact text comes back elsewhere, and only
  // when that block is unique in both drafts. Cues, CUT TO: and (beat) repeat
  // constantly, and counting them as moves inflated the summary.
  const keyOf = (block: FlatBlock) => `${block.type}\u0000${block.text}`;
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (const block of a) countA.set(keyOf(block), (countA.get(keyOf(block)) ?? 0) + 1);
  for (const block of b) countB.set(keyOf(block), (countB.get(keyOf(block)) ?? 0) + 1);
  const addedByKey = new Map<string, number>();
  for (const bi of added) {
    const key = keyOf(b[bi]);
    if (!addedByKey.has(key)) addedByKey.set(key, bi);
  }

  const moved: Array<[number, number]> = [];
  // Cues, transition labels and parentheticals repeat and are short: a cue that
  // comes back in another scene is a new line's cue, not a move of that label.
  const MOVABLE_TYPES = new Set(['action', 'dialogue', 'general', 'lyrics', 'shot']);
  for (const ai of [...removed]) {
    if (!a[ai].text.trim()) continue;
    if (!MOVABLE_TYPES.has(a[ai].type)) continue;
    const key = keyOf(a[ai]);
    if ((countA.get(key) ?? 0) !== 1 || (countB.get(key) ?? 0) !== 1) continue;
    const bi = addedByKey.get(key);
    if (bi === undefined) continue;
    moved.push([ai, bi]);
    removed.splice(removed.indexOf(ai), 1);
    added.splice(added.indexOf(bi), 1);
    addedByKey.delete(key);
  }

  const entries: Entry[] = [];
  const scenesChanged = new Set<string>();
  let totalModified = 0;

  for (const [ai, bi] of pairs) {
    entries.push({
      block: {
        type: 'unchanged',
        elementType: a[ai].type,
        sceneHeading: scenesB[bi] || null,
        oldText: a[ai].text,
        newText: b[bi].text,
        oldIndex: ai,
        newIndex: bi,
        wordDiffs: null,
      },
      key: bi,
      rank: 0,
    });
  }

  // Identical blocks found inside an unmatched run: unchanged, never a rewrite.
  for (const [ai, bi] of same) {
    entries.push({
      block: {
        type: 'unchanged',
        elementType: a[ai].type,
        sceneHeading: scenesB[bi] || null,
        oldText: a[ai].text,
        newText: b[bi].text,
        oldIndex: ai,
        newIndex: bi,
        wordDiffs: null,
      },
      key: bi,
      rank: 0,
    });
  }

  for (const [ai, bi] of changed) {
    const oldBlock = a[ai];
    const newBlock = b[bi];
    entries.push({
      block: {
        type: 'modified',
        elementType: newBlock.type,
        oldElementType: oldBlock.type !== newBlock.type ? oldBlock.type : null,
        sceneHeading: scenesB[bi] || null,
        oldSceneHeading: scenesA[ai] || null,
        oldText: oldBlock.text,
        newText: newBlock.text,
        oldIndex: ai,
        newIndex: bi,
        wordDiffs: diffWords(oldBlock.text, newBlock.text),
      },
      key: bi,
      rank: 0,
    });
    if (scenesB[bi]) scenesChanged.add(scenesB[bi]);
    if (scenesA[ai]) scenesChanged.add(scenesA[ai]);
    totalModified++;
  }

  for (const [ai, bi] of moved) {
    entries.push({
      block: {
        type: 'moved',
        elementType: b[bi].type,
        sceneHeading: scenesB[bi] || null,
        oldSceneHeading: scenesA[ai] || null,
        oldText: a[ai].text,
        newText: b[bi].text,
        oldIndex: ai,
        newIndex: bi,
        wordDiffs: null,
      },
      key: bi,
      rank: 0,
    });
    if (scenesB[bi]) scenesChanged.add(scenesB[bi]);
    if (scenesA[ai]) scenesChanged.add(scenesA[ai]);
  }

  // Every matched pair, in old-draft order, so a deletion can be placed after
  // the block it followed even when that block was itself rewritten.
  const matched = [...pairs, ...same, ...changed, ...moved]
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  for (const ai of removed) {
    // The deletion belongs just after the last matched block before it.
    let lo = 0, hi = matched.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (matched[mid][0] < ai) lo = mid + 1;
      else hi = mid;
    }
    const anchor = lo > 0 ? matched[lo - 1][1] + 1 : 0;
    entries.push({
      block: {
        type: 'deleted',
        elementType: a[ai].type,
        sceneHeading: scenesA[ai] || null,
        oldText: a[ai].text,
        newText: null,
        oldIndex: ai,
        newIndex: -1,
        wordDiffs: null,
      },
      key: anchor,
      rank: -1,
    });
    if (scenesA[ai]) scenesChanged.add(scenesA[ai]);
  }

  for (const bi of added) {
    entries.push({
      block: {
        type: 'added',
        elementType: b[bi].type,
        sceneHeading: scenesB[bi] || null,
        oldText: null,
        newText: b[bi].text,
        oldIndex: -1,
        newIndex: bi,
        wordDiffs: null,
      },
      key: bi,
      rank: 0,
    });
    if (scenesB[bi]) scenesChanged.add(scenesB[bi]);
  }

  entries.sort((x, y) =>
    x.key - y.key
    || x.rank - y.rank
    || x.block.oldIndex - y.block.oldIndex);

  // Dialogue moved or rewritten is neither new speech nor lost speech; only
  // whole lines added or deleted count.
  const dialogueByChar = new Map<string, { added: number; removed: number }>();
  const countDialogue = (character: string | null, side: 'added' | 'removed') => {
    if (!character) return;
    const rec = dialogueByChar.get(character) || { added: 0, removed: 0 };
    rec[side]++;
    dialogueByChar.set(character, rec);
  };
  for (const ai of removed) {
    if (a[ai].type === 'dialogue') countDialogue(charactersA[ai], 'removed');
  }
  for (const bi of added) {
    if (b[bi].type === 'dialogue') countDialogue(charactersB[bi], 'added');
  }

  return {
    blocks: entries.map((entry) => entry.block),
    summary: {
      totalAdded: added.length,
      totalDeleted: removed.length,
      totalModified,
      totalMoved: moved.length,
      scenesChanged: Array.from(scenesChanged),
      dialogueDelta: Array.from(dialogueByChar.entries()).map(([character, v]) => ({
        character, added: v.added, removed: v.removed,
      })),
    },
  };
}
