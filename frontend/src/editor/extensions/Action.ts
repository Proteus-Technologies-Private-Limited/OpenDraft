import { Node, mergeAttributes } from '@tiptap/core';

export const Action = Node.create({
  name: 'action',
  group: 'block',
  content: 'text*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="action"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'action',
        class: 'screenplay-element action',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (!editor.isActive('action')) return false;
        // Tab from action goes to character
        return editor
          .chain()
          .splitBlock()
          .setNode('character')
          .run();
      },
    };
  },
});
