/**
 * Keep a script note's own highlight from being re-read as a pasted one.
 *
 * `PastedHighlight` exists so that text pasted from Word or Google Docs keeps
 * its highlighting: neither writes `<mark>`, both write a span with an inline
 * `background-color`, so the rule matches ANY element carrying one.
 *
 * A script note's own span carries one too — that is how its colour is drawn.
 * So copying a noted passage and pasting it back laid a second, translucent
 * highlight over the same words. Both painted them; deleting the note removed
 * only the note's own mark, and the colour stayed behind on a passage with no
 * note attached to it any more.
 *
 * The colour is stripped from those spans before the pasted HTML is parsed.
 * Nothing about how a note is rendered changes — the mark still writes its
 * background exactly as it always has — and a highlight the writer genuinely
 * pasted is untouched, because it carries no note or tag id.
 *
 * Deliberately string-based rather than DOM-based: this runs on the editor's
 * own serialized output, whose shape is known, and it stays testable in the
 * node environment alongside the rest of the editor helpers.
 */

/** Spans that belong to a note or a tag rather than to the writer's text. */
const OWN_SPAN = /\bdata-(?:note|tag)-id\b/i;

/** A `background-color` declaration, with whatever separator precedes it. */
const BACKGROUND_DECL = /(?:^|;)\s*background(?:-color)?\s*:[^;]*/gi;

/** Remove the background declaration from one style attribute's value. */
function stripBackground(css: string): string {
  return css.replace(BACKGROUND_DECL, '').replace(/^\s*;+/, '').trim();
}

/**
 * Strip the background colour from any note or tag span in a fragment of HTML.
 *
 * Everything else — the ids, the border, the writer's own highlights — is left
 * exactly as it was.
 */
export function stripNoteBackgrounds(html: string): string {
  if (!html || !OWN_SPAN.test(html)) return html;
  return html.replace(/<[a-z][^>]*>/gi, (tag) => {
    if (!OWN_SPAN.test(tag)) return tag;
    return tag.replace(/\sstyle\s*=\s*"([^"]*)"/i, (_whole, css: string) => {
      const cleaned = stripBackground(css);
      return cleaned ? ` style="${cleaned}"` : '';
    }).replace(/\sstyle\s*=\s*'([^']*)'/i, (_whole, css: string) => {
      const cleaned = stripBackground(css);
      return cleaned ? ` style='${cleaned}'` : '';
    });
  });
}
