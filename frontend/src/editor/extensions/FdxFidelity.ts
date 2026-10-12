import { Extension } from '@tiptap/core';
import { PAGE_BREAKABLE_TYPES } from './StartsNewPage';

/**
 * Details of an opened Final Draft paragraph that WriTea Draft does not edit
 * but must hand back unchanged on save: the paragraph's `id`, its scene
 * properties block, and (for a character cue) the name as it was typed.
 *
 * They are never rendered, never copied through the clipboard's HTML, and are
 * not carried onto the second half of a split paragraph, so a new paragraph
 * never inherits another one's identity.
 */
const TYPES = Array.from(new Set<string>([...PAGE_BREAKABLE_TYPES, 'dialogue', 'parenthetical', 'customElement']));

const hidden = {
  default: null as string | null,
  keepOnSplit: false,
  parseHTML: () => null,
  renderHTML: () => ({}),
};

export const FdxFidelity = Extension.create({
  name: 'fdxFidelity',

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          fdxId: { ...hidden },
          fdxSceneProps: { ...hidden },
          fdxText: { ...hidden },
        },
      },
    ];
  },
});
