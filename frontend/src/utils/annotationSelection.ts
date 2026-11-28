import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';

interface TextRange {
  from: number;
  to: number;
}

export interface AnnotationSelection extends TextRange {
  text: string;
}

export function annotationText(doc: PMNode, { from, to }: TextRange): string {
  return from >= 0 && from < to && to <= doc.content.size ? doc.textBetween(from, to, ' ') : '';
}

export function readAnnotationSelection(editor: Editor): AnnotationSelection | null {
  const { selection, doc } = editor.state;
  if (!editor.isEditable || selection.empty || selection instanceof NodeSelection) return null;
  const { from, to } = selection;
  const text = annotationText(doc, selection);
  return text.trim() ? { from, to, text } : null;
}

export function sceneIdAtAnnotation(doc: PMNode, from: number): string | null {
  let index = -1;
  doc.nodesBetween(0, Math.max(1, from), node => {
    if (node.type.name === 'sceneHeading') index++;
  });
  return index < 0 ? null : `scene-${index}`;
}

/** Keep the full text until the category is chosen so stale ranges can be detected. */
export function pendingTagForRange(doc: PMNode, range: TextRange) {
  const text = annotationText(doc, range);
  if (!text.trim()) return null;
  return {
    from: range.from,
    to: range.to,
    text,
    elementType: doc.resolve(Math.max(1, range.from)).parent.type.name,
    sceneId: sceneIdAtAnnotation(doc, range.from),
  };
}
