/**
 * Where a proposal's selection is now.
 *
 * The panel captures the range when the request is sent, then follows every
 * transaction that changes the document. At Insert time the range is mapped
 * through those steps, so text typed above the proposal — or at its edges —
 * does not make it replace the wrong words.
 */
import type { Mapping } from '@tiptap/pm/transform';

export interface ProposedSelection {
  from: number;
  to: number;
  mapping: Mapping;
}

/**
 * The range, mapped and clamped to the document.
 *
 * The start is mapped with assoc `1` and the end with `-1`: typing exactly at
 * an edge stays outside the replacement, which is what the writer meant by
 * putting the caret there.
 */
export function mappedSelection(
  selection: ProposedSelection,
  docSize: number,
): { from: number; to: number } {
  const from = Math.min(Math.max(0, selection.mapping.map(selection.from, 1)), docSize);
  const to = Math.min(Math.max(from, selection.mapping.map(selection.to, -1)), docSize);
  return { from, to };
}
