import { Node, mergeAttributes } from '@tiptap/core';

/**
 * `endOfAct` — closes the current act. Auto-matched to the preceding `newAct`
 * via `actNumber` (stays in sync when acts are renumbered).
 */
export const EndOfAct = Node.create({
  name: 'endOfAct',
  group: 'block',
  content: 'text*',
  defining: true,

  addAttributes() {
    return {
      actNumber: { default: null },   // should mirror the preceding newAct
      actName: { default: '' },       // e.g. "END OF ACT TWO"
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="end-of-act"]',
      getAttrs: (el) => {
        const dom = el as HTMLElement;
        const actNumberAttr = dom.getAttribute('data-act-number');
        return {
          actNumber: actNumberAttr ? parseInt(actNumberAttr, 10) : null,
          actName: dom.getAttribute('data-act-name') || '',
        };
      },
    }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs: Record<string, string> = {
      'data-type': 'end-of-act',
      class: 'screenplay-element end-of-act',
    };
    if (node.attrs.actNumber != null) {
      attrs['data-act-number'] = String(node.attrs.actNumber);
    }
    if (node.attrs.actName) {
      attrs['data-act-name'] = node.attrs.actName;
    }
    return [
      'div',
      mergeAttributes(HTMLAttributes, attrs),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
