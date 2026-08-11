/**
 * StartsNewPage — a manual "start this element on a new page" flag.
 *
 * Adds a `startsNewPage` boolean attribute to every top-level screenplay block
 * so a writer can force a page break before any element (typically a New Act).
 * The flag is honoured by the editor's pagination plugin and by the PDF/DOCX
 * exporters, and it round-trips through the FDX (`StartsNewPage="Yes"`), OSF
 * (`pagebreakbefore`), and Fountain (`===`) importers/exporters, which already
 * emit this attribute.
 *
 * Template-wide rules ("every New Act starts a page") live in the formatting
 * template's `forceBreakBefore` list instead — see stores/formattingTypes.ts.
 */

import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

/** Top-level block types that may carry a forced page break. */
export const PAGE_BREAKABLE_TYPES = [
  'sceneHeading',
  'action',
  'character',
  'transition',
  'general',
  'shot',
  'newAct',
  'endOfAct',
  'lyrics',
  'showEpisode',
  'castList',
  'customElement',
  'dualDialogue',
  'screenplayImage',
  'avBlock',
] as const;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    startsNewPage: {
      /** Set (or clear) the forced page break on every selected block. */
      setStartsNewPage: (value: boolean) => ReturnType;
      /** Flip the forced page break on the selected block(s). */
      toggleStartsNewPage: () => ReturnType;
    };
  }
}

/** True when any top-level block touched by the current selection carries the flag. */
export function selectionStartsNewPage(editor: Editor | null): boolean {
  if (!editor || editor.isDestroyed) return false;
  try {
    const { from, to } = editor.state.selection;
    let found = false;
    editor.state.doc.forEach((node, offset) => {
      if (found) return;
      if (offset + node.nodeSize <= from || offset > to) return;
      if (node.attrs?.startsNewPage) found = true;
    });
    return found;
  } catch (err) {
    console.warn('[StartsNewPage] failed to read selection state', err);
    return false;
  }
}

export const StartsNewPage = Extension.create({
  name: 'startsNewPage',

  addGlobalAttributes() {
    return [
      {
        types: [...PAGE_BREAKABLE_TYPES],
        attributes: {
          startsNewPage: {
            default: false,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-starts-new-page') === 'true',
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.startsNewPage ? { 'data-starts-new-page': 'true' } : {},
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setStartsNewPage:
        (value: boolean) =>
        ({ state, tr, dispatch }) => {
          const { from, to } = state.selection;
          let changed = false;
          state.doc.forEach((node, offset) => {
            const end = offset + node.nodeSize;
            if (end <= from || offset > to) return;
            if (!(PAGE_BREAKABLE_TYPES as readonly string[]).includes(node.type.name)) return;
            if (node.attrs.startsNewPage === value) return;
            tr.setNodeAttribute(offset, 'startsNewPage', value);
            changed = true;
          });
          if (!changed) return false;
          if (dispatch) {
            // Pagination only recomputes on doc changes; attribute-only updates
            // need an explicit nudge.
            tr.setMeta('forceRepaginate', true);
            dispatch(tr);
          }
          return true;
        },

      toggleStartsNewPage:
        () =>
        ({ state, commands }) => {
          const { from, to } = state.selection;
          let current = false;
          state.doc.forEach((node, offset) => {
            const end = offset + node.nodeSize;
            if (end <= from || offset > to) return;
            if (node.attrs?.startsNewPage) current = true;
          });
          return commands.setStartsNewPage(!current);
        },
    };
  },
});
