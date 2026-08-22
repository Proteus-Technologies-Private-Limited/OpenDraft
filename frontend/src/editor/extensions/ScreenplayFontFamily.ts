import FontFamily from '@tiptap/extension-font-family';
import { fontStack } from '../../utils/fonts';

/**
 * The font-family mark, rendered with fallbacks.
 *
 * Tiptap's own extension writes `font-family: Bebas Neue` and nothing else, so
 * a run set in a font this machine hasn't got inherits the page's — which is
 * Courier. A title set in a display face silently became a typewriter face, and
 * the writer had no way to tell that from the font simply not having loaded yet.
 *
 * The stored attribute is untouched: exporters, importers and the pickers all
 * still see the plain family name the writer chose, which is what makes the
 * document portable. Only what reaches the DOM gains the fallbacks, and
 * `fontStack` is idempotent, so a stack that survives an HTML round trip is not
 * grown a second time.
 */
export const ScreenplayFontFamily = FontFamily.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontFamily: {
            default: null,
            // Unchanged from the base extension: a pasted stack keeps all its
            // families here, and PasteFormatting is what decides which of them
            // is the font the writer actually meant.
            parseHTML: (element: HTMLElement) => element.style.fontFamily,
            renderHTML: (attributes: Record<string, unknown>) => {
              const family = attributes.fontFamily as string | null | undefined;
              if (!family) return {};
              return { style: `font-family: ${fontStack(family)}` };
            },
          },
        },
      },
    ];
  },
});

export default ScreenplayFontFamily;
