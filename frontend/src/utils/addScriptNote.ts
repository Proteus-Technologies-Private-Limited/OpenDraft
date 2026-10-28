import type { Editor } from '@tiptap/core';
import { useEditorStore, NOTE_COLORS } from '../stores/editorStore';
import { singleLine } from './nodeText';

/**
 * The toolbar's Notes button and ⇧⌘N: open the note under the cursor, or add a
 * note on the selection (the whole element when nothing is selected) and show
 * it in the Notes panel. On an empty element it just toggles the panel.
 */
export function addScriptNoteAtSelection(editor: Editor): void {
  const { scriptNotesOpen, toggleScriptNotes, addNote, setNoteFilter } = useEditorStore.getState();

  // Detect if cursor is on an existing note
  const noteMarkType = editor.schema.marks.scriptNote;
  if (noteMarkType) {
    const $from = editor.state.selection.$from;
    let noteMark = $from.marks().find((m) => m.type === noteMarkType);
    if (!noteMark) {
      const node = $from.nodeAfter || $from.nodeBefore;
      if (node?.marks) noteMark = node.marks.find((m) => m.type === noteMarkType);
    }
    if (noteMark) {
      setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId: noteMark.attrs.noteId as string });
      if (!scriptNotesOpen) toggleScriptNotes();
      return;
    }
  }

  const { from, to, empty } = editor.state.selection;
  const $from = editor.state.selection.$from;
  const selFrom = empty ? $from.start() : from;
  const selTo = empty ? $from.end() : to;
  const text = editor.state.doc.textBetween(selFrom, selTo, ' ');

  if (!text.trim()) {
    toggleScriptNotes();
    return;
  }

  const currentNodeType = $from.parent.type.name;
  const nodeText = singleLine($from.parent.textContent);
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

  let sceneId: string | null = null;
  let sceneIdx = 0;
  editor.state.doc.nodesBetween(0, selFrom, (node) => {
    if (node.type.name === 'sceneHeading') { sceneId = `scene-${sceneIdx}`; sceneIdx++; }
    return true;
  });

  const defaultColor = NOTE_COLORS[0];
  const noteId = addNote({
    content: '',
    anchorText: text.slice(0, 120),
    elementType: currentNodeType,
    contextLabel,
    color: defaultColor.name,
    sceneId,
  });

  const { tr } = editor.state;
  const markType = editor.schema.marks.scriptNote;
  if (markType) {
    tr.addMark(selFrom, selTo, markType.create({ noteId, color: defaultColor.hex }));
    editor.view.dispatch(tr);
    editor.emit('update', { editor, transaction: tr });
  }

  setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId });
  if (!scriptNotesOpen) toggleScriptNotes();
}
