import { Node, mergeAttributes } from '@tiptap/core';

export const Parenthetical = Node.create({
  name: 'parenthetical',
  group: 'block',
  content: 'text*',
  defining: true,

  addAttributes() {
    return {
      lang: { default: null },
      dir: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="parenthetical"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, string> = {
      'data-type': 'parenthetical',
      class: 'screenplay-element parenthetical',
    };
    if (node.attrs.lang) attrs.lang = node.attrs.lang;
    if (node.attrs.dir) attrs.dir = node.attrs.dir;
    return [
      'div',
      mergeAttributes(HTMLAttributes, attrs),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (!editor.isActive('parenthetical')) return false;
        // Tab from parenthetical goes to dialogue
        return editor
          .chain()
          .splitBlock()
          .setNode('dialogue')
          .run();
      },
    };
  },
});
