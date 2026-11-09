import { useEditorState, type Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * Re-renders the caller after every transaction `editor` dispatches, while
 * `enabled`. For components that read editor state (the selection, active
 * marks, the document) while rendering.
 *
 * The screenplay editor does not re-render on transactions itself: that
 * re-rendered the whole editor screen, menu bar included, for every key
 * pressed (issue #229). Each component that needs the live state subscribes
 * here instead, and only while it is showing.
 */
export function useEditorTransactions(editor: Editor | null | undefined, enabled = true): void {
  useEditorState({
    editor: editor ?? null,
    selector: ({ transactionNumber }) => (enabled ? transactionNumber : -1),
  });
}

/**
 * The editor's document while `enabled`, else null. Re-renders the caller when
 * the document changes, and not for a selection that moves over it.
 */
export function useEditorDoc(editor: Editor | null | undefined, enabled = true): PMNode | null {
  return useEditorState({
    editor: editor ?? null,
    selector: ({ editor: ed }) => (enabled && ed ? ed.state.doc : null),
    equalityFn: Object.is,
  });
}
