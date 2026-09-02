/**
 * Changing the case of a selection without changing anything else.
 *
 * The obvious implementation — read the selection as a string, upper-case it,
 * write it back over the range — destroys the document. `insertText` over a
 * multi-block range replaces the block boundaries too, so several selected
 * lines came back as one, and the inserted plain text carried none of the marks
 * the original had: bold, italic, script notes and revision highlights all went
 * with it.
 *
 * Each text node is rewritten where it sits instead. Block structure is never
 * part of the replaced range, and each piece is re-created with the marks it
 * already had.
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

/**
 * Whether a selection should be raised to capitals or dropped out of them.
 * Already all-caps means the writer is toggling it back off.
 */
export function shouldUpperCase(text: string): boolean {
  return text !== text.toUpperCase();
}

/**
 * Rewrites the case of every text node between `from` and `to`. Returns whether
 * anything changed, so a caller can leave the document untouched when nothing
 * would move — an all-digit selection, say.
 */
export function applyCaseToRange(
  tr: Transaction,
  doc: PMNode,
  from: number,
  to: number,
  upper: boolean,
): boolean {
  let changed = false;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !node.text) return true;
    // Only the part of this text node that is actually selected.
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    if (start >= end) return true;
    const slice = node.text.slice(start - pos, end - pos);
    const next = upper ? slice.toUpperCase() : slice.toLowerCase();
    if (next === slice) return true;
    // Mapped, because a case change is not always length-preserving — German ß
    // upper-cases to SS — and an earlier rewrite in this same pass may already
    // have shifted everything after it.
    tr.replaceWith(
      tr.mapping.map(start),
      tr.mapping.map(end),
      tr.doc.type.schema.text(next, node.marks),
    );
    changed = true;
    return true;
  });
  return changed;
}
