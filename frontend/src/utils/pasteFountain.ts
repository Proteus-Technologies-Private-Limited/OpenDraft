/**
 * "Paste as Fountain" — read plain text from the clipboard, parse it as
 * Fountain markup, and insert real screenplay elements at the cursor.
 *
 * An ordinary paste drops the text in as whatever element the cursor is
 * already in, so a script copied out of a Fountain file, a forum post or
 * another app arrives as one undifferentiated block.  This runs it through the
 * Fountain parser first, so scene headings, cues, dialogue and transitions
 * come out as the elements they describe.
 */
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/react';
import { parseFountain } from './fountainParser';
import { pasteFailureMessage, readNativeText } from './clipboardCommands';

/**
 * How a Fountain paste should land at the caret.
 *
 * `blocks` is the whole point of the command: the clipboard described
 * screenplay elements, so screenplay elements are what get inserted.
 *
 * `inline` is the case Fountain cannot distinguish on its own. Every line the
 * format does not recognise is Action by default, so a scrap of ordinary prose
 * — "Across the yard" — parses as an Action block, and inserting a block in
 * the middle of an element splits it: a caret in `EXT. CARGO| SHIP - PIER 3`
 * came back as three blocks, the heading torn in half around the paste
 * (issue #109). That text carries no structure to honour, so it goes in as
 * text, at the caret, in whatever element the writer put the caret in.
 */
export interface FountainInsert {
  /** The screenplay elements the text parsed to. */
  blocks: JSONContent[];
  /**
   * Set only for the plain-text case: the inline content to drop at the caret
   * instead, leaving the destination element and its type intact.
   */
  inline?: JSONContent[];
}

/**
 * Fountain's forcing characters. A line that opens with one is markup even
 * when it is a single line: `!Across the yard` is the writer saying "this is
 * Action", so it gets an Action block rather than being poured into the
 * heading the caret happens to be in.
 *
 * `.` is the one that has to be qualified, because it is the one character
 * here that also starts ordinary prose. Fountain forces a scene heading on a
 * leading `.` only where the next character is not a second `.`, which is what
 * keeps an ellipsis from becoming a heading — so `...and then I left`, the
 * shape half of dialogue continuation takes, is prose that the parser already
 * hands back as a plain Action. Matching it here anyway sent it in as a block
 * and split the element the caret was in: issue #109 again, on the paste most
 * likely to land mid-sentence. The lookahead mirrors the parser's own rule.
 *
 * The rest need no qualifying: `@`, `>`, `~` and `#` parse to something other
 * than a bare Action node and are turned away before this test is reached, and
 * `!` forces Action unconditionally, marker consumed. They are listed all the
 * same, because the question is what the writer marked up, not which rule
 * happened to claim it.
 */
const FORCED_ELEMENT = /^(?:[!@>~#=]|\.(?=[^.]))/;

/**
 * Decide what `text` should become when pasted as Fountain.
 *
 * Returns null when there is nothing to insert.
 */
export function planFountainInsert(text: string): FountainInsert | null {
  if (!text || text.trim() === '') return null;

  const parsed = parseFountain(text) as JSONContent;
  // Insert the blocks themselves, not the doc wrapper — setContent would
  // replace the whole script rather than paste into it.
  const content = parsed.content ?? [];
  if (content.length === 0) return null;

  const inline = asInlineText(content, text);
  return inline ? { blocks: content, inline } : { blocks: content };
}

/**
 * The inline content of a paste that turned out to be plain text, or null if
 * it turned out to be anything else.
 *
 * Plain text is one Action node, from one line, with nothing on it: an
 * attribute means the parser found markup that survived into the node — a
 * `===` page break ahead of it, the `>centred<` alignment — and that is
 * structure, so it keeps its block. Emphasis marks are not structure and come
 * through, so pasting `*whispered*` mid-sentence still arrives italic.
 */
function asInlineText(content: JSONContent[], text: string): JSONContent[] | null {
  if (content.length !== 1) return null;
  const [node] = content;
  if (node.type !== 'action') return null;
  if (node.attrs && Object.keys(node.attrs).length > 0) return null;
  if (!node.content || node.content.length === 0) return null;

  const trimmed = text.trim();
  if (trimmed.includes('\n')) return null;
  if (FORCED_ELEMENT.test(trimmed)) return null;

  return node.content;
}

/**
 * Parse `text` as Fountain and insert it at the current selection.
 * Returns false when there was nothing to insert.
 */
export function insertFountainText(editor: Editor, text: string): boolean {
  const plan = planFountainInsert(text);
  if (!plan) return false;

  // Inline content needs a textblock to go into. Anything else — a node
  // selection on an image, a gap cursor between blocks — has no caret inside
  // an element to insert at, so the blocks are the only form that can land.
  const inline = plan.inline && editor.state.selection.$from.parent.isTextblock
    ? plan.inline
    : null;

  editor.chain().focus().insertContent(inline ?? plan.blocks).run();
  return true;
}

export interface PasteFountainResult {
  ok: boolean;
  /** Set when the paste could not happen; safe to show to the user. */
  error?: string;
}

/**
 * Read the clipboard and insert its text as Fountain.
 *
 * Clipboard reads need an explicit permission in the browser and a focused
 * document everywhere, so failure is normal enough to report rather than throw.
 * The Android web view refuses the permission outright, so a refusal falls
 * through to the platform's own clipboard the way the other pastes do
 * (issue #102). This one loses nothing by it: Fountain is plain text already.
 *
 * The failure message is the shared one. It used to be a second hard-coded
 * copy, which is why this path told an iPhone user to "allow clipboard access"
 * instead of telling them to tap the Paste prompt iOS was showing them.
 */
export async function pasteAsFountain(editor: Editor): Promise<PasteFountainResult> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch (err) {
    console.error('Paste as Fountain: clipboard read failed', err);
    const native = await readNativeText();
    if (!native) return { ok: false, error: pasteFailureMessage() };
    text = native;
  }

  if (!insertFountainText(editor, text)) {
    return { ok: false, error: 'The clipboard is empty.' };
  }
  return { ok: true };
}
