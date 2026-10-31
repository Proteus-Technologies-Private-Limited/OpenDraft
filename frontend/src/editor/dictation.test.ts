import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { history, undo } from '@tiptap/pm/history';
import { testSchema, block, doc } from '../test/screenplaySchema';
import { dictationTransaction } from './dictation';
const state = (text = '', type = 'action') => EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(block(type, ...(text ? [text] : [])))), plugins: [history()] });
describe('dictation editor transactions', () => {
  it('inserts plain text, never markup', () => {
    const s = state();
    const next = s.apply(dictationTransaction(s, '<b>Hello</b>', false)!);
    expect(next.doc.firstChild?.textContent).toBe('<b>Hello</b>');
    expect(next.doc.firstChild?.firstChild?.marks).toHaveLength(0);
  });
  it('spaces text inserted between words and preserves surrounding text', () => {
    let s = state('BeforeAfter'); s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 7)));
    expect(s.apply(dictationTransaction(s, 'spoken', false)!).doc.textContent).toBe('Before spoken After');
  });
  it('replaces only the selected text', () => {
    let s = state('old text'); s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 1, 4)));
    expect(s.apply(dictationTransaction(s, 'new', false)!).doc.textContent).toBe('new text');
  });
  it('starts a scene after the existing paragraph without converting its words', () => {
    let s = state('She waits.'); s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 3, 5)));
    const next = s.apply(dictationTransaction(s, 'new scene', true)!);
    expect(next.doc.child(0).textContent).toBe('She waits.');
    expect(next.doc.child(0).type.name).toBe('action');
    expect(next.doc.child(1).type.name).toBe('sceneHeading');
    expect(next.doc.child(1).textContent).toBe('');
  });
  it('reuses a blank paragraph for a named character', () => {
    const s = state(); const next = s.apply(dictationTransaction(s, 'character Sarah', true)!);
    expect(next.doc.childCount).toBe(1);
    expect(next.doc.firstChild?.type.name).toBe('character');
    expect(next.doc.textContent).toBe('SARAH');
  });
  it('leaves unsupported elements and structural selections unchanged', () => {
    const s = state('Title', 'titlePage');
    expect(dictationTransaction(s, 'new scene', true)).toBeNull();
    const multi = EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(block('action', 'One'), block('action', 'Two'))) });
    const selected = multi.apply(multi.tr.setSelection(TextSelection.create(multi.doc, 2, 8)));
    expect(dictationTransaction(selected, 'new scene', true)).toBeNull();
  });
  it('does not put a scene heading inside a dual-dialogue column', () => {
    const dual = { type: 'dualDialogue', content: ['SARAH', 'JOHN'].map(name => ({ type: 'dualDialogueColumn', content: [block('character', name), block('dialogue', 'Hello')] })) };
    let s = EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(dual)) });
    let at = 0;
    s.doc.descendants((node, pos) => { if (!at && node.type.name === 'dialogue') at = pos + 1; });
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, at)));
    expect(dictationTransaction(s, 'new scene', true)).toBeNull();
    expect(s.apply(dictationTransaction(s, 'spoken text', false)!).doc.textContent).toContain('spoken text');
  });
  it('is one undoable edit', () => {
    let s = state('Original.'); s = s.apply(dictationTransaction(s, 'new scene', true)!);
    expect(undo(s, tr => { s = s.apply(tr); })).toBe(true);
    expect(s.doc.toJSON()).toEqual(state('Original.').doc.toJSON());
  });
});
