import { Node, mergeAttributes } from '@tiptap/core';

export const CastList = Node.create({
  name: 'castList',
  group: 'block',
  content: 'text*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="cast-list"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'cast-list',
        class: 'screenplay-element cast-list',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
