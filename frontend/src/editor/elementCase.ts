/**
 * The elements the page prints in capitals — scene headings, character cues,
 * transitions and the other FDX styles that capitalise their text — and the
 * transaction that puts their stored text in capitals too.
 *
 * The stylesheet draws these elements in capitals, so a heading typed in lower
 * case looked right in the editor while every reader of the raw text saw the
 * lower case the writer happened to type: the scene navigator, FDX and Word
 * exports, the location database. Normalising the stored text keeps them in
 * step. It happens when the writer leaves the line (editor/extensions/
 * AutoUppercase), not under the caret.
 *
 * Pure, so it can be tested against the real test schema without an editor.
 */
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { applyCaseToRange } from './caseTransform';

/** The element types whose text is printed in capitals. */
export const UPPERCASE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'sceneHeading', 'character', 'transition', 'shot', 'newAct', 'endOfAct', 'castList',
]);

export function isUppercaseElement(type: string): boolean {
  return UPPERCASE_ELEMENT_TYPES.has(type);
}

/** The position of the text block the selection is in, or null. */
export function blockPosition(state: EditorState): number | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).isTextblock) return $from.before(depth);
  }
  return null;
}

/**
 * A transaction that raises a block's text to capitals, or null when the block
 * is missing, is not one of the capitals elements, or is already in capitals.
 */
export function uppercaseBlockTransaction(state: EditorState, pos: number): Transaction | null {
  // A position from a stale selection can fall outside a document that has
  // since shrunk; nodeAt throws there rather than returning null.
  if (pos < 0 || pos > state.doc.content.size) return null;
  const node = state.doc.nodeAt(pos);
  if (!node || !node.isTextblock || !isUppercaseElement(node.type.name)) return null;
  if (node.textContent === node.textContent.toUpperCase()) return null;
  const from = pos + 1;
  const to = pos + node.nodeSize - 1;
  if (from >= to) return null;
  const tr = state.tr;
  if (!applyCaseToRange(tr, state.doc, from, to, true)) return null;
  // Automatic normalisation is not an edit the writer made: it must not
  // become a history entry of its own.
  tr.setMeta('addToHistory', false);
  return tr;
}
