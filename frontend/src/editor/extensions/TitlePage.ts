import { Node, mergeAttributes } from '@tiptap/core';

export interface TitlePageAttrs {
  field: string;
  // Structured title page metadata
  tpTitle: string;
  tpWrittenBy: string;
  tpBasedOn: string;
  tpDraft: string;
  tpDraftDate: string;
  tpContact: string;
  tpCopyright: string;
  tpWgaRegistration: string;
  tpNotes: string;
  /** Title font size in points (default 12). */
  tpTitleFontSize: number;
}

export const TitlePage = Node.create({
  name: 'titlePage',
  group: 'block',
  content: 'text*',
  defining: true,

  addAttributes() {
    return {
      field: { default: 'title' },
      // Structured fields (stored on the title node with field='title')
      tpTitle: { default: '' },
      tpWrittenBy: { default: '' },
      tpBasedOn: { default: '' },
      tpDraft: { default: '' },
      tpDraftDate: { default: '' },
      tpContact: { default: '' },
      tpCopyright: { default: '' },
      tpWgaRegistration: { default: '' },
      tpNotes: { default: '' },
      tpTitleFontSize: { default: 12 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="title-page"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const field = node.attrs.field || 'title';
    const size = Number(node.attrs.tpTitleFontSize) || 12;
    const attrs: Record<string, string> = {
      'data-type': 'title-page',
      class: `screenplay-element title-page title-page-${field}`,
      'data-field': field,
    };
    // Apply a custom title font size (default 12pt is left to CSS).
    if (field === 'title' && size !== 12) attrs.style = `font-size: ${size}pt`;
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});
