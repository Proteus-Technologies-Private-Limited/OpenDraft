import { Node, mergeAttributes } from '@tiptap/core';

export const DualDialogue = Node.create({
  name: 'dualDialogue',
  group: 'block',
  content: '(character | dialogue | parenthetical)+',
  defining: true,

  addAttributes() {
    return {
      // Language for the left column (first speaker)
      langLeft: { default: null },
      dirLeft: { default: null },
      // Language for the right column (second speaker)
      langRight: { default: null },
      dirRight: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="dual-dialogue"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs: Record<string, string> = {
      'data-type': 'dual-dialogue',
      class: 'screenplay-element dual-dialogue',
    };
    if (node.attrs.langLeft) attrs['data-lang-left'] = node.attrs.langLeft;
    if (node.attrs.dirLeft) attrs['data-dir-left'] = node.attrs.dirLeft;
    if (node.attrs.langRight) attrs['data-lang-right'] = node.attrs.langRight;
    if (node.attrs.dirRight) attrs['data-dir-right'] = node.attrs.dirRight;
    return [
      'div',
      mergeAttributes(HTMLAttributes, attrs),
      0,
    ];
  },
});
