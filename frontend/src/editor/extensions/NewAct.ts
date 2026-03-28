import { Node, mergeAttributes } from '@tiptap/core';

export const NewAct = Node.create({
  name: 'newAct',
  group: 'block',
  content: 'text*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="new-act"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'new-act',
        class: 'screenplay-element new-act',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
