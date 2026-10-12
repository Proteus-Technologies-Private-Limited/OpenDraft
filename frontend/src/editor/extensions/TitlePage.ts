import { Node, mergeAttributes } from '@tiptap/core';

export interface TitlePageAttrs {
  field: string;
  // Structured title page metadata
  tpTitle: string;
  /** The label line above the author — Fountain's `Credit:`. Blank = "Written by". */
  tpCredit: string;
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
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      field: { default: 'title' },
      // Structured fields (stored on the title node with field='title')
      tpTitle: { default: '' },
      tpCredit: { default: '' },
      tpWrittenBy: { default: '' },
      tpBasedOn: { default: '' },
      tpDraft: { default: '' },
      tpDraftDate: { default: '' },
      tpContact: { default: '' },
      tpCopyright: { default: '' },
      tpWgaRegistration: { default: '' },
      tpNotes: { default: '' },
      tpTitleFontSize: { default: 12 },
      // A free-form line from an opened Final Draft file: its alignment, and the
      // paragraph exactly as the file had it, so it can be written back as it was.
      align: { default: '', rendered: false },
      fdxXml: { default: '', rendered: false, keepOnSplit: false },
      fdxSig: { default: '', rendered: false, keepOnSplit: false },
      // The title page's own header/footer and text state, carried on its first line.
      fdxTitleBefore: { default: '', rendered: false, keepOnSplit: false },
      fdxTitleAfter: { default: '', rendered: false, keepOnSplit: false },
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
    const styles: string[] = [];
    if (field === 'title' && size !== 12) styles.push(`font-size: ${size}pt`);
    const align = String(node.attrs.align || '');
    if (field === 'free' && ['left', 'center', 'right', 'justify'].includes(align)) styles.push(`text-align: ${align}`);
    if (styles.length > 0) attrs.style = styles.join('; ');
    return ['div', mergeAttributes(HTMLAttributes, attrs), 0];
  },
});
