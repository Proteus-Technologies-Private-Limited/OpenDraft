import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import { block, doc, pmDoc } from '../test/screenplaySchema';
import { docJSON, readEditor } from './useEditorTransactions';

const fakeEditor = (overrides: Partial<Editor> = {}) =>
  ({ isDestroyed: false, state: { doc: pmDoc(doc(block('action', 'A'))) }, ...overrides }) as unknown as Editor;

afterEach(() => vi.restoreAllMocks());

describe('readEditor', () => {
  it('reads the editor it is given', () => {
    const ed = fakeEditor();
    expect(readEditor(ed, (e) => e.state.doc.textContent, '', 'text')).toBe('A');
  });

  it('answers the fallback without an editor, or for a destroyed one', () => {
    expect(readEditor(null, () => 'read', 'fallback', 'text')).toBe('fallback');
    expect(readEditor(fakeEditor({ isDestroyed: true }), () => 'read', 'fallback', 'text')).toBe('fallback');
  });

  it('logs a selector that throws and answers the fallback instead of throwing during render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = readEditor(fakeEditor(), () => { throw new Error('malformed doc'); }, false, 'whether the script has an AV body');
    expect(result).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[editor] whether the script has an AV body could not be read from the editor',
      expect.any(Error),
    );
  });
});

describe('docJSON', () => {
  it('serialises a document once, and a changed document afresh', () => {
    const first = pmDoc(doc(block('action', 'One')));
    const spy = vi.spyOn(first, 'toJSON');
    const json = docJSON(first);
    expect(docJSON(first)).toBe(json);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(json).toEqual(first.toJSON());

    const second = pmDoc(doc(block('action', 'Two')));
    expect(docJSON(second)).not.toBe(json);
    expect(docJSON(second)).toEqual(second.toJSON());
  });
});
