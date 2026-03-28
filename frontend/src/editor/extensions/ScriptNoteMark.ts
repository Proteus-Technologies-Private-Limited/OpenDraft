import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * ScriptNoteMark — inline mark that highlights text associated with a script note.
 * Stores noteId and color as attributes rendered as data-* and background-color.
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
