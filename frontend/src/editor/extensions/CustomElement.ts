/**
 * CustomElement — a generic Tiptap node for user-defined element types.
 *
 * Instead of creating new Tiptap node types at runtime (which requires
 * editor re-initialization), all custom elements share this single node
 * type. The `customTypeId` attribute links to the FormattingElementRule
 * in the active template, and CSS is generated dynamically.
 */

import { Node, mergeAttributes } from '@tiptap/core';

export interface CustomElementOptions {}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customElement: {
      setCustomElement: (attrs: { customTypeId: string; customLabel: string }) => ReturnType;
    };
  }
}

export const CustomElement = Node.create<CustomElementOptions>({
  name: 'customElement',
  group: 'block',
  content: 'text*',
  defining: true,

  addAttributes() {
    return {
      customTypeId: { default: '' },
      customLabel: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="custom-element"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'custom-element',
        'data-custom-type': HTMLAttributes.customTypeId,
        class: 'screenplay-element custom-element',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setCustomElement:
        (attrs) =>
        ({ commands }) =>
          commands.setNode(this.name, attrs),
    };
  },
});
