/**
 * Where a proposal's selection is now.
 *
 * The panel captures the range when the request is sent, then follows every
 * transaction that changes the document. At Insert time the range is mapped
 * through those steps, so text typed above the proposal — or at its edges —
 * does not make it replace the wrong words.
 */
import type { Mapping } from '@tiptap/pm/transform';
import { ReplaceStep } from '@tiptap/pm/transform';

export interface ProposedSelection {
  from: number;
  to: number;
  mapping: Mapping;
}

/**
 * The range, mapped and clamped to the document, or null when the text it
 * pointed at is gone.
 *
 * The start is mapped with assoc `1` and the end with `-1`: typing exactly at
 * an edge stays outside the replacement, which is what the writer meant by
 * putting the caret there. `mapResult` also says whether an end was deleted:
 * a collaborator replacing the document, or the writer deleting the selected
 * words, must discard the proposal instead of collapsing it onto the caret.
 */
export function mappedSelection(
  selection: ProposedSelection,
  docSize: number,
): { from: number; to: number } | null {
  const start = selection.mapping.mapResult(selection.from, 1);
  const end = selection.mapping.mapResult(selection.to, -1);
  // The token on the queried side of either end was removed: a collaborator
  // replaced the document, or the writer deleted words the proposal covered.
  // The mapped positions may still look valid, so this has to be checked
  // before using them.
  if (start.deleted || end.deleted) return null;
  // A replacement maps the start after the end; a deletion maps both onto the
  // same point. Either way a non-empty selection has nothing left to replace.
  if (selection.from !== selection.to && start.pos >= end.pos) return null;
  const from = Math.min(Math.max(0, start.pos), docSize);
  const to = Math.min(Math.max(0, end.pos), docSize);
  return { from, to: Math.max(from, to) };
}

/**
 * Whether a transaction means the proposal can no longer land on the words it
 * was written for.
 *
 * y-prosemirror applies remote changes and Yjs undo as one whole-document
 * replace, and a script switch does the same through `setContent`. Both are
 * flagged here, so the panel can drop the proposal instead of appending it at
 * the end after the mapping collapses.
 */
export function discardsProposal(transaction: {
  before: { content: { size: number } };
  steps: readonly unknown[];
  getMeta: (key: string) => unknown;
}): boolean {
  const remote = (transaction.getMeta('y-sync$') as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
  if (remote) return true;
  return transaction.steps.some((step) => step instanceof ReplaceStep
    && step.from === 0
    && step.to === transaction.before.content.size);
}
