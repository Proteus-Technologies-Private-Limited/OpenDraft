import type { Editor } from '@tiptap/core';
import type { EditorState, Transaction } from '@tiptap/pm/state';

/**
 * Reorder scenes in the ProseMirror document.
 *
 * A "scene" starts at its sceneHeading and runs to where the next scene starts.
 * Everything before the first heading (title page, "FADE IN:", a first action)
 * is opening matter, not scene 0, and never moves. An act break written just
 * before a heading belongs to the scene it opens, so it moves with that scene
 * and not with the one before it.
 *
 * The work is done in a single transaction, so it is one undo step.
 */

/** Where each scene starts, as a top-level child index. */
function sceneStarts(doc: EditorState['doc']): number[] {
  const starts: number[] = [];
  doc.forEach((node, _offset, index) => {
    if (node.type.name !== 'sceneHeading') return;
    let start = index;
    while (start > 0 && doc.child(start - 1).type.name === 'newAct') start -= 1;
    starts.push(start);
  });
  return starts;
}

/** Child-index boundaries of one scene: [start, end). */
function sceneRange(starts: number[], index: number, childCount: number): { start: number; end: number } {
  return {
    start: starts[index],
    end: index + 1 < starts.length ? starts[index + 1] : childCount,
  };
}

/**
 * The transaction that moves scene `fromIndex` to `toIndex`, or null when the
 * indices do not name two different scenes.
 */
export function reorderSceneTransaction(
  state: EditorState,
  fromIndex: number,
  toIndex: number,
): Transaction | null {
  if (fromIndex === toIndex) return null;

  const { doc } = state;
  const starts = sceneStarts(doc);
  if (
    fromIndex < 0 || fromIndex >= starts.length
    || toIndex < 0 || toIndex >= starts.length
  ) {
    return null;
  }

  const childCount = doc.childCount;
  const childPositions: { start: number; end: number }[] = [];
  let offset = 0;
  for (let i = 0; i < childCount; i++) {
    const child = doc.child(i);
    childPositions.push({ start: offset, end: offset + child.nodeSize });
    offset += child.nodeSize;
  }

  const source = sceneRange(starts, fromIndex, childCount);
  const target = sceneRange(starts, toIndex, childCount);
  // Child offsets within doc.content are already absolute positions: the first
  // top-level block starts at 0, and the end of the last block is content.size.
  const sourceStart = childPositions[source.start].start;
  const sourceEnd = childPositions[source.end - 1].end;
  const targetStart = childPositions[target.start].start;
  const targetEnd = childPositions[target.end - 1].end;

  const slice = doc.slice(sourceStart, sourceEnd);
  const tr = state.tr;

  if (fromIndex < toIndex) {
    // Moving down: insert after the target scene first; the source positions
    // are before that insertion point, so they do not shift.
    tr.insert(targetEnd, slice.content);
    tr.delete(sourceStart, sourceEnd);
  } else {
    // Moving up: delete the source first, then insert where the target now is.
    tr.delete(sourceStart, sourceEnd);
    tr.insert(tr.mapping.map(targetStart), slice.content);
  }

  return tr;
}

/**
 * Reorder scenes in a live TipTap editor.
 *
 * @param editor  TipTap editor instance
 * @param fromIndex  source scene index (0-based, among scene headings)
 * @param toIndex    target scene index (0-based, among scene headings)
 * @returns true if the reorder was applied, false otherwise
 */
export function reorderScene(
  editor: Editor,
  fromIndex: number,
  toIndex: number,
): boolean {
  const tr = reorderSceneTransaction(editor.state, fromIndex, toIndex);
  if (!tr) return false;
  editor.view.dispatch(tr);
  return true;
}
