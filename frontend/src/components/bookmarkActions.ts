/**
 * Bookmark actions shared by the Edit menu, the context menu, the Navigator
 * and Go to Page.
 */
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { bookmarkTargetAt, setBookmark, suggestBookmarkName } from '../utils/bookmarks';
import { showToast } from './Toast';

/** Put the caret on a bookmarked element and scroll it a third of the way down the view. */
export function goToBookmark(editor: Editor, pos: number): void {
  const at = Math.min(pos + 1, editor.state.doc.content.size);
  editor.chain().focus().setTextSelection(at).run();
  requestAnimationFrame(() => {
    const coords = editor.view.coordsAtPos(at);
    const editorMain = document.querySelector('.editor-main');
    if (!editorMain || !coords) return;
    const rect = editorMain.getBoundingClientRect();
    editorMain.scrollTo({ top: editorMain.scrollTop + (coords.top - rect.top) - rect.height / 3, behavior: 'auto' });
  });
}

/**
 * Open the name dialog for the element at the caret: Add for an unmarked
 * element, Rename for one that already carries a bookmark.
 */
export function editBookmarkAtSelection(editor: Editor): void {
  const target = bookmarkTargetAt(editor.state.doc, editor.state.selection.from);
  if (!target) {
    showToast('Place the cursor in a script element to bookmark it.', 'info');
    return;
  }
  const existing = target.node.attrs.bookmark as string | null;
  useEditorStore.getState().setBookmarkEditing({
    pos: target.pos,
    name: existing || suggestBookmarkName(editor.state.doc, target.node),
    isNew: !existing,
  });
}

/** Clear the bookmark on the element at `pos`. One undo step. */
export function removeBookmark(editor: Editor, pos: number): void {
  const tr = editor.state.tr;
  if (setBookmark(tr, pos, null) && tr.docChanged) editor.view.dispatch(tr);
}
