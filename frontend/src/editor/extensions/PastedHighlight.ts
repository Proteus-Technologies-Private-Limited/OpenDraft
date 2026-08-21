/**
 * Recognise a highlight that arrived as a coloured background.
 *
 * Tiptap's Highlight only parses `<mark>`. Nothing else on the web writes one:
 * Google Docs, Word Online, Notes and every browser's own copy emit
 * `<span style="background-color: #ffe599">` instead. The mark matched no parse
 * rule, so a highlighted sentence pasted in as plain unhighlighted text — the
 * one piece of the writer's formatting that vanished without explanation.
 *
 * The rule is deliberately narrow. A style-based parse rule applies to every
 * element carrying that declaration, and web pages set `background-color` on
 * layout wrappers constantly — pasting an article would otherwise highlight
 * whole paragraphs of it. Transparent and white backgrounds are therefore not
 * highlights: they are the absence of one, written out longhand.
 */
import Highlight from '@tiptap/extension-highlight';

/** Backgrounds that mean "no background". */
const NOT_A_HIGHLIGHT = new Set([
  'transparent',
  'none',
  '#fff',
  '#ffffff',
  'white',
  'rgb(255, 255, 255)',
  'rgba(255, 255, 255, 1)',
  'rgb(255,255,255)',
]);

/** Fully transparent in any notation — `rgba(…, 0)` and friends. */
const FULLY_TRANSPARENT = /^rgba?\([^)]*,\s*0(?:\.0+)?\s*\)$/i;

export function isHighlightColor(value: string): boolean {
  const color = value.trim().toLowerCase();
  if (color === '') return false;
  if (NOT_A_HIGHLIGHT.has(color)) return false;
  return !FULLY_TRANSPARENT.test(color);
}

export const PastedHighlight = Highlight.extend({
  parseHTML() {
    return [
      { tag: 'mark' },
      {
        style: 'background-color',
        // `false` tells ProseMirror the rule does not apply after all, which is
        // how a white or transparent background declines to become a highlight.
        getAttrs: (value) => (isHighlightColor(value as string) ? { color: value } : false),
      },
    ];
  },
});
