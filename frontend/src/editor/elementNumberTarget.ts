import type { Node as PmNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { collectNumberedElements } from './extensions/ElementNumbers';

export interface ElementNumberTarget {
  position: number;
  node: PmNode;
}

/** Follow the reference being edited without relying on immutable node identity. */
export function mapElementNumberTarget(
  target: ElementNumberTarget,
  tr: Transaction,
): ElementNumberTarget | null {
  if (target.position < 0) return null;
  const id = target.node.attrs.elementNumberId;
  let position: number;
  if (id) {
    // Yjs can replace the entire ProseMirror document, so a position mapping
    // alone is insufficient. Stored production references have stable IDs.
    const matches = collectNumberedElements(tr.doc).filter(
      (entry) => entry.node.attrs.elementNumberId === id,
    );
    if (matches.length !== 1) return null;
    position = matches[0].from;
  } else {
    const mapped = tr.mapping.mapResult(target.position, 1);
    if (mapped.deleted) return null;
    position = mapped.pos;
  }
  const node = tr.doc.nodeAt(position);
  // Do not overwrite a concurrent number edit or a replacement paragraph.
  if (
    !node ||
    node.type !== target.node.type ||
    node.attrs.elementNumber !== target.node.attrs.elementNumber
  )
    return null;
  return { position, node };
}
