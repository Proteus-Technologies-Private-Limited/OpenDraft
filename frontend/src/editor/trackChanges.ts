/**
 * Track Changes plugin — compares a baseline document (from a git version)
 * against the live editor content and renders inline decorations:
 *   - Inserted text  → green highlight (Decoration.inline)
 *   - Deleted text    → red strikethrough widget (Decoration.widget, read-only)
 *   - Modified blocks → word-level diff with both insert/delete markers
 *
 * The baseline is set via a plugin meta transaction.  The plugin recomputes
 * decorations whenever the document changes.
 */

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export const trackChangesPluginKey = new PluginKey('trackChanges');

// ── Types ────────────────────────────────────────────────────────────────

interface TextBlock {
  text: string;
  type: string;
}

interface DocBlock extends TextBlock {
  from: number;      // start of text content (nodeOffset + 1)
  to: number;        // end of text content (nodeOffset + nodeSize - 1)
  nodeOffset: number; // start of the node itself
  nodeSize: number;
}

// ── Text extraction ──────────────────────────────────────────────────────

function extractBlocksFromJSON(doc: any): TextBlock[] {
  if (!doc?.content) return [];
  return doc.content.map((node: any) => ({
    text: node.content?.map((c: any) => c.text || '').join('') || '',
    type: node.type,
  }));
}

function extractBlocksFromDoc(doc: PMNode): DocBlock[] {
  const blocks: DocBlock[] = [];
  doc.forEach((node, offset) => {
    blocks.push({
      text: node.textContent,
      type: node.type.name,
      from: offset + 1,
      to: offset + node.nodeSize - 1,
      nodeOffset: offset,
      nodeSize: node.nodeSize,
    });
  });
  return blocks;
}

// ── Tokenisation ─────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  if (!text) return [];
  const tokens: string[] = [];
  const regex = /\S+|\s+/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

// ── LCS-based sequence diff ─────────────────────────────────────────────

type DiffOp =
  | { type: 'equal'; oldIdx: number; newIdx: number }
  | { type: 'insert'; newIdx: number }
  | { type: 'delete'; oldIdx: number };

function diffSequences(oldArr: string[], newArr: string[]): DiffOp[] {
  const m = oldArr.length;
  const n = newArr.length;

  // Build LCS table
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0);
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldArr[i - 1] === newArr[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldArr[i - 1] === newArr[j - 1]) {
      ops.push({ type: 'equal', oldIdx: i - 1, newIdx: j - 1 });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'insert', newIdx: j - 1 });
      j--;
    } else {
      ops.push({ type: 'delete', oldIdx: i - 1 });
      i--;
    }
  }

  return ops.reverse();
}

// ── Merge adjacent delete+insert pairs into "modified" ──────────────────

type MergedOp =
  | { type: 'equal'; oldIdx: number; newIdx: number }
  | { type: 'insert'; newIdx: number }
  | { type: 'delete'; oldIdx: number }
  | { type: 'modified'; oldIdx: number; newIdx: number };

function mergeOps(ops: DiffOp[]): MergedOp[] {
  const merged: MergedOp[] = [];
  let i = 0;

  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      merged.push(ops[i] as MergedOp);
      i++;
    } else {
      // Collect consecutive non-equal ops
      const deletes: number[] = [];
      const inserts: number[] = [];
      while (i < ops.length && ops[i].type !== 'equal') {
        if (ops[i].type === 'delete') deletes.push((ops[i] as any).oldIdx);
        if (ops[i].type === 'insert') inserts.push((ops[i] as any).newIdx);
        i++;
      }
      // Pair up as modifications
      const pairs = Math.min(deletes.length, inserts.length);
      for (let p = 0; p < pairs; p++) {
        merged.push({ type: 'modified', oldIdx: deletes[p], newIdx: inserts[p] });
      }
      for (let p = pairs; p < deletes.length; p++) {
        merged.push({ type: 'delete', oldIdx: deletes[p] });
      }
      for (let p = pairs; p < inserts.length; p++) {
        merged.push({ type: 'insert', newIdx: inserts[p] });
      }
    }
  }

  return merged;
}

// ── Word-level diff decorations within a single block ───────────────────

function generateWordDiff(
  base: TextBlock,
  curr: DocBlock,
  decorations: Decoration[],
): void {
  const baseTokens = tokenize(base.text);
  const currTokens = tokenize(curr.text);

  if (baseTokens.length === 0 && currTokens.length === 0) return;

  // If baseline is empty, everything is inserted
  if (baseTokens.length === 0) {
    if (curr.to > curr.from) {
      decorations.push(
        Decoration.inline(curr.from, curr.to, { class: 'track-change-inserted' }),
      );
    }
    return;
  }

  // If current is empty, everything is deleted
  if (currTokens.length === 0) {
    const text = base.text;
    decorations.push(
      Decoration.widget(
        curr.from,
        () => createDeletedSpan(text),
        { side: -1 },
      ),
    );
    return;
  }

  const ops = diffSequences(baseTokens, currTokens);

  let curOffset = 0;
  let pendingDeleted = '';

  for (const op of ops) {
    // Flush pending deletions before any non-delete op
    if (op.type !== 'delete' && pendingDeleted) {
      const pos = curr.from + curOffset;
      const text = pendingDeleted;
      decorations.push(
        Decoration.widget(
          pos,
          () => createDeletedSpan(text),
          { side: -1 },
        ),
      );
      pendingDeleted = '';
    }

    if (op.type === 'equal') {
      curOffset += currTokens[op.newIdx!].length;
    } else if (op.type === 'insert') {
      const token = currTokens[op.newIdx!];
      const from = curr.from + curOffset;
      const to = from + token.length;
      if (to > from) {
        decorations.push(
          Decoration.inline(from, to, { class: 'track-change-inserted' }),
        );
      }
      curOffset += token.length;
    } else if (op.type === 'delete') {
      pendingDeleted += baseTokens[op.oldIdx!];
    }
  }

  // Flush remaining deletions at end of block
  if (pendingDeleted) {
    const pos = curr.from + curOffset;
    const text = pendingDeleted;
    decorations.push(
      Decoration.widget(
        pos,
        () => createDeletedSpan(text),
        { side: -1 },
      ),
    );
  }
}

function createDeletedSpan(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'track-change-deleted';
  el.textContent = text;
  el.contentEditable = 'false';
  return el;
}

function createDeletedBlock(text: string, type: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `track-change-deleted-block track-change-deleted-${type}`;
  el.textContent = text;
  el.contentEditable = 'false';
  return el;
}

// ── Main decoration computation ─────────────────────────────────────────

function computeDecorations(
  baseBlocks: TextBlock[],
  currentDoc: PMNode,
): DecorationSet {
  const currBlocks = extractBlocksFromDoc(currentDoc);

  if (baseBlocks.length === 0 && currBlocks.length === 0) {
    return DecorationSet.empty;
  }

  // Node-level diff using text content
  const baseTexts = baseBlocks.map((b) => b.text);
  const currTexts = currBlocks.map((b) => b.text);
  const nodeOps = diffSequences(baseTexts, currTexts);
  const merged = mergeOps(nodeOps);

  const decorations: Decoration[] = [];
  // Position cursor for placing deletion widgets between nodes
  let insertionPos = 0;

  for (const op of merged) {
    if (op.type === 'equal') {
      const curr = currBlocks[op.newIdx];
      insertionPos = curr.nodeOffset + curr.nodeSize;
    } else if (op.type === 'insert') {
      const curr = currBlocks[op.newIdx];
      if (curr.to > curr.from) {
        decorations.push(
          Decoration.inline(curr.from, curr.to, {
            class: 'track-change-inserted',
          }),
        );
      }
      insertionPos = curr.nodeOffset + curr.nodeSize;
    } else if (op.type === 'delete') {
      const base = baseBlocks[op.oldIdx];
      if (base.text) {
        const text = base.text;
        const type = base.type;
        decorations.push(
          Decoration.widget(
            insertionPos,
            () => createDeletedBlock(text, type),
            { side: -1 },
          ),
        );
      }
    } else if (op.type === 'modified') {
      const base = baseBlocks[op.oldIdx];
      const curr = currBlocks[op.newIdx];
      generateWordDiff(base, curr, decorations);
      insertionPos = curr.nodeOffset + curr.nodeSize;
    }
  }

  return DecorationSet.create(currentDoc, decorations);
}

// ── Plugin ───────────────────────────────────────────────────────────────

interface TrackChangesPluginState {
  enabled: boolean;
  baseline: any | null;
  /** Pre-extracted blocks from the baseline (cached). */
  baseBlocks: TextBlock[] | null;
  decorations: DecorationSet;
}

export function createTrackChangesPlugin(): Plugin<TrackChangesPluginState> {
  return new Plugin<TrackChangesPluginState>({
    key: trackChangesPluginKey,
    state: {
      init() {
        return {
          enabled: false,
          baseline: null,
          baseBlocks: null,
          decorations: DecorationSet.empty,
        };
      },
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(trackChangesPluginKey) as
          | { enabled?: boolean; baseline?: any }
          | undefined;

        if (meta) {
          const enabled = meta.enabled ?? prev.enabled;
          const baseline =
            meta.baseline !== undefined ? meta.baseline : prev.baseline;

          if (!enabled || !baseline) {
            return {
              enabled,
              baseline,
              baseBlocks: null,
              decorations: DecorationSet.empty,
            };
          }

          // Re-extract baseline blocks only when the baseline reference changes
          const baseBlocks =
            meta.baseline !== undefined
              ? extractBlocksFromJSON(baseline)
              : prev.baseBlocks;

          const decorations = computeDecorations(baseBlocks!, newState.doc);
          return { enabled, baseline, baseBlocks, decorations };
        }

        // No meta — check if doc changed while tracking is active
        if (!prev.enabled || !prev.baseBlocks) {
          return prev;
        }

        if (tr.docChanged) {
          const decorations = computeDecorations(prev.baseBlocks, newState.doc);
          return { ...prev, decorations };
        }

        return prev;
      },
    },
    props: {
      decorations(state) {
        return (
          trackChangesPluginKey.getState(state)?.decorations ??
          DecorationSet.empty
        );
      },
    },
  });
}
