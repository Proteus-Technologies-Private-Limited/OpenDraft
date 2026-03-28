import { Editor } from '@tiptap/core';

/**
 * Reorder scenes in the ProseMirror document.
 *
 * A "scene" is defined as a sceneHeading node followed by all subsequent
 * top-level nodes until the next sceneHeading (or end of document).
 *
 * This function cuts the source scene's nodes from the document and inserts
 * them at the target scene's position, using a single ProseMirror transaction
 * so it appears as one undo step.
 *
 * @param editor  TipTap editor instance
 * @param fromIndex  source scene index (0-based)
 * @param toIndex    target scene index (0-based)
 * @returns true if the reorder was applied, false otherwise
 */
export function reorderScene(
  editor: Editor,
  fromIndex: number,
  toIndex: number,
): boolean {
  if (fromIndex === toIndex) return false;

  const { state } = editor;
  const { doc } = state;

  // 1. Collect scene boundaries as arrays of child-node indices.
  //    Each scene starts with a sceneHeading and includes every subsequent
  //    child node until the next sceneHeading.
  const scenes: number[][] = [];
  let currentScene: number[] = [];

  doc.forEach((_node, _offset, index) => {
    if (_node.type.name === 'sceneHeading') {
      if (currentScene.length > 0) {
        scenes.push(currentScene);
      }
      currentScene = [index];
    } else {
      currentScene.push(index);
    }
  });
  if (currentScene.length > 0) {
    scenes.push(currentScene);
  }

  // Validate indices
  if (
    fromIndex < 0 ||
    fromIndex >= scenes.length ||
    toIndex < 0 ||
    toIndex >= scenes.length
  ) {
    return false;
  }

  // 2. Convert child indices to absolute document positions.
  //    In ProseMirror, the doc node itself occupies position 0 (its opening
  //    token). Top-level children start at position 1. Each child node
  //    occupies (node.nodeSize) positions. So child i starts at:
  //      1 + sum(doc.child(j).nodeSize for j in 0..i-1)
  //    and ends at start + node.nodeSize.

  const childCount = doc.childCount;
  const childPositions: { start: number; end: number }[] = [];
  let pos = 0; // offset within doc.content (0-based, relative to doc open)
  for (let i = 0; i < childCount; i++) {
    const child = doc.child(i);
    // Absolute position = offset + 1 (for the doc opening token)
    // But for tr.delete / tr.insert we work with absolute positions.
    // doc.content starts at position 1 (after doc open token).
    // So child i absolute start = 1 + pos
    childPositions.push({
      start: pos,       // offset within doc.content
      end: pos + child.nodeSize,
    });
    pos += child.nodeSize;
  }

  // Scene range in terms of doc.content offsets
  const sourceIndices = scenes[fromIndex];
  const firstSourceChild = sourceIndices[0];
  const lastSourceChild = sourceIndices[sourceIndices.length - 1];
  const sourceStart = childPositions[firstSourceChild].start; // content offset
  const sourceEnd = childPositions[lastSourceChild].end;       // content offset

  const targetIndices = scenes[toIndex];
  const firstTargetChild = targetIndices[0];
  const lastTargetChild = targetIndices[targetIndices.length - 1];
  const targetStart = childPositions[firstTargetChild].start;
  const targetEnd = childPositions[lastTargetChild].end;

  // 3. Extract the source scene content as a Slice (using absolute positions).
  //    Absolute position = content offset + 1 (for doc open token).
  const absSourceStart = sourceStart + 1;
  const absSourceEnd = sourceEnd + 1;

  const slice = doc.slice(absSourceStart, absSourceEnd);

  // 4. Build transaction: delete source, insert at target.
  //    We must be careful about order of operations since positions shift
  //    after delete. Work from high positions to low to avoid remapping,
  //    OR use tr.mapping to remap.

  const tr = state.tr;

  if (fromIndex < toIndex) {
    // Moving scene downward: insert after target scene, then delete source.
    // Insert position = absolute position right after the target scene's last node.
    const absTargetEnd = targetEnd + 1;
    tr.insert(absTargetEnd, slice.content);
    // Now delete the source (its positions haven't shifted because we inserted
    // AFTER it, so positions before the insert point are unchanged).
    tr.delete(absSourceStart, absSourceEnd);
  } else {
    // Moving scene upward: delete source first, then insert at target start.
    tr.delete(absSourceStart, absSourceEnd);
    // After deletion, the target position may have shifted. Use mapping.
    const absTargetStart = targetStart + 1;
    const mappedTargetStart = tr.mapping.map(absTargetStart);
    tr.insert(mappedTargetStart, slice.content);
  }

  editor.view.dispatch(tr);
  return true;
}
