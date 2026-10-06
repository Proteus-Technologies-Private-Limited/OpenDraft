/**
 * Revision Mode's asterisks in the PDF: one in the right margin of every line
 * holding revised text, on that line's baseline, and nowhere else.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

interface Draw { text: string; x: number; y: number; page: number }
const draws: Draw[] = [];
let page = 1;

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
    rect() {}
    addPage() { page++; }
    setPage(n: number) { page = n; }
    addImage() {}
    getTextWidth(text: string) { return 7.2 * text.length; }
    text(text: string, x: number, y: number) { draws.push({ text, x, y, page }); }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF };
});
vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => true) }));

const { exportPDF } = await import('./pdfExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { wordWrapRuns } = await import('./wrapText');
const { revisedLineIndices, revisionMarkXPt } = await import('./revisionPdf');

const rev = (text: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { revision: 'Blue' } }] });
const txt = (text: string): JSONContent => ({ type: 'text', text });

const LONG = 'He crosses the room slowly, stops at the window and looks down at the empty street below for a long time.';

const doc = (): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'action', content: [txt('Unchanged opening line.')] },
    // Long enough to wrap: both of its lines are revised.
    { type: 'action', content: [rev(LONG)] },
    { type: 'action', content: [txt('Nothing new here either.')] },
    // A deletion left only the block flag.
    { type: 'action', attrs: { revised: 'Blue' }, content: [txt('Something was cut from this line.')] },
  ],
});

const asterisks = () => draws.filter((d) => d.text === '*');

describe('PDF revision asterisks', () => {
  beforeEach(() => { draws.length = 0; page = 1; });

  it('marks each revised line, on its baseline, in the right margin', async () => {
    await exportPDF(doc(), 'Rev', DEFAULT_PAGE_LAYOUT, { includeTitlePage: false });
    const stars = asterisks();
    // Two wrapped lines of the revised action + the flagged line.
    expect(stars).toHaveLength(3);
    const x = revisionMarkXPt(DEFAULT_PAGE_LAYOUT.pageWidth * 72);
    for (const s of stars) {
      expect(s.x).toBe(x);
      // Something of the script is drawn on the same baseline.
      expect(draws.some((d) => d !== s && d.text !== '*' && d.y === s.y && d.page === s.page)).toBe(true);
    }
    const lineOf = (needle: string) => draws.find((d) => d.text.includes(needle))!.y;
    const ys = stars.map((s) => s.y);
    expect(ys).toContain(lineOf('He crosses'));
    expect(ys).toContain(lineOf('Something was cut'));
    expect(ys).not.toContain(lineOf('Unchanged opening'));
    expect(ys).not.toContain(lineOf('Nothing new'));
  });

  it('draws none when asked not to', async () => {
    await exportPDF(doc(), 'Rev', DEFAULT_PAGE_LAYOUT, { includeTitlePage: false, showRevisionMarks: false });
    expect(asterisks()).toHaveLength(0);
  });

  it('marks revised lines inside an AV table, in the page margin', async () => {
    const cell = (side: string, para: JSONContent) => ({ type: 'avCell', attrs: { side }, content: [para] });
    const av: JSONContent = {
      type: 'doc',
      content: [{
        type: 'avBlock',
        content: [{
          type: 'avRow',
          attrs: { duration: null, shot: null, start: null },
          content: [
            cell('video', { type: 'avPara', content: [txt('WIDE ON THE HARBOUR')] }),
            cell('audio', { type: 'avPara', content: [rev('NARRATOR: A new line of narration.')] }),
          ],
        }],
      }],
    };
    await exportPDF(av, 'AV', DEFAULT_PAGE_LAYOUT, { includeTitlePage: false });
    const stars = asterisks();
    expect(stars.length).toBeGreaterThan(0);
    const x = revisionMarkXPt(DEFAULT_PAGE_LAYOUT.pageWidth * 72);
    expect(stars.every((s) => s.x === x)).toBe(true);
    const narration = draws.find((d) => d.text.includes('NARRATOR'))!;
    expect(stars.map((s) => s.y)).toContain(narration.y);
    const video = draws.find((d) => d.text.includes('HARBOUR'))!;
    expect(video.y === narration.y || !stars.some((s) => s.y === video.y && video.y !== narration.y)).toBe(true);
  });

  it('draws none for a script without revisions', async () => {
    const plain: JSONContent = { type: 'doc', content: [{ type: 'action', content: [txt(LONG)] }] };
    await exportPDF(plain, 'Plain', DEFAULT_PAGE_LAYOUT, { includeTitlePage: false });
    expect(asterisks()).toHaveLength(0);
  });
});

describe('revisedLineIndices', () => {
  const run = (text: string, revised = false) => ({ text, bold: false, italic: false, underline: false, ...(revised ? { revised: true } : {}) });

  it('marks only the line a revised word wrapped onto', () => {
    const lines = wordWrapRuns([run('aaaa bbbb '), run('cccc', true)], 10, false);
    expect(lines.map((l) => l.map((r) => r.text).join(''))).toEqual(['aaaa bbbb', 'cccc']);
    expect(revisedLineIndices(lines)).toEqual([1]);
  });

  it('keeps the flag when a revised word merges into an unrevised run', () => {
    const lines = wordWrapRuns([run('aa '), run('bb', true)], 40, true);
    expect(lines).toHaveLength(1);
    expect(revisedLineIndices(lines)).toEqual([0]);
  });

  it('keeps the flag through uppercasing and long-token splits', () => {
    const lines = wordWrapRuns([run('x'.repeat(25), true)], 10, true);
    expect(lines).toHaveLength(3);
    expect(revisedLineIndices(lines)).toEqual([0, 1, 2]);
  });

  it('places the asterisk inside narrow paper', () => {
    expect(revisionMarkXPt(8.5 * 72)).toBe(7.85 * 72);
    expect(revisionMarkXPt(8.0 * 72)).toBeCloseTo(7.6 * 72, 6);
  });
});
