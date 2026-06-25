import { Node, mergeAttributes } from '@tiptap/core';

export const ShowEpisode = Node.create({
  name: 'showEpisode',
  group: 'block',
  content: 'inline*',
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="show-episode"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'show-episode',
        class: 'screenplay-element show-episode',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
