import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { useEditorStore, NOTE_COLORS } from '../stores/editorStore';
import { annotationText, sceneIdAtAnnotation, type AnnotationSelection } from './annotationSelection';
import { singleLine } from './nodeText';

/** The note mark under the caret, or null. */
function scriptNoteAtSelection(editor: Editor): Mark | null {
  const noteMarkType = editor.schema.marks.scriptNote;
  if (!noteMarkType) return null;
  const $from = editor.state.selection.$from;
  let noteMark = $from.marks().find((m) => m.type === noteMarkType);
  if (!noteMark) {
    const node = $from.nodeAfter || $from.nodeBefore;
    if (node?.marks) noteMark = node.marks.find((m) => m.type === noteMarkType);
  }
  return noteMark ?? null;
}

/**
 * ⇧⌘N: open the note under the cursor, or add a
 * note on the selection (the whole element when nothing is selected) and show
 * it in the Notes panel. On an empty element it just toggles the panel.
 */
export function addScriptNoteAtSelection(editor: Editor, selection?: AnnotationSelection): string | undefined {
  if (!editor.isEditable) return;
  const { scriptNotesOpen, toggleScriptNotes, addNote, setNoteFilter } = useEditorStore.getState();
  const { doc } = editor.state;
  const { $from, from, to, empty } = editor.state.selection;
  const selFrom = selection?.from ?? (empty ? $from.start() : from);
  const selTo = selection?.to ?? (empty ? $from.end() : to);
  const text = annotationText(doc, { from: selFrom, to: selTo });
  if (selection && (!text.trim() || text !== selection.text)) return;

  // A panel action can outlive editor focus. Read marks at the saved range
  // and keep existing note anchors if the selected text overlaps one.
  const markType = editor.schema.marks.scriptNote;
  if (!markType) return;
  let noteMark = selection ? null : scriptNoteAtSelection(editor);
  if (selection) {
    doc.nodesBetween(selFrom, selTo, node => {
      noteMark ??= node.marks.find(mark => mark.type === markType) ?? null;
    });
  }
  if (noteMark) {
    const noteId = noteMark.attrs.noteId as string;
    setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId });
    if (!scriptNotesOpen) toggleScriptNotes();
    return noteId;
  }

  if (!text.trim()) {
    toggleScriptNotes();
    return;
  }

  const parent = doc.resolve(Math.max(1, selFrom)).parent;
  const currentNodeType = parent.type.name;
  const nodeText = singleLine(parent.textContent);
  let contextLabel = nodeText.slice(0, 60);
  if (currentNodeType === 'character') {
    contextLabel = nodeText.replace(/\s*\([^)]*\)\s*/g, '').trim();
  } else if (currentNodeType === 'sceneHeading') {
    contextLabel = nodeText;
  } else if (currentNodeType === 'dialogue' || currentNodeType === 'parenthetical') {
    let charName = '';
    editor.state.doc.nodesBetween(0, selFrom, (node) => {
      if (node.type.name === 'character') {
        charName = singleLine(node.textContent).replace(/\s*\([^)]*\)\s*/g, '').trim();
      }
      return true;
    });
    if (charName) contextLabel = charName;
  }

  const defaultColor = NOTE_COLORS[0];
  const noteId = addNote({
    content: '',
    anchorText: text.slice(0, 120),
    elementType: currentNodeType,
    contextLabel,
    color: defaultColor.name,
    sceneId: sceneIdAtAnnotation(doc, selFrom),
  });

  const { tr } = editor.state;
  tr.addMark(selFrom, selTo, markType.create({ noteId, color: defaultColor.hex }));
  editor.view.dispatch(tr);
  editor.emit('update', { editor, transaction: tr });

  setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId });
  if (!scriptNotesOpen) toggleScriptNotes();
  return noteId;
}
