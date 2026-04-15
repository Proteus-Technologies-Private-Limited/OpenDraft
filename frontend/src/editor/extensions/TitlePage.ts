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
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="title-page"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'title-page',
        class: `screenplay-element title-page title-page-${HTMLAttributes['data-field'] || HTMLAttributes.field || 'title'}`,
        'data-field': HTMLAttributes.field || 'title',
      }),
      0,
    ];
  },
});
