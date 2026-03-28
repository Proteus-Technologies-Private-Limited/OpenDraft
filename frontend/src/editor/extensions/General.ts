import { Node, mergeAttributes } from '@tiptap/core';

export const General = Node.create({
  name: 'general',
  group: 'block',
  content: 'text*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="general"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'general',
        class: 'screenplay-element general',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
