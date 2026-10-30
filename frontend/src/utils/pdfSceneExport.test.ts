/**
 * PDF export choices: which scenes, and whether page numbers are drawn.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import { sceneRangeDocument } from './pdfSceneExport';

interface DrawCall { text: string; page: number }

const draws: DrawCall[] = [];
let currentPage = 1;

vi.mock('jspdf', () => {
  class FakeJsPDF {
    private font = 'courier';
    setFont(font: string) { this.font = font; }
    getFont() { return { fontName: this.font, fontStyle: 'normal' }; }
    addFileToVFS() {}
    addFont() {}
    setFontSize() {}
    setLineWidth() {}
    line() {}
    addPage() { currentPage++; }
    setPage(n: number) { currentPage = n; }
    addImage() {}
    getTextWidth(text: string) { return 7.2 * text.length; }
    text(text: string) { draws.push({ text, page: currentPage }); }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF };
});

vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => {}) }));

const { exportPDF } = await import('./pdfExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');

const block = (type: string, text: string): JSONContent => ({
  type, content: [{ type: 'text', text }],
});

const script = (): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'titlePage', attrs: { field: 'title', tpTitle: 'THE SCRIPT' }, content: [{ type: 'text', text: 'THE SCRIPT' }] },
    block('sceneHeading', 'INT. HOUSE - DAY'),
    block('action', 'She waits.'),
    block('sceneHeading', 'EXT. STREET - NIGHT'),
    block('action', 'A car passes.'),
    block('sceneHeading', 'INT. CAR - CONTINUOUS'),
    block('action', 'She drives away.'),
  ],
});

const textsOf = (doc: JSONContent): string[] => (doc.content ?? []).map(
  (node) => (node.content ?? []).map((child) => child.text ?? '').join(''),
);

beforeEach(() => { draws.length = 0; currentPage = 1; });

describe('PDF scene range', () => {
  it('keeps the title page and only the chosen scenes', () => {
    const out = sceneRangeDocument(script(), { from: 1, to: 2, oneScenePerPage: false });
    expect(textsOf(out)).toEqual([
      'THE SCRIPT',
      'EXT. STREET - NIGHT',
      'A car passes.',
      'INT. CAR - CONTINUOUS',
      'She drives away.',
    ]);
  });

  it('leaves a full export untouched when no scene break is asked for', () => {
    const doc = script();
    expect(sceneRangeDocument(doc, { from: 0, to: 2, oneScenePerPage: false })).toBe(doc);
  });

  it('marks every scene to start its own page', () => {
    const out = sceneRangeDocument(script(), { from: 0, to: 2, oneScenePerPage: true });
    const headings = (out.content ?? []).filter((node) => node.type === 'sceneHeading');
    expect(headings).toHaveLength(3);
    for (const heading of headings) expect(heading.attrs?.startsNewPage).toBe(true);
  });

  it('clamps a range that runs past the script', () => {
    const out = sceneRangeDocument(script(), { from: 0, to: 99, oneScenePerPage: false });
    expect(textsOf(out)).toEqual(textsOf(script()));
  });
});

describe('PDF page numbers', () => {
  const layout = {
    ...DEFAULT_PAGE_LAYOUT,
    headerStartPage: 1,
    headerContent: { left: '', center: '', right: '{page}.' },
  };

  it('draws them by default', async () => {
    await exportPDF(script(), 'Test', layout, { includeTitlePage: false });
    expect(draws.map((d) => d.text)).toContain('1.');
  });

  it('leaves them out when the writer turns them off', async () => {
    await exportPDF(script(), 'Test', layout, { includeTitlePage: false, pageNumbers: false });
    expect(draws.map((d) => d.text)).not.toContain('1.');
  });
});
