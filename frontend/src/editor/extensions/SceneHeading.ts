import { Node, mergeAttributes } from '@tiptap/core';

export const SceneHeading = Node.create({
  name: 'sceneHeading',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      sceneNumber: { default: null },
      locked: { default: false },
      synopsis: { default: '' },
      sceneColor: { default: '' },
      timingOverride: { default: null },  // seconds (null = auto-calculate)
      sequenceId: { default: null },       // links scene to a sequence defined at document level
      // A scene cut after its number was locked: the heading stays, reading
      // OMITTED, so the numbers around it never move (editor/omitScene.ts).
      omitted: { default: false },
    };
  },

  parseHTML() {
    return [{
      tag: 'div[data-type="scene-heading"]',
      getAttrs: (el) => {
        const dom = el as HTMLElement;
        return {
          synopsis: dom.getAttribute('data-synopsis') || '',
          sceneColor: dom.getAttribute('data-scene-color') || '',
          sequenceId: dom.getAttribute('data-sequence-id') || null,
          omitted: dom.getAttribute('data-omitted') === 'true',
        };
      },
    }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs: Record<string, string> = {
      'data-type': 'scene-heading',
      class: 'screenplay-element scene-heading',
    };
    if (node.attrs.sceneNumber != null) {
      attrs['data-scene-number'] = String(node.attrs.sceneNumber);
    }
    if (node.attrs.synopsis) {
      attrs['data-synopsis'] = node.attrs.synopsis;
    }
    if (node.attrs.sceneColor) {
      attrs['data-scene-color'] = node.attrs.sceneColor;
    }
    if (node.attrs.sequenceId) {
      attrs['data-sequence-id'] = node.attrs.sequenceId;
    }
    if (node.attrs.omitted) {
      attrs['data-omitted'] = 'true';
    }
    return [
      'div',
      mergeAttributes(HTMLAttributes, attrs),
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
