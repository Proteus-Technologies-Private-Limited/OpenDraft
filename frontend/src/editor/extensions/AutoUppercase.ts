/**
 * Store scene headings, cues, transitions and the other capitals elements in
 * capitals, once the writer leaves the line (editor/elementCase explains why).
 *
 * Two moments count as leaving:
 *
 * - the selection moves to another block, including Enter creating the next
 *   line — the common case;
 * - the editor loses focus, for a writer who clicks a toolbar button while the
 *   caret stays on the line.
 *
 * Changing the block's element type to one of these (Ctrl/⌘+1, the element
 * menu) normalises it too, without waiting for the caret to move. The line
 * under the caret is never rewritten while it is being typed.
 *
 * Suggest mode and track changes are left alone: there an automatic case
 * change would arrive as a suggestion or a revision the writer never made.
 */
import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { blockPosition, uppercaseBlockTransaction } from '../elementCase';
import { useSuggestModeStore } from '../../stores/suggestModeStore';
import { useEditorStore } from '../../stores/editorStore';

function normalisationAllowed(): boolean {
  try {
    if (useSuggestModeStore.getState().suggesting) return false;
    if (useEditorStore.getState().trackChangesEnabled) return false;
  } catch {
    // Stores are not ready in a bare editor (tests, an early mount): no reason
    // to skip a normalisation the editor would otherwise make.
  }
  return true;
}

export interface AutoUppercaseOptions {
  /**
   * False when this editor must not write — a version opened for reading, a
   * viewer in a collaboration session. Normalising is an edit like any other.
   */
  canNormalise: () => boolean;
}

export const AutoUppercase = Extension.create<AutoUppercaseOptions>({
  name: 'autoUppercase',

  addOptions() {
    return { canNormalise: () => true };
  },

  addProseMirrorPlugins() {
    const options = this.options;
    const allowed = () => options.canNormalise() && normalisationAllowed();
    return [
      new Plugin({
        appendTransaction(transactions, oldState, newState) {
          if (!allowed()) return null;

          const oldPos = blockPosition(oldState);
          const newPos = blockPosition(newState);

          // Moved to another block: the block just left is finished.
          if (oldPos !== null && oldPos !== newPos) {
            const mapped = transactions.reduce((pos, tr) => tr.mapping.map(pos), oldPos);
            return uppercaseBlockTransaction(newState, mapped);
          }

          // Same block, but its element changed (a shortcut or the element
          // menu): a capitals element normalises straight away.
          if (oldPos !== null && oldPos === newPos) {
            const before = oldState.doc.nodeAt(oldPos);
            const after = newState.doc.nodeAt(newPos);
            if (before && after && before.type !== after.type) {
              return uppercaseBlockTransaction(newState, newPos);
            }
          }

          return null;
        },

        props: {
          handleDOMEvents: {
            blur(view) {
              if (!allowed()) return false;
              const pos = blockPosition(view.state);
              if (pos === null) return false;
              const tr = uppercaseBlockTransaction(view.state, pos);
              if (tr) view.dispatch(tr);
              return false;
            },
          },
        },
      }),
    ];
  },
});
