import { Node, mergeAttributes } from '@tiptap/core';

export const Transition = Node.create({
  name: 'transition',
  group: 'block',
  content: 'text*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="transition"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'transition',
        class: 'screenplay-element transition',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
