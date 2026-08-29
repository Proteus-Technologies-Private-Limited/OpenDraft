/**
 * Editing the marks that tie a script note to its text.
 *
 * Three places used to walk the document themselves — the notes panel's delete
 * and colour buttons, and the context menu's delete — with three copies of the
 * same loop. They are one function each now, for the usual reason, and for one
 * specific bug they shared.
 *
 * **Why these dispatch directly rather than through `editor.chain()`.**
 * A TipTap chain runs all-or-nothing: if any command in it returns false the
 * chain is abandoned and *nothing* is dispatched. The delete paths began with
 * `.focus()`, which is unnecessary for rewriting a mark and which can fail —
 * the click comes from a confirm dialog, so the editor is not where focus is.
 * When it did fail the note vanished from the panel while its highlight stayed
 * on the page, because only the store half of the delete had happened. Nothing
 * here needs focus, so nothing here asks for it.
 */
import type { Editor } from '@tiptap/react';
import type { Mark, Node as PmNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

/** The mark that anchors a script note. */
const MARK_NAME = 'scriptNote';

/** The little of an editor these need, so they can be tested without a view. */
export interface MarkEditor {
  state: { doc: PmNode; tr: Transaction; schema: { marks: Record<string, unknown> } };
  view: { dispatch: (tr: Transaction) => void };
}

/**
 * A colour that lets what is behind it show through.
 *
 * Both `rgba(…, 0.2)` and an eight-digit `#rrggbbaa` count. This is how a
 * highlight left behind by the bug below is told apart from one the writer
 * actually pasted: a note's own background was always translucent, and a
 * highlight pasted from Word or Docs is not.
 */
export function isTranslucent(color: string): boolean {
  const c = color.trim().toLowerCase();
  const rgba = c.match(/^rgba?\([^)]*,\s*([\d.]+)\s*\)$/);
  if (rgba) return Number(rgba[1]) < 1;
  const hex = c.match(/^#[0-9a-f]{6}([0-9a-f]{2})$/);
  if (hex) return parseInt(hex[1], 16) < 255;
  return false;
}

/** Visit every text node carrying this note's mark. */
function eachMarked(
  editor: MarkEditor,
  noteId: string,
  visit: (mark: Mark, from: number, to: number, node: PmNode) => void,
): boolean {
  const markType = editor.state.schema.marks[MARK_NAME] as
    | { create(attrs: Record<string, unknown>): Mark }
    | undefined;
  if (!markType) return false;
  let found = false;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find(
      (m) => m.type === (markType as unknown) && m.attrs.noteId === noteId,
    );
    if (mark) {
      found = true;
      visit(mark, pos, pos + node.nodeSize, node);
    }
  });
  return found;
}

/**
 * Strip a note's highlight from the script.
 *
 * Returns false when the note had no mark left to remove, which is not a
 * failure — a general note never had one, and neither does a note whose text
 * the writer has since deleted.
 */
export function removeScriptNoteMarks(editor: Editor | MarkEditor | null, noteId: string): boolean {
  if (!editor || !noteId) return false;
  const ed = editor as unknown as MarkEditor;
  const { tr } = ed.state;
  const highlightType = ed.state.schema.marks.highlight as unknown;
  const found = eachMarked(ed, noteId, (mark, from, to, node) => {
    tr.removeMark(from, to, mark);
    // Repair: a document written before the mark stopped emitting a literal
    // `background-color` may carry a stray highlight over the same words,
    // harvested from the note's own span by PastedHighlight's style rule.
    // Removing the note alone would leave that behind, still coloured — which
    // is the bug this whole clause exists for. A highlight the writer really
    // pasted is opaque, so only a translucent one is swept up.
    if (!highlightType) return;
    for (const m of node.marks) {
      if (m.type === highlightType && isTranslucent(String(m.attrs.color ?? ''))) {
        tr.removeMark(from, to, m);
      }
    }
  });
  if (found) ed.view.dispatch(tr);
  return found;
}

/** Repaint a note's highlight after its colour is changed. */
export function recolorScriptNoteMarks(
  editor: Editor | MarkEditor | null,
  noteId: string,
  hex: string,
): boolean {
  if (!editor || !noteId) return false;
  const ed = editor as unknown as MarkEditor;
  const markType = ed.state.schema.marks[MARK_NAME] as
    | { create(attrs: Record<string, unknown>): Mark }
    | undefined;
  if (!markType) return false;
  const { tr } = ed.state;
  const found = eachMarked(ed, noteId, (mark, from, to) => {
    tr.removeMark(from, to, mark);
    tr.addMark(from, to, markType.create({ noteId, color: hex }));
  });
  if (found) ed.view.dispatch(tr);
  return found;
}

/**
 * Clear highlights that were never the writer's, left over from an older bug.
 *
 * A note paints itself with an inline `background-color`, and `PastedHighlight`
 * matches any element carrying one — so re-parsing the document's HTML (a copy
 * and paste inside the editor is enough) laid a second highlight over the noted
 * words. Two marks then painted the same text. It showed in two ways: turning
 * note highlights off left a stubborn yellow behind, because the stray is a
 * different mark that rule never touched; and deleting a note left its colour
 * on the page, because only the note's own mark went.
 *
 * New pastes no longer produce them (see `stripNoteBackgrounds`), but documents
 * written before that do, so they are swept once when a script is opened.
 *
 * Only a translucent highlight sitting on top of a note or a tag is taken: that
 * combination is this bug's signature. A highlight the writer pasted is opaque,
 * and one anywhere else is theirs regardless.
 */
export function sweepStrayNoteHighlights(editor: Editor | MarkEditor | null): number {
  if (!editor) return 0;
  const ed = editor as unknown as MarkEditor;
  const marks = ed.state.schema.marks;
  const highlightType = marks.highlight as unknown;
  const noteType = marks[MARK_NAME] as unknown;
  const tagType = marks.productionTag as unknown;
  if (!highlightType || (!noteType && !tagType)) return 0;

  const { tr } = ed.state;
  let swept = 0;
  ed.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const annotated = node.marks.some((m) => m.type === noteType || m.type === tagType);
    if (!annotated) return;
    for (const m of node.marks) {
      if (m.type === highlightType && isTranslucent(String(m.attrs.color ?? ''))) {
        tr.removeMark(pos, pos + node.nodeSize, m);
        swept++;
      }
    }
  });
  if (swept > 0) {
    // Not the writer's edit, so it does not belong in their undo history.
    ed.view.dispatch(tr.setMeta('addToHistory', false));
  }
  return swept;
}

/** Where a note's mark starts, or null when it has none in the document. */
export function findScriptNotePos(editor: Editor | MarkEditor | null, noteId: string): number | null {
  if (!editor || !noteId) return null;
  let at: number | null = null;
  eachMarked(editor as unknown as MarkEditor, noteId, (_mark, from) => {
    if (at === null) at = from;
  });
  return at;
}
