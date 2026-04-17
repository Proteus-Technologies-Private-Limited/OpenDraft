import { Node, mergeAttributes } from '@tiptap/core';

/**
 * `newAct` — act-break marker. Auto-numbered (1-based) unless overridden.
 * `customName` (optional) is shown verbatim in place of the default "ACT N" label,
 * e.g. the writer can type "CONFRONTATION" and the divider reads "ACT TWO: CONFRONTATION".
 */
export const NewAct = Node.create({
  name: 'newAct',
  group: 'block',
  content: 'text*',
  defining: true,

  addAttributes() {
    return {
      actNumber: { default: null },   // 1-based; null = auto-assign on render
      actName: { default: '' },       // e.g. "ACT TWO" — set by auto-numbering
      customName: { default: '' },    // optional subtitle ("CONFRONTATION")
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="new-act"]',
      getAttrs: (el) => {
        const dom = el as HTMLElement;
        const actNumberAttr = dom.getAttribute('data-act-number');
        return {
          actNumber: actNumberAttr ? parseInt(actNumberAttr, 10) : null,
          actName: dom.getAttribute('data-act-name') || '',
          customName: dom.getAttribute('data-custom-name') || '',
        };
      },
    }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs: Record<string, string> = {
      'data-type': 'new-act',
      class: 'screenplay-element new-act',
    };
    if (node.attrs.actNumber != null) {
      attrs['data-act-number'] = String(node.attrs.actNumber);
    }
    if (node.attrs.actName) {
      attrs['data-act-name'] = node.attrs.actName;
    }
    if (node.attrs.customName) {
      attrs['data-custom-name'] = node.attrs.customName;
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
