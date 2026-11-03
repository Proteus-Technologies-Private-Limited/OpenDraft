/**
 * Plain text from a reply, put into the script as editorial content.
 *
 * A reply is text, not HTML, and a newline in it is a new line in the script —
 * the way Enter behaves — not a `\n` character inside one block. Everything
 * goes through a single transaction, so one undo takes the whole insertion
 * back, which is what the writer sees as one action.
 */
import { Fragment } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { CommandElement } from './types';

/**
 * Replace `from..to` with `text`, one block per line.
 *
 * A single line without `element` stays inline, so inserting a sentence into a
 * paragraph does not chop the paragraph in two. Everything else becomes blocks:
 * `element` when given, otherwise the type of the block being edited.
 *
 * Returns the position where the inserted text ends, for the caret.
 */
export function insertPlainText(
  tr: Transaction,
  from: number,
  to: number,
  text: string,
  element?: CommandElement,
): number {
  // Marks at the caret are not the reply's: without this, text inserted inside
  // a bold line arrived bold.
  tr.setStoredMarks([]);

  const lines = text.split(/\r?\n/);
  if (lines.length === 1 && !element) {
    tr.insertText(lines[0], from, to);
    return from + lines[0].length;
  }

  const { schema } = tr.doc.type;
  const $from = tr.doc.resolve(from);
  const base = $from.parent;
  const requested = element ? schema.nodes[element] : null;
  // A node that cannot hold text (an act break) would throw on create; the
  // words are the point, so keep the element being edited.
  const canHoldText = !requested || requested.isTextblock;
  // Nor may it go where its container does not allow it: a scene heading asked
  // for inside a dual dialogue column cannot sit there, and ProseMirror would
  // fit it by splitting the dual dialogue in two around empty cue and dialogue
  // lines. The words go in as the element being edited instead.
  const container = $from.depth > 0 ? $from.node($from.depth - 1) : null;
  const index = $from.depth > 0 ? $from.index($from.depth - 1) : 0;
  const allowedHere = !requested || !container
    || container.canReplaceWith(index, index + 1, requested);
  const type = requested && canHoldText && allowedHere ? requested : base.type;
  // A new block starts from its element's defaults: a reply line is a new
  // line, not a copy of the block it lands next to. Copying `base.attrs` here
  // gave every line the same sceneUid, locked scene number, bookmark, page
  // anchor or set of versions.
  const attrs = null;

  if (lines.length === 1) {
    // Replace the words, then retype the block they are in. Both steps sit in
    // the one transaction the caller dispatches.
    tr.insertText(lines[0], from, to);
    const $pos = tr.doc.resolve(Math.min(from, tr.doc.content.size));
    if ($pos.depth > 0) tr.setBlockType($pos.before(), $pos.after(), type, attrs);
    return from + lines[0].length;
  }

  // Several lines: take the selection out, then put the blocks where it was.
  tr.delete(from, to);
  const nodes = lines.map((line) => type.create(attrs, line ? schema.text(line) : null));
  const fragment = Fragment.fromArray(nodes);

  let at = from;
  const $at = tr.doc.resolve(at);
  if ($at.depth === 0) {
    // The very start or end of the document is already between blocks.
  } else if ($at.parent.content.size === 0) {
    // An empty line is replaced outright, so the reply does not leave it behind.
    tr.replaceWith($at.before(), $at.after(), fragment);
    return $at.before() + fragment.size - 1;
  } else if ($at.parentOffset === 0) {
    at = $at.before();
  } else if ($at.parentOffset === $at.parent.content.size) {
    at = $at.after();
  } else {
    // Split the line and put the reply between the halves. The first half is
    // the block the writer was on and keeps its identity; the second half is
    // a new block and starts from defaults, as Enter does (`keepOnSplit`).
    // A bare `split` copies every attribute, so a heading split mid-line had
    // two halves with the one sceneUid.
    tr.split(at, 1, [{ type: $at.parent.type, attrs: null }]);
  }

  tr.replaceWith(at, at, fragment);
  return at + fragment.size - 1;
}
