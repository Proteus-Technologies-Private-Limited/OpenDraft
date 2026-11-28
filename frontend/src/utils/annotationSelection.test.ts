import type { Editor } from '@tiptap/core';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditorStore } from '../stores/editorStore';
import { block, doc, pmDoc, testSchema } from '../test/screenplaySchema';
import { addScriptNoteAtSelection } from './addScriptNote';
import { annotationText, pendingTagForRange, readAnnotationSelection } from './annotationSelection';

function testEditor(...blocks: ReturnType<typeof block>[]) {
  let state = EditorState.create({ doc: pmDoc(doc(...blocks)) });
  return {
    schema: testSchema,
    isEditable: true,
    get state() { return state; },
    view: { dispatch: (tr: typeof state.tr) => { state = state.apply(tr); } },
    emit: vi.fn(),
  } as unknown as Editor;
}

const storeBeforeTest = useEditorStore.getState();
afterEach(() => useEditorStore.setState(storeBeforeTest, true));

describe('creating annotations from a panel', () => {
  it('uses the captured text for a note even after the selection collapses', () => {
    const editor = testEditor(block('action', 'The crew packs a lantern.'));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 18, 25)));
    const selection = readAnnotationSelection(editor);
    expect(selection?.text).toBe('lantern');
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1)));
    const noteId = addScriptNoteAtSelection(editor, selection!);
    expect(useEditorStore.getState().notes.at(-1)).toMatchObject({ id: noteId, anchorText: 'lantern' });
    expect(editor.state.doc.rangeHasMark(18, 25, testSchema.marks.scriptNote)).toBe(true);
    expect(editor.state.doc.rangeHasMark(1, 18, testSchema.marks.scriptNote)).toBe(false);
  });

  it('rejects stale note selections and keeps an existing note on repeated clicks', () => {
    const editor = testEditor(block('action', 'The crew packs a lantern.'));
    const before = useEditorStore.getState().notes.length;
    const range = { from: 18, to: 25, text: 'lantern' };
    expect(addScriptNoteAtSelection(editor, { ...range, text: 'A different selection' })).toBeUndefined();
    const noteId = addScriptNoteAtSelection(editor, range);
    expect(addScriptNoteAtSelection(editor, range)).toBe(noteId);
    expect(useEditorStore.getState().notes).toHaveLength(before + 1);
  });

  it('captures the exact tag text and scene and keeps the full range for validation', () => {
    const heading = block('sceneHeading', 'INT. WAREHOUSE - DAY');
    const selectedText = 'Equipment '.repeat(15).trim();
    const editor = testEditor(heading, block('action', `She checks ${selectedText} before lunch.`));
    const from = editor.state.doc.firstChild!.nodeSize + 1 + 'She checks '.length;
    const to = from + selectedText.length;
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    const selection = readAnnotationSelection(editor);
    expect(selection).toEqual({ from, to, text: selectedText });
    expect(pendingTagForRange(editor.state.doc, selection!)).toEqual({
      from, to, text: selectedText, sceneId: 'scene-0', elementType: 'action',
    });
    expect(annotationText(editor.state.doc, { from, to: editor.state.doc.content.size + 1 })).toBe('');
  });

  it('does not offer actions for a caret, whitespace, or a read-only editor', () => {
    const editor = testEditor(block('action', 'A word'));
    expect(readAnnotationSelection(editor)).toBeNull();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2, 3)));
    expect(readAnnotationSelection(editor)).toBeNull();
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3, 7)));
    expect(readAnnotationSelection({ state: editor.state, isEditable: false } as Editor)).toBeNull();
  });
});
