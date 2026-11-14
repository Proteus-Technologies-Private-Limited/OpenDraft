import { closeHistory } from '@tiptap/pm/history';
import type { Editor } from '@tiptap/core';

/** Isolate an undo assertion from the preceding synthetic key burst. */
export function closeUndoGroup(editor: Editor): void {
  editor.view.dispatch(closeHistory(editor.state.tr));
}
