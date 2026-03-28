import { Mark, mergeAttributes } from '@tiptap/core';

/**
 * TagMark — inline mark for production breakdown tagging.
 * Highlights tagged text with the category color. Can coexist with scriptNote marks.
 */
export const TagMark = Mark.create({
  name: 'productionTag',

  // Allow coexistence with other marks (scriptNote, bold, italic, etc.)
  excludes: '',

  addAttributes() {
    return {
      tagId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-tag-id'),
        renderHTML: (attributes) => ({
          'data-tag-id': attributes.tagId,
        }),
      },
      categoryId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-tag-category'),
        renderHTML: (attributes) => ({
          'data-tag-category': attributes.categoryId,
        }),
      },
      color: {
        default: '#9370DB',
        parseHTML: (element) => element.getAttribute('data-tag-color'),
        renderHTML: (attributes) => ({
          'data-tag-color': attributes.color,
          style: `background-color: ${attributes.color}40; border-bottom: 2px solid ${attributes.color};`,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-tag-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'production-tag-highlight' }),
      0,
    ];
  },
});
