/**
 * Title-page images in the PDF take the lines the editor gives them.
 *
 * The editor and the paginator count an image as `heightLines` 12pt lines —
 * ceil(height / 16px) + 1. The PDF used to advance by the drawn height plus
 * 6pt instead, so every line below an image sat between half a line and a
 * line and a half higher on paper than on screen. And what fell off the
 * bottom of the sheet went with nothing but a console warning.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

interface DrawCall { text: string; y: number; page: number }

const draws: DrawCall[] = [];
const images: { y: number; h: number; page: number }[] = [];
let pages = 1;
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
    addPage() { pages++; currentPage = pages; }
    setPage(n: number) { currentPage = n; }
    addImage(_data: string, _fmt: string, _x: number, y: number, _w: number, h: number) { images.push({ y, h, page: currentPage }); }
    getTextWidth(text: string) { return 7.2 * text.length; }
    text(text: string, _x: number, y: number) { draws.push({ text, y, page: currentPage }); }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF };
});

vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => {}) }));

// Every picture is 200 x 100 px.
vi.mock('./imageAsset', () => ({
  resolveImageUrl: () => 'blob:picture',
  loadImageData: async () => ({ dataUrl: 'data:image/png;base64,', width: 200, height: 100 }),
}));

const { renderPDF } = await import('./pdfExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { imageHeightLines } = await import('./imageLines');

const line = (field: string, text: string): JSONContent => ({
  type: 'titlePage',
  attrs: { field, tpCustom: true },
  ...(text ? { content: [{ type: 'text', text }] } : {}),
});

const image = (width: number, heightLines: number): JSONContent => ({
  type: 'screenplayImage',
  attrs: { width, heightLines, tpCustom: true, scratchId: 'x' },
});

const script = (...titlePage: JSONContent[]): JSONContent => ({
  type: 'doc',
  content: [...titlePage, { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. HOUSE - DAY' }] }],
});

beforeEach(() => { draws.length = 0; images.length = 0; pages = 1; currentPage = 1; });

describe('PDF title-page images', () => {
  it('advances by the same number of lines the editor counts', async () => {
    // 200px wide, 100px tall: ceil(100 / 16) + 1 = 8 lines, as the NodeView records.
    const lines = imageHeightLines(200, 0.5);
    expect(lines).toBe(8);
    await renderPDF(script(image(200, lines), line('title', 'AFTER THE IMAGE')), 'Test', DEFAULT_PAGE_LAYOUT);

    const top = DEFAULT_PAGE_LAYOUT.topMargin;
    expect(images[0]).toMatchObject({ y: top, h: 75, page: 1 });
    const after = draws.find(d => d.text.includes('AFTER THE IMAGE'));
    // Line 9 of the page, drawn on its 12pt baseline — not 75 + 6 pt down.
    expect(after?.y).toBe(top + lines * 12 + 12);
  });

  it('places lines below two images exactly where the editor grid does', async () => {
    await renderPDF(
      script(image(200, 8), line('blank', ''), image(100, 5), line('author', 'BELOW')),
      'Test', DEFAULT_PAGE_LAYOUT,
    );
    const top = DEFAULT_PAGE_LAYOUT.topMargin;
    expect(images.map(i => i.y)).toEqual([top, top + 9 * 12]);
    expect(draws.find(d => d.text === 'BELOW')?.y).toBe(top + (8 + 1 + 5) * 12 + 12);
  });

  it('never advances by less than the picture needs, so a stale count cannot overlap the next line', async () => {
    // The stored count says 2 lines; drawn 200px wide the picture needs 8.
    await renderPDF(script(image(200, 2), line('title', 'NEXT')), 'Test', DEFAULT_PAGE_LAYOUT);
    expect(draws.find(d => d.text === 'NEXT')?.y).toBe(DEFAULT_PAGE_LAYOUT.topMargin + 8 * 12 + 12);
  });

  it('tells the writer when the title page runs past the bottom margin', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // 54 usable lines on US Letter: a 50-line image leaves no room for 10 more.
      const lines = Array.from({ length: 10 }, (_, i) => line('blank', `Line ${i + 1}`));
      const { warning } = await renderPDF(script(image(200, 50), ...lines), 'Overflowing', DEFAULT_PAGE_LAYOUT);
      expect(warning).toBeTruthy();
      expect(warning).toContain('title page');
      expect(draws.some(d => d.text === 'Line 10')).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/title page overflow in "Overflowing".*text line/));
    } finally {
      warn.mockRestore();
    }
  });

  it('says nothing when the title page fits', async () => {
    const { warning } = await renderPDF(script(image(200, 8), line('title', 'FITS')), 'Test', DEFAULT_PAGE_LAYOUT);
    expect(warning).toBeUndefined();
  });
});
