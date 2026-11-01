import { EditorState } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { resolveSuggestionsTransaction, withoutSuggestionsJSON } from './suggestions';
export type ReviewDisplay = 'markup' | 'original' | 'proposed';
/** A detached projection: the shared document, history and suggestions remain untouched. */
export function reviewProjection(doc: PmNode, mode: ReviewDisplay): PmNode {
  if (mode === 'markup') return doc;
  if (mode === 'original')
    return doc.type.schema.nodeFromJSON(withoutSuggestionsJSON(doc.toJSON()));
  const state = EditorState.create({ schema: doc.type.schema, doc });
  return resolveSuggestionsTransaction(state, () => true, true)?.doc ?? doc;
}
