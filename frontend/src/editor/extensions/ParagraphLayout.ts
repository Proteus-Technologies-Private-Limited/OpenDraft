import { Extension } from '@tiptap/core';
import { BOOKMARKABLE_TYPES } from '../../utils/bookmarks';
import { validParagraphLayout, type ParagraphLayout as Layout } from '../paragraphLayout';
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphLayout: { setParagraphLayout: (value: Layout | null) => ReturnType };
  }
}
export const ParagraphLayout = Extension.create({
  name: 'paragraphLayout',
  addGlobalAttributes() {
    return [
      {
        types: [...BOOKMARKABLE_TYPES],
        attributes: {
          paragraphLayout: {
            default: null,
            keepOnSplit: true,
            parseHTML: (el: HTMLElement) => {
              try {
                const v = JSON.parse(el.getAttribute('data-paragraph-layout') ?? 'null');
                return validParagraphLayout(v) ? v : null;
              } catch {
                return null;
              }
            },
            renderHTML: (attrs: Record<string, unknown>) => {
              const v = attrs.paragraphLayout as Layout | null;
              if (!validParagraphLayout(v) || !v) return {};
              const styles: string[] = [];
              if (v.leftIndentPt != null) styles.push(`padding-left:${v.leftIndentPt}pt`);
              if (v.rightIndentPt != null) styles.push(`padding-right:${v.rightIndentPt}pt`);
              if (v.spaceBeforePt != null) styles.push(`margin-top:${v.spaceBeforePt}pt`);
              if (v.spaceAfterPt != null) styles.push(`padding-bottom:${v.spaceAfterPt}pt`);
              if (v.lineSpacing != null) styles.push(`line-height:${v.lineSpacing * 12}pt`);
              return { 'data-paragraph-layout': JSON.stringify(v), style: styles.join(';') };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphLayout:
        (value) =>
        ({ state, tr, dispatch }) => {
          if (!validParagraphLayout(value)) return false;
          let found = false;
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
            if (!node.isTextblock) return true;
            if (!('paragraphLayout' in node.attrs)) return false;
            found = true;
            if (dispatch) tr.setNodeAttribute(pos, 'paragraphLayout', value);
            return false;
          });
          if (found && dispatch) dispatch(tr);
          return found;
        },
    };
  },
});
