/**
 * The PDF and the editor must agree about footnotes.
 *
 * Everything in OpenDraft's pagination exists to keep the page count on screen
 * equal to the page count in the file the writer sends out — the doc comment in
 * `wrapText.ts` says so explicitly. Footnotes introduce a second thing that has
 * to agree: the room held back at the foot of a page. These drive a real export
 * through a recording jsPDF stub and check it against `computeBreaks`.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

interface DrawCall { text: string; x: number; y: number; page: number }

const draws: DrawCall[] = [];
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
    addImage() {}
    getTextWidth(text: string) { return 7.2 * text.length; }
    text(text: string, x: number, y: number) { draws.push({ text, x, y, page: currentPage }); }
    output() { return new ArrayBuffer(0); }
  }
  return { default: FakeJsPDF };
});

vi.mock('./fileOps', () => ({ saveFile: vi.fn(async () => {}) }));
vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true, arrayBuffer: async () => new Uint8Array([0, 1, 0, 0]).buffer,
})));

const { exportPDF } = await import('./pdfExporter');
const { computeBreaks } = await import('../editor/pagination');
const { buildFootnotePlan } = await import('./footnotes');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { pmDoc } = await import('../test/screenplaySchema');
type NoteInfo = import('../stores/editorStore').NoteInfo;
type PageLayout = import('../stores/editorStore').PageLayout;
type FootnoteSettings = import('../stores/editorStore').FootnoteSettings;

const CTX = { assets: [], assetUrl: () => null };

const note = (id: string, content = 'Davis, M. (1990). City of Quartz.', over: Partial<NoteInfo> = {}): NoteInfo => ({
  id, content, anchorText: '', elementType: 'action', contextLabel: '',
  color: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z', sceneId: null,
  printInScript: true, ...over,
});

const layout = (over: Partial<FootnoteSettings> = {}): PageLayout => ({
  ...DEFAULT_PAGE_LAYOUT,
  footnotes: { ...DEFAULT_PAGE_LAYOUT.footnotes!, enabled: true, ...over },
});

const action = (text: string): JSONContent => ({ type: 'action', content: [{ type: 'text', text }] });
const noted = (text: string, noteId: string): JSONContent => ({
  type: 'action',
  content: [{ type: 'text', text, marks: [{ type: 'scriptNote', attrs: { noteId, color: '#f4d35e' } }] }],
});
const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks });
const filler = (n: number, from = 0) => Array.from({ length: n }, (_, i) => action(`Line ${from + i}.`));

beforeEach(() => { draws.length = 0; pages = 1; currentPage = 1; });

/** Run an export and report how many sheets it produced. */
async function sheetsFor(json: JSONContent, notes: NoteInfo[] | null, l: PageLayout) {
  const plan = notes ? buildFootnotePlan(json, l, notes, CTX) : null;
  await exportPDF(json, 'Test', l, { footnotes: plan });
  return { sheets: pages, plan };
}

describe('the PDF agrees with the editor', () => {
  it('produces the same page count with footnotes as computeBreaks does', async () => {
    const json = doc(noted('Referenced action.', 'n1'), ...filler(60, 1));
    const l = layout();
    const notes = [note('n1')];
    const { sheets, plan } = await sheetsFor(json, notes, l);
    const expected = computeBreaks(pmDoc(json), l, undefined, plan).pageCount;
    expect(sheets).toBe(expected);
  });

  it('agrees when the footnote is long enough to move a break', async () => {
    const json = doc(noted('Referenced action.', 'n1'), ...filler(60, 1));
    const l = layout();
    const notes = [note('n1', 'x'.repeat(300))];
    const { sheets, plan } = await sheetsFor(json, notes, l);
    expect(sheets).toBe(computeBreaks(pmDoc(json), l, undefined, plan).pageCount);
  });

  it('agrees for a bracketed marker, which occupies the line', async () => {
    const json = doc(noted('z'.repeat(62), 'n1'), ...filler(60, 1));
    const l = layout({ markerStyle: 'bracketed' });
    const notes = [note('n1')];
    const { sheets, plan } = await sheetsFor(json, notes, l);
    expect(sheets).toBe(computeBreaks(pmDoc(json), l, undefined, plan).pageCount);
  });

  it('agrees in endnote mode, where the notes get sheets of their own', async () => {
    const json = doc(noted('Referenced action.', 'n1'), ...filler(60, 1));
    const l = layout({ placement: 'endnote' });
    const notes = [note('n1')];
    const { sheets, plan } = await sheetsFor(json, notes, l);
    expect(sheets).toBe(computeBreaks(pmDoc(json), l, undefined, plan).pageCount);
  });
});

describe('what actually reaches the page', () => {
  it('draws the marker and the note', async () => {
    const json = doc(noted('Referenced action.', 'n1'), ...filler(10, 1));
    await sheetsFor(json, [note('n1')], layout());
    const text = draws.map((d) => d.text);
    expect(text).toContain('1');
    expect(text.some((t) => t.includes('Davis, M.'))).toBe(true);
  });

  it('draws the marker raised, above the line it belongs to', async () => {
    const json = doc(noted('Referenced action.', 'n1'), ...filler(10, 1));
    await sheetsFor(json, [note('n1')], layout());
    const anchor = draws.find((d) => d.text.includes('Referenced action.'))!;
    const marker = draws.find((d) => d.text === '1' && Math.abs(d.y - anchor.y) < 8)!;
    expect(marker).toBeDefined();
    expect(marker.y).toBeLessThan(anchor.y);
    // ...and it starts where the anchored phrase ends, overhanging into the
    // space after it rather than pushing the text along.
    expect(marker.x).toBeGreaterThan(anchor.x);
  });

  it('puts the note at the foot of the page carrying its reference', async () => {
    const json = doc(noted('Referenced action.', 'n1'), ...filler(60, 1));
    await sheetsFor(json, [note('n1')], layout());
    const entry = draws.find((d) => d.text.includes('Davis, M.'))!;
    expect(entry.page).toBe(1);
  });

  it('collects the notes on a NOTES sheet in endnote mode', async () => {
    const json = doc(noted('Referenced action.', 'n1'), ...filler(60, 1));
    await sheetsFor(json, [note('n1')], layout({ placement: 'endnote' }));
    const heading = draws.find((d) => d.text === 'NOTES')!;
    const entry = draws.find((d) => d.text.includes('Davis, M.'))!;
    expect(heading).toBeDefined();
    expect(entry.page).toBe(heading.page);
    expect(heading.page).toBe(pages);
  });
});

describe('the off contract', () => {
  const json = doc(noted('Referenced action.', 'n1'), ...filler(60, 1));

  /** Every string the export drew, in order. */
  const snapshot = () => draws.map((d) => `${d.page}:${Math.round(d.x)}:${Math.round(d.y)}:${d.text}`);

  it('draws exactly what it drew before, when no note prints', async () => {
    await exportPDF(json, 'Test', DEFAULT_PAGE_LAYOUT, {});
    const plain = snapshot();

    draws.length = 0; pages = 1; currentPage = 1;
    const off = [note('n1', 'text', { printInScript: false })];
    await sheetsFor(json, off, layout());
    expect(snapshot()).toEqual(plain);
  });

  it('draws exactly what it drew before, when exports are excluded', async () => {
    await exportPDF(json, 'Test', DEFAULT_PAGE_LAYOUT, {});
    const plain = snapshot();

    draws.length = 0; pages = 1; currentPage = 1;
    // The note prints on screen, but the writer asked for a clean file.
    await sheetsFor(json, [note('n1')], layout({ includeInExports: false }));
    expect(snapshot()).toEqual(plain);
  });
});
