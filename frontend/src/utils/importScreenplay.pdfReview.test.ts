/**
 * The PDF import preview, as the import path uses it: the writer's corrections
 * are what get imported, and cancelling leaves the open script's state alone.
 * The PDF reader is stubbed — what it reads is pdfImport.test.ts's business.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

const parsedDoc: JSONContent = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. LAB - NIGHT' }] },
    { type: 'action', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'ANA' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'Hello.' }] },
  ],
};

vi.mock('./pdfImport', () => ({
  parsePdfScreenplay: vi.fn(async () => ({
    doc: structuredClone(parsedDoc),
    title: 'Lab',
    warnings: [],
    layout: [{ page: 1, indent: 0 }, { page: 1, indent: 2.2 }, { page: 1, indent: 1 }],
  })),
}));

const { parseScreenplayImport, isImportCancelled } = await import('./importScreenplay');
const { setPdfImportReviewer, reviewRowsFrom, setTypeOf, applyReviewedTypes } = await import('./pdfImportReview');
const { useEditorStore } = await import('../stores/editorStore');

const openScene = { id: 'open-1', heading: 'INT. OPEN SCRIPT - DAY' } as never;
const bytes = new ArrayBuffer(8);

describe('PDF import preview in the import path', () => {
  let unregister: (() => void) | null = null;
  afterEach(() => { unregister?.(); unregister = null; });

  it('imports the document the writer approved', async () => {
    unregister = setPdfImportReviewer(async ({ parsed }) => {
      const rows = reviewRowsFrom(parsed);
      const types = setTypeOf(rows, rows.map((r) => r.originalType), new Set([1]), 'character');
      return applyReviewedTypes(parsed.doc, rows, types);
    });
    const result = await parseScreenplayImport('Lab.pdf', bytes);
    expect(result.doc.content?.map((n) => n.type)).toEqual(['sceneHeading', 'character', 'dialogue']);
    expect(result.doc.content?.[1].attrs).toBeUndefined();
    expect(result.title).toBe('Lab');
  });

  it('cancelling rejects quietly and leaves the open script’s state alone', async () => {
    useEditorStore.getState().setScenes([openScene]);
    unregister = setPdfImportReviewer(async () => null);

    const err = await parseScreenplayImport('Lab.pdf', bytes).catch((e: unknown) => e);

    expect(isImportCancelled(err)).toBe(true);
    expect(useEditorStore.getState().scenes).toEqual([openScene]);
  });

  it('skips the preview when the caller asks it to', async () => {
    const reviewer = vi.fn(async () => null);
    unregister = setPdfImportReviewer(reviewer);
    const result = await parseScreenplayImport('Lab.pdf', bytes, { hydrateStores: false, review: false });
    expect(reviewer).not.toHaveBeenCalled();
    expect(result.doc).toEqual(parsedDoc);
  });
});
