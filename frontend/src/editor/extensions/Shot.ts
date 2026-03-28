import { Node, mergeAttributes } from '@tiptap/core';

export const Shot = Node.create({
  name: 'shot',
  group: 'block',
  content: 'text*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="shot"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'shot',
        class: 'screenplay-element shot',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
