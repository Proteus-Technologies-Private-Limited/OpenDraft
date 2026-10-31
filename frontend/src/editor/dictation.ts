import type { Editor } from '@tiptap/core';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { parseDictation } from '../utils/dictation';

export function dictationTransaction(state: EditorState, text: string, commands: boolean): Transaction | null {
  const action = parseDictation(text, commands);
  if (!action) return null;
  const { $from, $to, from, to } = state.selection;
  const types = ['action', 'dialogue', 'character', 'sceneHeading', 'parenthetical', 'transition', 'general', 'shot'];
  if (!$from.sameParent($to) || !types.includes($from.parent.type.name)) return null;
  for (let depth = 1; depth <= $from.depth; depth++) {
    const name = $from.node(depth).type.name;
    if (name === 'titlePage' || name.startsWith('av')) return null;
  }
  if (action.kind !== 'text' && $from.depth !== 1) return null;
  const tr = closeHistory(state.tr);
  if (action.kind === 'text') {
    const before = $from.parent.textBetween(0, $from.parentOffset);
    const after = $to.parent.textBetween($to.parentOffset, $to.parent.content.size);
    const prefix = before && !/\s$/.test(before) && !/^[,.;:!?)]/.test(action.text) ? ' ' : '';
    const suffix = after && !/^[\s,.;:!?)]/.test(after) && !/\s$/.test(action.text) ? ' ' : '';
    return tr.insertText(prefix + action.text + suffix, from, to).scrollIntoView();
  }
  // Commands never convert or delete existing words, even with a selection.
  if ($from.parent.content.size || action.kind === 'paragraph') {
    const end = $from.end();
    tr.setSelection(TextSelection.create(tr.doc, end));
    tr.split(end);
  }
  const type = state.schema.nodes[action.kind === 'paragraph' ? 'action' : action.type];
  if (!type) return null;
  tr.setNodeMarkup(tr.selection.$from.before(), type, type.create().attrs);
  if (action.kind === 'element' && action.text) tr.insertText(action.text);
  return tr.scrollIntoView();
}

export function insertDictation(editor: Editor, text: string, commands: boolean): boolean {
  if (!editor.isEditable || editor.isDestroyed) return false;
  const tr = dictationTransaction(editor.state, text, commands);
  if (!tr) return false;
  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}
