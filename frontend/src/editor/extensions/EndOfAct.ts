import { Node, mergeAttributes } from '@tiptap/core';

export const EndOfAct = Node.create({
  name: 'endOfAct',
  group: 'block',
  content: 'text*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="end-of-act"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'end-of-act',
        class: 'screenplay-element end-of-act',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
