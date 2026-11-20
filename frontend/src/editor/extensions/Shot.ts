import { Node, mergeAttributes } from '@tiptap/core';
import { SHOT_COSTUMES_ATTR, readShotCostumes } from '../../utils/sceneDetails';

export const Shot = Node.create({
  name: 'shot',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes() {
    return {
      // Which of a character's scene costumes this shot shows, by character
      // (utils/sceneDetails). Null unless the writer picked one.
      [SHOT_COSTUMES_ATTR]: {
        default: null,
        keepOnSplit: false,
        parseHTML: (el: HTMLElement) => {
          const picked = readShotCostumes(el.getAttribute('data-shot-costumes'));
          return Object.keys(picked).length ? picked : null;
        },
        renderHTML: (attrs: Record<string, unknown>) => {
          const picked = readShotCostumes(attrs[SHOT_COSTUMES_ATTR]);
          return Object.keys(picked).length ? { 'data-shot-costumes': JSON.stringify(picked) } : {};
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="shot"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'shot',
        class: 'screenplay-element shot',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {};
  },
});
