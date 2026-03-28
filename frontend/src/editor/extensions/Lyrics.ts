import { Node, mergeAttributes } from '@tiptap/core';

export const Lyrics = Node.create({
  name: 'lyrics',
  group: 'block',
  content: 'text*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="lyrics"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'lyrics',
        class: 'screenplay-element lyrics',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
