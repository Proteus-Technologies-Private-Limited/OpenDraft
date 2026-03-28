import { Node, mergeAttributes } from '@tiptap/core';

export const Dialogue = Node.create({
  name: 'dialogue',
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
    return [{ tag: 'div[data-type="dialogue"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, string> = {
      'data-type': 'dialogue',
      class: 'screenplay-element dialogue',
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
        if (!editor.isActive('dialogue')) return false;
        // Tab from dialogue goes to parenthetical
        return editor
          .chain()
          .splitBlock()
          .setNode('parenthetical')
          .run();
      },
    };
  },
});
