/**
 * Revision output in the PDF beyond the asterisk itself: each revision's own
 * mark, revised pages on coloured paper, revised pages only, and locked page
 * labels in the header.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

interface Draw { text: string; x: number; y: number; page: number }
const draws: Draw[] = [];
let page = 1;
/** Each sheet's content stream, as jsPDF keeps it (index 0 unused). */
let pages: string[][] = [[], []];
let deleted: number[] = [];

vi.mock('jspdf', () => {
  class FakeJsPDF {
    private font = 'courier';
    internal = { get pages() { return pages; } };
    setFont(font: string) { this.font = font; }
    getFont() { return { fontName: this.font, fontStyle: 'normal' }; }
    addFileToVFS() {}
    addFont() {}
    setFontSize() {}
    setLineWidth() {}
    line() {}
    rect() {}
    addPage() { page++; pages.push([]); }
    setPage(n: number) { page = n; }
    deletePage(n: number) { deleted.push(n); }
    addImage() {}
    getTextWidth(text: string) { return 7.2 * text.length; }
    text(text: string, x: number, y: number) { draws.push({ text, x, y, page }); pages[page]?.push(`T ${text}`); }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF };
});
vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => true) }));

const { renderPDF } = await import('./pdfExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { revisionMarkXPt } = await import('./revisionPdf');

const rev = (text: string, color: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { revision: color } }] });
const txt = (text: string): JSONContent => ({ type: 'text', text });
const action = (...content: JSONContent[]): JSONContent => ({ type: 'action', content });
/** Enough plain action to fill a page. */
const filler = (n: number) => Array.from({ length: n }, (_, i) => action(txt(`Filler line ${i + 1}.`)));

const markX = revisionMarkXPt(DEFAULT_PAGE_LAYOUT.pageWidth * 72);
const marks = () => draws.filter((d) => Math.abs(d.x - markX) < 0.01).map((d) => d.text);

beforeEach(() => {
  draws.length = 0;
  page = 1;
  pages = [[], []];
  deleted = [];
});

describe('the mark beside a revised line', () => {
  const doc: JSONContent = {
    type: 'doc',
    content: [
      action(rev('A Blue change.', 'Blue')),
      action(rev('A Pink change.', 'Pink')),
      action(txt('Old text, '), rev('blue', 'Blue'), txt(' and '), rev('pink', 'Pink'), txt(' on one line.')),
    ],
  };

  it('is an asterisk by default', async () => {
    await renderPDF(doc, 't', DEFAULT_PAGE_LAYOUT);
    expect(marks()).toEqual(['*', '*', '*']);
  });

  it('is the custom character, and each revision its own, the latest winning a shared line', async () => {
    await renderPDF(doc, 't', DEFAULT_PAGE_LAYOUT, {
      revisionSettings: { markChar: '#', marks: { Pink: '+' }, colorPages: false },
    });
    expect(marks()).toEqual(['#', '+', '+']);
  });
});

describe('revised pages', () => {
  // Page 1 unrevised, page 2 Blue, page 3 Blue and Pink.
  const doc: JSONContent = {
    type: 'doc',
    content: [
      ...filler(5),
      { ...action(rev('Blue on page two.', 'Blue')), attrs: { startsNewPage: true } },
      ...filler(5),
      { ...action(rev('Blue on page three.', 'Blue')), attrs: { startsNewPage: true } },
      action(rev('Pink on page three.', 'Pink')),
    ],
  };

  it('tints only the revised sheets, in the latest revision on each', async () => {
    await renderPDF(doc, 't', DEFAULT_PAGE_LAYOUT, { colorRevisedPages: true });
    const tints = pages.map((stream) => stream.find((op) => / re f Q$/.test(op)) ?? null);
    expect(tints[1]).toBeNull();
    // Blue's paper #DCE8F6, Pink's #F8DCE7 — painted first, under the text.
    expect(tints[2]).toMatch(/^q 0\.863 0\.910 0\.965 rg/);
    expect(pages[2][0]).toBe(tints[2]);
    expect(tints[3]).toMatch(/^q 0\.973 0\.863 0\.906 rg/);
  });

  it('leaves every page white unless asked', async () => {
    await renderPDF(doc, 't', DEFAULT_PAGE_LAYOUT);
    expect(pages.flat().some((op) => / re f Q$/.test(op))).toBe(false);
  });

  it('drops the unrevised pages when only revised pages are wanted', async () => {
    await renderPDF(doc, 't', DEFAULT_PAGE_LAYOUT, { revisedPagesOnly: true });
    expect(page).toBeGreaterThanOrEqual(3);
    expect(deleted).toEqual([1]);
  });

  it('refuses a script with no revised pages', async () => {
    await expect(renderPDF({ type: 'doc', content: filler(5) }, 't', DEFAULT_PAGE_LAYOUT, { revisedPagesOnly: true }))
      .rejects.toThrow(/no revised pages/);
  });
});

describe('locked page labels', () => {
  it('prints the label in the header instead of the number', async () => {
    const doc: JSONContent = { type: 'doc', content: filler(90) };
    await renderPDF(doc, 't', DEFAULT_PAGE_LAYOUT, { pageLabels: ['1', '1A', '2', '3'] });
    const headers = draws.filter((d) => /^\d+[A-Z]*\.$/.test(d.text)).map((d) => `${d.page}:${d.text}`);
    expect(headers).toContain('2:1A.');
    expect(headers).toContain('3:2.');
  });
});
