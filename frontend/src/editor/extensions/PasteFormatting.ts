/**
 * Keep a paste from another app from bringing that app's typography with it.
 *
 * Rich text on the clipboard carries an HTML flavour, and on iOS in particular
 * that HTML tags every run with the source app's own inline font — usually a
 * system alias such as `-apple-system` or `.SFUI-Regular`. TextStyle/FontFamily
 * and FontSize read those declarations straight off the element, so the pasted
 * text ended up in a font that matched neither the source (the alias resolves
 * to whatever the web view falls back to) nor the screenplay around it.
 *
 * Stripping the font declarations before ProseMirror parses the HTML leaves the
 * pasted text with no font of its own, so it inherits the destination element's
 * — the screenplay's font and size. Emphasis is deliberately left alone: bold,
 * italic, underline and colour are the writer's meaning, not the source app's
 * house style.
 *
 * Text copied inside OpenDraft is exempt. ProseMirror stamps its own clipboard
 * HTML with `data-pm-slice`, and a font set deliberately with the toolbar has
 * to survive a copy and paste.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/** ProseMirror's marker on clipboard HTML it wrote itself. */
const INTERNAL_SLICE = /\sdata-pm-slice\s*=/i;

/** `style="…"` / `style='…'`, capturing the declarations. */
const STYLE_ATTR = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** The declarations that carry a font, including the `font:` shorthand. */
const FONT_DECLARATION = /(?:^|;)\s*(?:-webkit-)?font(?:-family|-size)?\s*:[^;]*/gi;

/** `face` and `size` on the deprecated `<font>` element. */
const FONT_ELEMENT_ATTRS = /(<font\b[^>]*?)\s(?:face|size)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/**
 * Rewrite `font: bold italic 12px Georgia` as the weight and style it also
 * set, so dropping the shorthand does not quietly drop emphasis with it.
 */
function emphasisFromShorthand(declaration: string): string {
  if (!/^\s*(?:;)?\s*(?:-webkit-)?font\s*:/i.test(declaration)) return '';
  const kept: string[] = [];
  if (/\b(bold|bolder|[5-9]00)\b/i.test(declaration)) kept.push('font-weight: bold');
  if (/\b(italic|oblique)\b/i.test(declaration)) kept.push('font-style: italic');
  return kept.length > 0 ? `;${kept.join(';')}` : '';
}

function stripFontDeclarations(declarations: string): string {
  return declarations
    .replace(FONT_DECLARATION, (match) => emphasisFromShorthand(match))
    .replace(/^\s*;+/, '')
    .trim();
}

/**
 * Remove font-family and font-size from pasted HTML that came from outside
 * the editor. Returns the HTML unchanged for an internal ProseMirror slice.
 */
export function stripPastedFonts(html: string): string {
  if (INTERNAL_SLICE.test(html)) return html;

  return html
    .replace(STYLE_ATTR, (_match, dquoted?: string, squoted?: string) => {
      const quote = dquoted !== undefined ? '"' : "'";
      const cleaned = stripFontDeclarations(dquoted ?? squoted ?? '');
      return cleaned === '' ? '' : ` style=${quote}${cleaned}${quote}`;
    })
    // Runs twice: the pattern consumes the space before each attribute, so a
    // `<font face="…" size="…">` needs a second pass for its second attribute.
    .replace(FONT_ELEMENT_ATTRS, '$1')
    .replace(FONT_ELEMENT_ATTRS, '$1');
}

export const PasteFormatting = Extension.create({
  name: 'pasteFormatting',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pasteFormatting'),
        props: {
          transformPastedHTML: (html) => stripPastedFonts(html),
        },
      }),
    ];
  },
});
