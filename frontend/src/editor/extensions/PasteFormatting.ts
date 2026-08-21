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
 * The fix drops the font from the parsed slice rather than from the HTML on the
 * way in. Editing the HTML text meant a regex deciding what was markup and what
 * was prose, and it got that wrong in both directions — body text that merely
 * mentioned `style="…"` was deleted, a font name containing a semicolon
 * corrupted the attribute around it. By the time ProseMirror has parsed the
 * clipboard there is nothing to guess at: a font is a `textStyle` mark with a
 * `fontFamily` or `fontSize` attribute, and dropping those leaves the text
 * inheriting the destination element's font and size.
 *
 * Emphasis is deliberately left alone: bold, italic, underline and colour are
 * the writer's meaning, not the source app's house style. They survive on their
 * own marks — including emphasis written as a `font: bold 12px X` shorthand,
 * which the browser's own CSS parsing hands to Tiptap's Bold rule as a
 * font-weight.
 *
 * Text copied inside OpenDraft is exempt. ProseMirror stamps its own clipboard
 * HTML with `data-pm-slice`, and a font set deliberately with the toolbar has
 * to survive a copy and paste.
 */
import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/** The `textStyle` attributes that carry a font, as opposed to a meaning. */
const FONT_ATTRIBUTES = ['fontFamily', 'fontSize'];

/**
 * ProseMirror's marker on clipboard HTML it wrote itself.
 *
 * Scoped to inside a tag, so that a pasted *article about* ProseMirror does not
 * exempt itself from the rule by quoting the attribute in its prose.
 */
const INTERNAL_SLICE = /<[^>]+\sdata-pm-slice\s*=/i;

/** Was this clipboard HTML written by ProseMirror itself? */
export function isInternalPaste(html: string): boolean {
  return INTERNAL_SLICE.test(html);
}

/** Drop the font attributes from a `textStyle` mark, and the mark if it is then empty. */
function withoutFont(marks: readonly Mark[]): Mark[] {
  return marks.flatMap((mark) => {
    if (mark.type.name !== 'textStyle') return [mark];
    if (!FONT_ATTRIBUTES.some((attr) => mark.attrs[attr] != null)) return [mark];

    const attrs = { ...mark.attrs };
    for (const attr of FONT_ATTRIBUTES) attrs[attr] = null;
    // A textStyle carrying nothing but a font has no reason to survive it.
    const carriesSomethingElse = Object.values(attrs).some((value) => value != null);
    return carriesSomethingElse ? [mark.type.create(attrs)] : [];
  });
}

function stripFonts(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    nodes.push(node.copy(stripFonts(node.content)).mark(withoutFont(node.marks)));
  });
  return Fragment.fromArray(nodes);
}

/** Remove every pasted font, at every depth of the slice. */
export function stripPastedFonts(slice: Slice): Slice {
  return new Slice(stripFonts(slice.content), slice.openStart, slice.openEnd);
}

export const PasteFormatting = Extension.create({
  name: 'pasteFormatting',

  addProseMirrorPlugins() {
    // Set while parsing an internal paste, and read once by the transform that
    // follows it in the same paste. Reset on read: a plain-text paste never
    // reaches transformPastedHTML at all, and must not inherit the answer from
    // whatever was pasted before it.
    let internal = false;

    return [
      new Plugin({
        key: new PluginKey('pasteFormatting'),
        props: {
          transformPastedHTML: (html) => {
            internal = isInternalPaste(html);
            return html;
          },
          transformPasted: (slice) => {
            const wasInternal = internal;
            internal = false;
            return wasInternal ? slice : stripPastedFonts(slice);
          },
        },
      }),
    ];
  },
});
