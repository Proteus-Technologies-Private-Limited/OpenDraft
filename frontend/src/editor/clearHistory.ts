import type { Editor } from '@tiptap/react';

/**
 * Clear the editor's undo/redo history.
 *
 * Call this after setContent when opening, importing, or creating a new document
 * so the user cannot undo past the point of loading.
 *
 * Works by finding the prosemirror-history plugin and replacing its state
 * with a fresh empty state (no undo/redo entries).
 */
export function clearEditorHistory(editor: Editor): void {
  try {
    // Find the prosemirror-history plugin by its key prefix
    const histPlugin = editor.state.plugins.find(
      p => (p as any).key?.startsWith?.('history$'),
    );
    if (!histPlugin?.spec?.state) return;
    // Create a fresh empty history state (empty undo/redo stacks)
    const initFn = histPlugin.spec.state.init as (...args: any[]) => any;
    const freshState = initFn({}, editor.state);
    if (!freshState) return;
    // prosemirror-history expects: tr.getMeta(historyKey).historyState
    const tr = editor.state.tr;
    tr.setMeta(histPlugin, { historyState: freshState });
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  } catch (e) {
    console.warn('clearEditorHistory failed:', e);
  }
}
