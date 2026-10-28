import { describe, it, expect, afterEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import { retypeImport, reviewRows, typeCounts } from './pdfImportReview';
import { requestPdfImportReview, usePdfImportReviewStore } from '../stores/pdfImportReviewStore';

const el = (type: string, text: string, attrs?: Record<string, unknown>): JSONContent =>
  ({ type, content: [{ type: 'text', text }], ...(attrs ? { attrs } : {}) });

const imported: JSONContent = {
  type: 'doc',
  content: [
    { type: 'titlePage', attrs: { tpField: 'tpTitle' }, content: [{ type: 'text', text: 'MY SCRIPT' }] },
    { type: 'titlePage', attrs: { tpField: 'tpWrittenBy' }, content: [{ type: 'text', text: 'Jo' }] },
    el('sceneHeading', 'INT. KITCHEN - DAY', { sceneNumber: '12A' }),
    el('action', 'MAYA', { textAlign: 'center' }),
    el('action', 'You came back.'),
    {
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [el('character', 'A'), el('dialogue', 'One.')] },
        { type: 'dualDialogueColumn', content: [el('character', 'B'), el('dialogue', 'Two.')] },
      ],
    },
  ],
};

describe('the rows to review', () => {
  it('lists each element once, the title page as one row, dual dialogue by its cues', () => {
    expect(reviewRows(imported).map((r) => [r.index, r.type, r.text, r.editable])).toEqual([
      [0, 'titlePage', 'Title page', false],
      [2, 'sceneHeading', 'INT. KITCHEN - DAY', true],
      [3, 'action', 'MAYA', true],
      [4, 'action', 'You came back.', true],
      [5, 'dualDialogue', 'A / B', false],
    ]);
  });

  it('counts the elements of each type', () => {
    expect(Object.fromEntries(typeCounts(reviewRows(imported)))).toEqual({
      titlePage: 1, sceneHeading: 1, action: 2, dualDialogue: 1,
    });
  });
});

describe('changing types', () => {
  it('sets the new types and keeps the text', () => {
    const out = retypeImport(imported, new Map([[3, 'character'], [4, 'dialogue']]));
    expect(out.content?.slice(3, 5).map((n) => [n.type, n.content?.[0]?.text])).toEqual([
      ['character', 'MAYA'],
      ['dialogue', 'You came back.'],
    ]);
  });

  it('drops attributes that only meant something on the old type', () => {
    const out = retypeImport(imported, new Map([[2, 'action'], [3, 'character']]));
    expect(out.content?.[2].attrs).toBeUndefined();
    expect(out.content?.[3].attrs).toBeUndefined();
  });

  it('leaves the title page, dual dialogue and the original document alone', () => {
    const before = JSON.stringify(imported);
    const out = retypeImport(imported, new Map([[0, 'action'], [5, 'action']]));
    expect(out.content?.[0].type).toBe('titlePage');
    expect(out.content?.[5].type).toBe('dualDialogue');
    expect(JSON.stringify(imported)).toBe(before);
  });

  it('with nothing changed is the same document', () => {
    expect(retypeImport(imported, new Map())).toBe(imported);
  });
});

describe('waiting on the review', () => {
  afterEach(() => usePdfImportReviewStore.setState({ pending: null, reviewers: 0 }));

  it('goes straight through when nothing is there to review it', async () => {
    await expect(requestPdfImportReview('a.pdf', imported, [])).resolves.toBe(imported);
  });

  it('waits for the writer, and gets back what they import', async () => {
    usePdfImportReviewStore.getState().setReviewerMounted(true);
    const result = requestPdfImportReview('a.pdf', imported, ['note']);
    const pending = usePdfImportReviewStore.getState().pending;
    expect(pending?.filename).toBe('a.pdf');
    expect(pending?.warnings).toEqual(['note']);
    const fixed = retypeImport(imported, new Map([[3, 'character']]));
    usePdfImportReviewStore.getState().finish(fixed);
    await expect(result).resolves.toBe(fixed);
    expect(usePdfImportReviewStore.getState().pending).toBeNull();
  });

  it('gets null on cancel, and a second import cancels the first', async () => {
    usePdfImportReviewStore.getState().setReviewerMounted(true);
    const first = requestPdfImportReview('a.pdf', imported, []);
    const second = requestPdfImportReview('b.pdf', imported, []);
    await expect(first).resolves.toBeNull();
    usePdfImportReviewStore.getState().finish(null);
    await expect(second).resolves.toBeNull();
  });
});
