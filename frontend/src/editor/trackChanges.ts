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

// ── Positioned tokens for cluster-level diff ────────────────────────────

// Sentinel used to mark block boundaries inside a tokenised cluster.  It
// must never occur in real content; we use a private-use codepoint.
const BLOCK_BREAK = '\uE000__BLOCK_BREAK__\uE000';

interface CurrToken {
  text: string;
  docFrom: number;
  docTo: number;
  isBreak: boolean;
}

function tokenizeBaseCluster(
  baseBlocks: TextBlock[],
  deletedIndices: number[],
): string[] {
  const tokens: string[] = [];
  deletedIndices.forEach((idx, i) => {
    if (i > 0) tokens.push(BLOCK_BREAK);
    const blockTokens = tokenize(baseBlocks[idx].text);
    for (const t of blockTokens) tokens.push(t);
  });
  return tokens;
}

function tokenizeCurrCluster(
  currBlocks: DocBlock[],
  insertedIndices: number[],
): CurrToken[] {
  const tokens: CurrToken[] = [];
  insertedIndices.forEach((idx, i) => {
    const block = currBlocks[idx];
    if (i > 0) {
      const prev = currBlocks[insertedIndices[i - 1]];
      const breakPos = prev.nodeOffset + prev.nodeSize;
      tokens.push({
        text: BLOCK_BREAK,
        docFrom: breakPos,
        docTo: breakPos,
        isBreak: true,
      });
    }
    const blockTokens = tokenize(block.text);
    let offset = 0;
    for (const t of blockTokens) {
      tokens.push({
        text: t,
        docFrom: block.from + offset,
        docTo: block.from + offset + t.length,
        isBreak: false,
      });
      offset += t.length;
    }
  });
  return tokens;
}

// Fraction of non-trivial base tokens that must reappear in the inserted
// content for a multi-block cluster to be treated as "related" and
// token-diffed.  Below this, the cluster is rendered as independent
// deletions and insertions — safer than letting an LCS align unrelated
// paragraphs through their shared whitespace.
const CLUSTER_OVERLAP_THRESHOLD = 0.3;

function hasSignificantOverlap(
  baseTokens: string[],
  currTokens: CurrToken[],
): boolean {
  const currSet = new Set<string>();
  for (const t of currTokens) {
    if (t.isBreak) continue;
    if (t.text.trim() === '') continue;
    currSet.add(t.text);
  }
  let matched = 0;
  let total = 0;
  for (const t of baseTokens) {
    if (t === BLOCK_BREAK) continue;
    if (t.trim() === '') continue;
    total++;
    if (currSet.has(t)) matched++;
  }
  if (total === 0) return false;
  return matched / total >= CLUSTER_OVERLAP_THRESHOLD;
}

// Render each base block as a standalone deletion widget and each curr
// block as a full-block insertion — used when a cluster's deletes and
// inserts are substantively unrelated (e.g. the user deleted one
// paragraph and typed several unrelated ones nearby).
function renderClusterIndependently(
  baseBlocks: TextBlock[],
  deletedIndices: number[],
  currBlocks: DocBlock[],
  insertedIndices: number[],
  deletionPos: number,
  decorations: Decoration[],
): void {
  for (const idx of insertedIndices) {
    const curr = currBlocks[idx];
    if (curr.to > curr.from) {
      decorations.push(
        Decoration.inline(curr.from, curr.to, {
          class: 'track-change-inserted',
        }),
      );
    }
  }
  for (const idx of deletedIndices) {
    const base = baseBlocks[idx];
    if (base.text) {
      const text = base.text;
      const type = base.type;
      decorations.push(
        Decoration.widget(
          deletionPos,
          () => createDeletedBlock(text, type),
          { side: -1 },
        ),
      );
    }
  }
}

// Diff a cluster of adjacent deleted+inserted blocks using token-level LCS
// with a sentinel for block boundaries.  This correctly handles splits,
// joins, and in-place edits without marking unchanged text as inserted or
// deleted merely because a paragraph break moved.
function diffCluster(
  baseBlocks: TextBlock[],
  deletedIndices: number[],
  currBlocks: DocBlock[],
  insertedIndices: number[],
  fallbackWidgetPos: number,
  decorations: Decoration[],
): void {
  // Pure insertion — everything in the inserted blocks is new.
  if (deletedIndices.length === 0) {
    renderClusterIndependently(
      baseBlocks,
      deletedIndices,
      currBlocks,
      insertedIndices,
      fallbackWidgetPos,
      decorations,
    );
    return;
  }

  // Pure deletion — render each vanished block as a standalone widget at
  // the position where they used to live (right before the next equal
  // block, or end of doc if the deletion trails the document).
  if (insertedIndices.length === 0) {
    renderClusterIndependently(
      baseBlocks,
      deletedIndices,
      currBlocks,
      insertedIndices,
      fallbackWidgetPos,
      decorations,
    );
    return;
  }

  const baseTokens = tokenizeBaseCluster(baseBlocks, deletedIndices);
  const currTokens = tokenizeCurrCluster(currBlocks, insertedIndices);

  // Multi-block clusters of substantively unrelated content (e.g. user
  // deleted one paragraph and typed several unrelated paragraphs nearby)
  // must not be token-diffed — the LCS would align them through shared
  // whitespace and interleave words from unrelated blocks.  Fall back to
  // independent rendering for such clusters.
  const isMultiBlock =
    deletedIndices.length > 1 || insertedIndices.length > 1;
  if (isMultiBlock && !hasSignificantOverlap(baseTokens, currTokens)) {
    renderClusterIndependently(
      baseBlocks,
      deletedIndices,
      currBlocks,
      insertedIndices,
      fallbackWidgetPos,
      decorations,
    );
    return;
  }

  const currTexts = currTokens.map((t) => t.text);
  const ops = diffSequences(baseTokens, currTexts);

  let pendingDeleted = '';
  let pendingDeletedPos =
    currTokens.length > 0 ? currTokens[0].docFrom : fallbackWidgetPos;

  const flush = () => {
    if (pendingDeleted) {
      const text = pendingDeleted;
      const pos = pendingDeletedPos;
      decorations.push(
        Decoration.widget(pos, () => createDeletedSpan(text), { side: -1 }),
      );
      pendingDeleted = '';
    }
  };

  for (const op of ops) {
    if (op.type === 'equal') {
      flush();
      const token = currTokens[op.newIdx];
      pendingDeletedPos = token.docTo;
    } else if (op.type === 'insert') {
      flush();
      const token = currTokens[op.newIdx];
      if (!token.isBreak && token.docTo > token.docFrom) {
        decorations.push(
          Decoration.inline(token.docFrom, token.docTo, {
            class: 'track-change-inserted',
          }),
        );
      }
      pendingDeletedPos = token.docTo;
    } else if (op.type === 'delete') {
      const text = baseTokens[op.oldIdx];
      // A deleted BLOCK_BREAK means two blocks were joined — the break
      // itself has no visible content to strike through, so we skip it.
      if (text !== BLOCK_BREAK) {
        pendingDeleted += text;
      }
    }
  }
  flush();
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

  // Block-level diff on text content — this is still coarse-grained, but
  // we refine any non-equal cluster with a token-level diff that preserves
  // content that moved across a paragraph split/join.
  const baseTexts = baseBlocks.map((b) => b.text);
  const currTexts = currBlocks.map((b) => b.text);
  const nodeOps = diffSequences(baseTexts, currTexts);

  const decorations: Decoration[] = [];
  // Position where a pure-deletion cluster's widgets should be rendered.
  // Initialised to 0 (doc start) and updated whenever we cross an equal
  // block.  For clusters that contain inserts this is unused — those
  // clusters compute positions from the inserted tokens themselves.
  let deletionAnchor = 0;

  let i = 0;
  while (i < nodeOps.length) {
    const op = nodeOps[i];
    if (op.type === 'equal') {
      const curr = currBlocks[op.newIdx];
      deletionAnchor = curr.nodeOffset + curr.nodeSize;
      i++;
      continue;
    }

    // Collect consecutive non-equal ops into a cluster
    const deletedIndices: number[] = [];
    const insertedIndices: number[] = [];
    while (i < nodeOps.length && nodeOps[i].type !== 'equal') {
      const clusterOp = nodeOps[i];
      if (clusterOp.type === 'delete') {
        deletedIndices.push(clusterOp.oldIdx);
      } else if (clusterOp.type === 'insert') {
        insertedIndices.push(clusterOp.newIdx);
      }
      i++;
    }

    // Anchor deletion widgets at the start of the next equal block when
    // one exists — that's where the struck-through content used to live.
    // Otherwise fall back to after the last inserted block, and finally
    // to the end of the previous equal block for trailing pure deletions.
    let widgetPos = deletionAnchor;
    const nextOp = i < nodeOps.length ? nodeOps[i] : undefined;
    if (nextOp && nextOp.type === 'equal') {
      widgetPos = currBlocks[nextOp.newIdx].nodeOffset;
    } else if (insertedIndices.length > 0) {
      const lastInsert =
        currBlocks[insertedIndices[insertedIndices.length - 1]];
      widgetPos = lastInsert.nodeOffset + lastInsert.nodeSize;
    }

    diffCluster(
      baseBlocks,
      deletedIndices,
      currBlocks,
      insertedIndices,
      widgetPos,
      decorations,
    );

    // Advance the anchor past the inserted blocks so subsequent deletions
    // land after them.
    if (insertedIndices.length > 0) {
      const last = currBlocks[insertedIndices[insertedIndices.length - 1]];
      deletionAnchor = last.nodeOffset + last.nodeSize;
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
