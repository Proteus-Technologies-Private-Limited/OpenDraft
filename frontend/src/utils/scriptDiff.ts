/**
 * Screenplay-aware diff between two TipTap documents. Operates at node level
 * (scene heading, action, dialogue, etc.) rather than line/character level, so
 * changes are shown in terms of screenplay elements.
 */
import type { JSONContent } from '@tiptap/react';

export type ChangeType = 'added' | 'deleted' | 'modified' | 'unchanged';

export interface DiffBlock {
  type: ChangeType;
  elementType: string;           // e.g. sceneHeading, action, dialogue, character
  sceneHeading: string | null;   // scene that this block belongs to
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
  scenesChanged: string[];
  dialogueDelta: Array<{ character: string; added: number; removed: number }>;
}

export interface ScriptDiffResult {
  blocks: DiffBlock[];
  summary: DiffSummary;
}

function getText(node: JSONContent): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(getText).join('');
}

function flattenBlocks(doc: JSONContent): Array<{ type: string; text: string }> {
  const blocks: Array<{ type: string; text: string }> = [];
  for (const child of doc.content || []) {
    blocks.push({
      type: child.type || 'unknown',
      text: getText(child).trim(),
    });
  }
  return blocks;
}

/** Longest-common-subsequence-based matching. Returns the LCS table. */
function computeLCS(a: Array<{ type: string; text: string }>, b: Array<{ type: string; text: string }>): number[][] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1].type === b[j - 1].type && a[i - 1].text === b[j - 1].text) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

/** Word-level diff between two strings. */
function diffWords(a: string, b: string): WordDiff[] {
  const aWords = a.split(/(\s+)/);
  const bWords = b.split(/(\s+)/);
  const n = aWords.length;
  const m = bWords.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
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

/** Simple heuristic to decide if two blocks of the same type are "similar enough"
 *  to be treated as a modification rather than delete+add. */
function isLikelyModification(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aTokens = new Set(a.toLowerCase().split(/\s+/));
  const bTokens = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...aTokens].filter((t) => bTokens.has(t)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  if (union === 0) return false;
  return intersection / union >= 0.4;
}

export function computeScriptDiff(docA: JSONContent, docB: JSONContent): ScriptDiffResult {
  const aBlocks = flattenBlocks(docA);
  const bBlocks = flattenBlocks(docB);
  const dp = computeLCS(aBlocks, bBlocks);

  const blocks: DiffBlock[] = [];
  let currentScene: string | null = null;
  const scenesChanged = new Set<string>();
  let totalAdded = 0, totalDeleted = 0, totalModified = 0;
  const dialogueByChar = new Map<string, { added: number; removed: number }>();
  let pendingCharacter: string | null = null;

  // Walk backwards through LCS to produce the sequence
  type Step = { kind: 'same' | 'add' | 'remove'; aIdx: number; bIdx: number };
  const steps: Step[] = [];
  let i = aBlocks.length, j = bBlocks.length;
  while (i > 0 && j > 0) {
    if (aBlocks[i - 1].type === bBlocks[j - 1].type && aBlocks[i - 1].text === bBlocks[j - 1].text) {
      steps.unshift({ kind: 'same', aIdx: i - 1, bIdx: j - 1 });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      steps.unshift({ kind: 'remove', aIdx: i - 1, bIdx: -1 });
      i--;
    } else {
      steps.unshift({ kind: 'add', aIdx: -1, bIdx: j - 1 });
      j--;
    }
  }
  while (i > 0) { steps.unshift({ kind: 'remove', aIdx: i - 1, bIdx: -1 }); i--; }
  while (j > 0) { steps.unshift({ kind: 'add', aIdx: -1, bIdx: j - 1 }); j--; }

  // Combine adjacent add/remove pairs of the same element type into modifications
  for (let s = 0; s < steps.length; s++) {
    const step = steps[s];
    if (step.kind === 'remove' && s + 1 < steps.length) {
      const next = steps[s + 1];
      if (next.kind === 'add') {
        const a = aBlocks[step.aIdx];
        const b = bBlocks[next.bIdx];
        if (a.type === b.type && isLikelyModification(a.text, b.text)) {
          // Track scene context
          if (a.type === 'sceneHeading') currentScene = b.text;
          blocks.push({
            type: 'modified',
            elementType: a.type,
            sceneHeading: currentScene,
            oldText: a.text,
            newText: b.text,
            oldIndex: step.aIdx,
            newIndex: next.bIdx,
            wordDiffs: diffWords(a.text, b.text),
          });
          if (currentScene) scenesChanged.add(currentScene);
          totalModified++;
          s++;  // consume the pair
          continue;
        }
      }
    }

    if (step.kind === 'same') {
      const a = aBlocks[step.aIdx];
      if (a.type === 'sceneHeading') currentScene = a.text;
      if (a.type === 'character') pendingCharacter = a.text;
      blocks.push({
        type: 'unchanged',
        elementType: a.type,
        sceneHeading: currentScene,
        oldText: a.text,
        newText: a.text,
        oldIndex: step.aIdx,
        newIndex: step.bIdx,
        wordDiffs: null,
      });
    } else if (step.kind === 'remove') {
      const a = aBlocks[step.aIdx];
      if (a.type === 'sceneHeading') currentScene = a.text;
      if (a.type === 'character') pendingCharacter = a.text;
      if (a.type === 'dialogue' && pendingCharacter) {
        const rec = dialogueByChar.get(pendingCharacter) || { added: 0, removed: 0 };
        rec.removed++;
        dialogueByChar.set(pendingCharacter, rec);
      }
      blocks.push({
        type: 'deleted',
        elementType: a.type,
        sceneHeading: currentScene,
        oldText: a.text,
        newText: null,
        oldIndex: step.aIdx,
        newIndex: -1,
        wordDiffs: null,
      });
      if (currentScene) scenesChanged.add(currentScene);
      totalDeleted++;
    } else {
      const b = bBlocks[step.bIdx];
      if (b.type === 'sceneHeading') currentScene = b.text;
      if (b.type === 'character') pendingCharacter = b.text;
      if (b.type === 'dialogue' && pendingCharacter) {
        const rec = dialogueByChar.get(pendingCharacter) || { added: 0, removed: 0 };
        rec.added++;
        dialogueByChar.set(pendingCharacter, rec);
      }
      blocks.push({
        type: 'added',
        elementType: b.type,
        sceneHeading: currentScene,
        oldText: null,
        newText: b.text,
        oldIndex: -1,
        newIndex: step.bIdx,
        wordDiffs: null,
      });
      if (currentScene) scenesChanged.add(currentScene);
      totalAdded++;
    }
  }

  return {
    blocks,
    summary: {
      totalAdded,
      totalDeleted,
      totalModified,
      scenesChanged: Array.from(scenesChanged),
      dialogueDelta: Array.from(dialogueByChar.entries()).map(([character, v]) => ({
        character, added: v.added, removed: v.removed,
      })),
    },
  };
}
