import { Mark } from '@tiptap/core';

/**
 * Final Draft's `AdornmentStyle` tag on a run of text. WriTea Draft does not
 * use it, but an opened file's tags must come back out on the same words.
 * Invisible, not copied through the clipboard's HTML, and not extended by
 * typing at its edge.
 */
export const FdxAdornment = Mark.create({
  name: 'fdxAdornment',
  inclusive: false,

  addAttributes() {
    return {
      style: { default: '-1', rendered: false },
      black: { default: false, rendered: false },
    };
  },

  parseHTML() {
    return [];
  },

  renderHTML() {
    return ['span', { 'data-fdx-adornment': '' }, 0];
  },
});
