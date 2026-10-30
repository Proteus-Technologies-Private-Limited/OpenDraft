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
  if (n > 0 && m > 0 && n * m <= MAX_ALIGN_CELLS) {
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

/** Shared words over all words (0–1), counting repeated words only as often as
 *  both texts have them. */
function similarity(a: string, b: string): number {
  const wa = a.toLowerCase().split(/\s+/).filter(Boolean);
  const wb = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (wa.length === 0 && wb.length === 0) return 1;
  if (wa.length === 0 || wb.length === 0) return 0;
  const pool = [...wb];
  let shared = 0;
  for (const word of wa) {
    const at = pool.indexOf(word);
    if (at >= 0) { pool.splice(at, 1); shared++; }
  }
  return (2 * shared) / (wa.length + wb.length);
}

/** Pair a run of removed and added indexes into modifications, in order. */
function pairRun(
  a: FlatBlock[],
  b: FlatBlock[],
  runA: number[],
  runB: number[],
): { changed: Array<[number, number]>; removed: number[]; added: number[] } {
  if (runA.length === 0) return { changed: [], removed: [], added: [...runB] };
  if (runB.length === 0) return { changed: [], removed: [...runA], added: [] };

  // Edited in place: the run is the same length and every element lines up.
  if (
    runA.length === runB.length
    && runA.every((ai, k) => a[ai].type === b[runB[k]].type)
  ) {
    return { changed: runA.map((ai, k) => [ai, runB[k]] as [number, number]), removed: [], added: [] };
  }

  // Pathological run (a whole script pasted over another): stay linear.
  if (runA.length * runB.length > MAX_PAIR_CELLS) {
    return { changed: [], removed: [...runA], added: [...runB] };
  }

  const changed: Array<[number, number]> = [];
  const removed: number[] = [];
  let nextB = 0;
  for (const ai of runA) {
    let bestK = -1;
    let bestScore = -1;
    for (let k = nextB; k < runB.length; k++) {
      const bi = runB[k];
      const exact = a[ai].text === b[bi].text;
      const score = exact ? 1 : similarity(a[ai].text, b[bi].text);
      if (score >= CHANGE_SIMILARITY && score > bestScore) {
        bestK = k;
        bestScore = score;
        if (exact) break;
      }
    }
    if (bestK >= 0) {
      changed.push([ai, runB[bestK]]);
      nextB = bestK + 1;
    } else {
      removed.push(ai);
    }
  }
  return { changed, removed, added: runB.slice(nextB) };
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
    removed.push(...paired.removed);
    added.push(...paired.added);
    prevA = ai + 1;
    prevB = bi + 1;
  }

  // Moves: a deleted paragraph whose exact text comes back elsewhere. Each
  // duplicate is used once, so two identical lines moved are two moves.
  const moved: Array<[number, number]> = [];
  for (const ai of [...removed]) {
    if (!a[ai].text.trim()) continue;
    const at = added.findIndex((bi) => sameBlock(a[ai], b[bi]));
    if (at < 0) continue;
    moved.push([ai, added[at]]);
    removed.splice(removed.indexOf(ai), 1);
    added.splice(at, 1);
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

  for (const ai of removed) {
    // The deletion belongs just after the last aligned block before it.
    let lo = 0, hi = pairs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[mid][0] < ai) lo = mid + 1;
      else hi = mid;
    }
    const anchor = lo > 0 ? pairs[lo - 1][1] + 1 : 0;
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
