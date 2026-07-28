import { Node, mergeAttributes } from '@tiptap/core';

export const Character = Node.create({
  name: 'character',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      extension: { default: null }, // (V.O.), (O.S.), (CONT'D)
      lang: { default: null },
      dir: { default: null },
      // Auto-CONT'D bookkeeping (persisted via getJSON, not rendered to HTML).
      contdAuto: { default: false },       // the automation added this (CONT'D) → it owns/may remove it
      contdSuppressed: { default: false }, // writer removed an auto (CONT'D) here → do not re-add it
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="character"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, string> = {
      'data-type': 'character',
      class: 'screenplay-element character',
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
        if (!editor.isActive('character')) return false;
        // Tab from character goes to parenthetical
        return editor
          .chain()
          .splitBlock()
          .setNode('parenthetical')
          .run();
      },
    };
  },
});
