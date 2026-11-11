import type { JSONContent } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';

interface NoteMark { type: string | { name: string }; attrs?: Record<string, unknown> }
export interface NoteAnchor {
  nodeIndex: number;
  /** Exact editor position when collecting from a ProseMirror document. */
  position: number | null;
}

/** First mark for every note, including nonprinting blocks and nested content.
 * Reports use the top-level index; editor navigation uses the immutable PM position. */
export function noteAnchors(doc: JSONContent | PmNode): Map<string, NoteAnchor> {
  const found = new Map<string, NoteAnchor>();
  const collect = (marks: readonly NoteMark[] | undefined, nodeIndex: number, position: number | null) => {
    for (const mark of marks ?? []) {
      const type = typeof mark.type === 'string' ? mark.type : mark.type.name;
      const id = type === 'scriptNote' ? mark.attrs?.noteId : null;
      if (typeof id === 'string' && !found.has(id)) found.set(id, { nodeIndex, position });
    }
  };
  if ('descendants' in doc) {
    (doc as PmNode).forEach((node, offset, index) => {
      collect(node.marks, index, offset);
      node.descendants((child, position) => { collect(child.marks, index, offset + 1 + position); });
    });
  } else {
    const visit = (node: JSONContent, index: number) => {
      collect(node.marks, index, null);
      for (const child of node.content ?? []) visit(child, index);
    };
    (doc.content ?? []).forEach(visit);
  }
  return found;
}
