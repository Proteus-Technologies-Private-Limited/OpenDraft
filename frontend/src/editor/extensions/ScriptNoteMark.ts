import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * ScriptNoteMark — inline mark that highlights the text a script note is
 * attached to. Stores `noteId` and `color` as data attributes.
 *
 * The colour is written as an inline `background-color`, which is also what
 * `PastedHighlight` looks for: its rule matches ANY element carrying one, so a
 * note's own span was re-read as a pasted highlight whenever the document's
 * HTML was parsed again — a copy-and-paste inside the editor is enough. The
 * text then carried two marks that both painted it, and deleting the note
 * removed only one: the note left the panel and its colour stayed on the page.
 *
 * That is headed off where it happens rather than by changing what is rendered
 * here — see `stripNoteBackgrounds`, which is applied to pasted HTML before it
 * is parsed. Rendering stays exactly as it was, so the highlight looks and
 * behaves as it always has.
 */
export const ScriptNoteMark = Mark.create({
  name: 'scriptNote',

  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-note-id'),
        renderHTML: (attributes) => ({
          'data-note-id': attributes.noteId,
        }),
      },
      color: {
        default: '#f4d35e',
        parseHTML: (element) => element.getAttribute('data-note-color'),
        renderHTML: (attributes) => ({
          'data-note-color': attributes.color,
          style: `background-color: ${attributes.color}33; border-bottom: 2px solid ${attributes.color};`,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-note-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'script-note-highlight' }),
      0,
    ];
  },
});
