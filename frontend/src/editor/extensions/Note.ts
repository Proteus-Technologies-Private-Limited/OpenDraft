import { Node, mergeAttributes } from '@tiptap/core';

/**
 * `note` — Fountain's `[[ double bracket ]]` note.
 *
 * The spec is explicit that a note "stays in the file but not in the PDF", so
 * it is a non-printing element like `section`, not a line of Action. Imported
 * as Action the brackets came through as literal characters and the writer's
 * aside was printed in the middle of a scene.
 *
 * This is deliberately *not* the same thing as OpenDraft's script notes, which
 * are anchored to a run of text and live in the notes panel. A Fountain note
 * has no anchor — it is a standalone paragraph the writer parked between two
 * elements — so it is represented as one.
 */
export const Note = Node.create({
  name: 'note',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="note"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'note',
        class: 'screenplay-element note',
      }),
      0,
    ];
  },
});
