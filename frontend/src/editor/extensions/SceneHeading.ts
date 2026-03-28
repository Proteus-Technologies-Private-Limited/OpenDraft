import { Node, mergeAttributes } from '@tiptap/core';

export const SceneHeading = Node.create({
  name: 'sceneHeading',
  group: 'block',
  content: 'text*',
  defining: true,

  addAttributes() {
    return {
      sceneNumber: { default: null },
      locked: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="scene-heading"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'scene-heading',
        class: 'screenplay-element scene-heading',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (!editor.isActive('sceneHeading')) return false;
        // Tab from scene heading goes to action
        return editor
          .chain()
          .splitBlock()
          .setNode('action')
          .run();
      },
    };
  },

  addInputRules() {
    return [];
  },
});
