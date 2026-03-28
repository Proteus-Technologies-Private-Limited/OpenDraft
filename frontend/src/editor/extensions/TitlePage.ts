import { Node, mergeAttributes } from '@tiptap/core';

export const TitlePage = Node.create({
  name: 'titlePage',
  group: 'block',
  content: 'text*',
  defining: true,

  addAttributes() {
    return {
      field: { default: 'title' }, // title, author, contact, date, draft, copyright
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
        class: `screenplay-element title-page title-page-${HTMLAttributes['data-field'] || 'title'}`,
        'data-field': HTMLAttributes.field || 'title',
      }),
      0,
    ];
  },
});
