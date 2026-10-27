/**
 * Inserting a macro into the script, shared by the macro shortcuts and
 * Edit → Insert Macro.
 */
import type { Editor } from '@tiptap/react';
import { macroLabel, macroTransaction, type Macro } from '../utils/macros';
import { matchesShortcut } from '../utils/shortcuts';
import { showToast } from './Toast';

export function insertMacro(editor: Editor, macro: Macro): boolean {
  const tr = macroTransaction(editor.state, macro);
  if (!tr) {
    showToast(
      macro.text
        ? `“${macroLabel(macro)}” can’t be inserted here — put the cursor in a script line.`
        : `“${macroLabel(macro)}” has no text yet. Add some in Settings → Macros.`,
      'info',
    );
    return false;
  }
  editor.view.dispatch(tr);
  editor.commands.focus();
  return true;
}

/** The first macro whose shortcut `e` is, or undefined. */
export function macroForEvent(e: KeyboardEvent, macros: Macro[]): Macro | undefined {
  return macros.find((m) => m.shortcut && matchesShortcut(e, m.shortcut));
}
