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

/**
 * Whether the writer has changed anything since the document was loaded.
 *
 * Every path that puts a document into the editor — opening a script,
 * importing, the sample, a new screenplay — calls {@link clearEditorHistory}
 * straight afterwards, so an empty undo stack means "exactly as it was
 * loaded".
 *
 * This is what "unsaved work" should mean for crash recovery. Content alone is
 * not enough: opening the sample screenplay and touching nothing left a
 * document full of text that had never been saved anywhere, so every launch
 * offered to recover it (issue #68 follow-up).
 *
 * Fails towards "yes, there are edits": mistakenly keeping a snapshot costs a
 * prompt, mistakenly dropping one costs the writer's work.
 */
export function hasEditsSinceLoad(editor: Editor): boolean {
  try {
    return editor.can().undo();
  } catch (e) {
    console.warn('[editor] could not read the undo history:', e);
    return true;
  }
}
