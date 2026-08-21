/**
 * Keep a paste from another app from bringing that app's *unresolvable* typography
 * with it, while leaving the typography that does resolve alone.
 *
 * Rich text on the clipboard carries an HTML flavour, and on iOS in particular
 * that HTML tags every run with the source app's own inline font — usually a
 * system alias such as `-apple-system` or `.SFUI-Regular`. Those names mean
 * "whatever this platform's UI font is" and resolve, inside a web view, to
 * whatever the fallback happens to be: a font matching neither the source nor
 * the screenplay around it. That was issue #81, and it is the only part of a
 * pasted font that is actually wrong.
 *
 * So only the aliases are dropped. A real family the writer chose — Georgia,
 * Helvetica, Courier Prime — and every font size come through as they were,
 * because a paste that silently reformats the writer's text is its own bug. An
 * alias sitting in front of real families (`-apple-system, Georgia`) loses just
 * the alias; one that names nothing else loses the declaration entirely and the
 * text inherits the destination element's font, as it did before.
 *
 * Emphasis was never in question: bold, italic, underline, colour and highlight
 * are the writer's meaning and always survive.
 *
 * Text copied inside OpenDraft is exempt from all of it. ProseMirror stamps its
 * own clipboard HTML with `data-pm-slice`, and a font set deliberately with the
 * toolbar has to survive a copy and paste.
 */
import { Extension } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { Mark, Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Family names that do not name a family.
 *
 * Each of these resolves to "the platform's UI font", which a web view answers
 * with its own fallback rather than with anything the source app was showing.
 * Keeping one would pin the text to a font nobody chose.
 */
const SYSTEM_FONT_ALIASES = [
  '-apple-system',
  'blinkmacsystemfont',
  'system-ui',
  '-webkit-system-font',
  '.applesystemuifont',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'ui-rounded',
];

/** `.SFUI-Regular`, `.SF UI Text`, `.SFNS-Regular` — Apple's internal faces. */
const APPLE_INTERNAL_FACE = /^\.(sf|apple)/i;

function isSystemAlias(family: string): boolean {
  const name = family.trim().replace(/^["']|["']$/g, '').toLowerCase();
  return SYSTEM_FONT_ALIASES.includes(name) || APPLE_INTERNAL_FACE.test(name);
}

/**
 * The font-family stack with the aliases removed, or null when nothing real is
 * left — at which point the text inherits the destination element's font.
 */
export function withoutSystemAliases(fontFamily: string): string | null {
  const kept = fontFamily.split(',').filter((family) => family.trim() !== '' && !isSystemAlias(family));
  return kept.length > 0 ? kept.map((family) => family.trim()).join(', ') : null;
}

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

/**
 * Resolve a `textStyle` mark's font family, dropping the mark if that leaves it
 * carrying nothing. `fontSize` is deliberately untouched — a size always means
 * what it says, whatever app wrote it.
 */
function withoutFont(marks: readonly Mark[]): Mark[] {
  return marks.flatMap((mark) => {
    if (mark.type.name !== 'textStyle') return [mark];

    const family = mark.attrs.fontFamily;
    if (typeof family !== 'string' || family === '') return [mark];

    const resolved = withoutSystemAliases(family);
    if (resolved === family) return [mark];

    const attrs = { ...mark.attrs, fontFamily: resolved };
    // A textStyle left carrying nothing has no reason to survive.
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


/**
 * Give pasted blocks the element type the writer is standing in.
 *
 * A paste arrives carrying the source's own block types — a web page's
 * paragraphs land as Action whatever the writer had chosen — so setting the
 * element to General and pasting produced text that was not General, and the
 * dropdown went on reporting whatever the paste brought with it. Selecting the
 * text and assigning the type by hand worked, which is the tell: the content
 * was fine, only its type was the source's rather than the destination's.
 *
 * Only whole blocks are retyped. Inline content merges into the block the
 * cursor is already in and is the destination type by definition, and anything
 * that is not a text block — an image, a dual-dialogue column — keeps the shape
 * it needs to stay valid.
 *
 * Internal pastes never reach this: a scene copied inside OpenDraft carries
 * headings, cues and dialogue, and flattening those into one element would
 * destroy the structure the writer copied.
 */
export function retypeBlocks(slice: Slice, destination: NodeType): Slice {
  const nodes: ProseMirrorNode[] = [];
  let changed = false;

  slice.content.forEach((node) => {
    // `validContent` keeps this honest: a block whose content the destination
    // type cannot hold is left as it is rather than thrown away.
    if (node.isTextblock && node.type !== destination && destination.validContent(node.content)) {
      nodes.push(destination.create(null, node.content, node.marks));
      changed = true;
      return;
    }
    nodes.push(node);
  });

  return changed ? new Slice(Fragment.fromArray(nodes), slice.openStart, slice.openEnd) : slice;
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
          // Both transforms live in this one plugin on purpose: ProseMirror
          // resolves `transformPasted` with `someProp`, which takes the first
          // plugin that answers, so a second one declaring it would silently
          // never run.
          transformPasted: (slice, view) => {
            const wasInternal = internal;
            internal = false;
            if (wasInternal) return slice;

            const destination = view.state.selection.$from.parent.type;
            return retypeBlocks(stripPastedFonts(slice), destination);
          },
        },
      }),
    ];
  },
});
