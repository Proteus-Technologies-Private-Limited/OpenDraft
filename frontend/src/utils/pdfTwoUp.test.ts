/**
 * Sides two to a sheet: the pairing and scaling on their own, then the real
 * file read back with pdf.js — sheet size, which page numbers landed where,
 * and that a watermark and a password still come through.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/react';

const testWindow = globalThis.window as unknown as Record<string, unknown> | undefined;
if (testWindow && typeof testWindow.atob !== 'function') {
  testWindow.atob = atob;
  testWindow.btoa = btoa;
}

const { twoUpLayout } = await import('./pdfTwoUp');
const { renderPDF } = await import('./pdfExporter');
const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
const { buildPageSelection } = await import('./pageSelection');
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

describe('pairing and scaling', () => {
  it('puts Letter pages two to a landscape Letter sheet, the odd one alone', () => {
    const layout = twoUpLayout(5, 612, 792);
    expect([layout.sheetWidth, layout.sheetHeight]).toEqual([792, 612]);
    expect(layout.sheets.map((s) => s.map((slot) => slot.page))).toEqual([[1, 2], [3, 4], [5]]);
    // Half a sheet's width is what limits a Letter page.
    expect(layout.scale).toBeCloseTo(396 / 612, 6);
    const [left, right] = layout.sheets[0];
    expect(left.x).toBeCloseTo(0, 6);
    expect(right.x).toBeCloseTo(396, 6);
    // Centred top to bottom.
    expect(left.y).toBeCloseTo((612 - 792 * layout.scale) / 2, 6);
    expect(layout.sheets[2][0].x).toBe(left.x);
  });

  it('follows the script onto A4, keeping both halves the same size', () => {
    const layout = twoUpLayout(2, 595.28, 841.89);
    expect([layout.sheetWidth, layout.sheetHeight]).toEqual([841.89, 595.28]);
    // On A4 the height is the tighter fit.
    expect(layout.scale).toBeCloseTo(595.28 / 841.89, 6);
    const drawn = 595.28 * layout.scale;
    const [left, right] = layout.sheets[0];
    expect(right.x - left.x).toBeCloseTo(841.89 / 2, 6);
    expect(left.x + drawn).toBeLessThanOrEqual(841.89 / 2 + 1e-6);
    expect(right.x + drawn).toBeLessThanOrEqual(841.89 + 1e-6);
    expect(left.y).toBeCloseTo(0, 6);
  });

  it('has no sheets for no pages, and refuses a page with no size', () => {
    expect(twoUpLayout(0, 612, 792).sheets).toEqual([]);
    expect(twoUpLayout(1, 612, 792).sheets).toHaveLength(1);
    expect(() => twoUpLayout(2, 0, 792)).toThrow(/page size/);
  });
});

const el = (type: string, text: string, attrs?: Record<string, unknown>): JSONContent => ({
  type, content: [{ type: 'text', text }], ...(attrs ? { attrs } : {}),
});
const filler = (n: number, label: string) => Array.from({ length: n }, (_, i) => el('action', `${label} beat ${i + 1}.`));

/** Three scenes over at least three pages. */
const script: JSONContent = {
  type: 'doc',
  content: [
    el('sceneHeading', 'INT. KITCHEN - NIGHT', { sceneNumber: '1' }),
    ...filler(30, 'Kitchen'),
    el('sceneHeading', 'EXT. ROOF - DAY', { sceneNumber: '2' }),
    ...filler(30, 'Roof'),
    el('sceneHeading', 'INT. HALL - LATER', { sceneNumber: '3' }),
    ...filler(30, 'Hall'),
  ],
};

const textOf = async (doc: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>, n: number) =>
  (await (await doc.getPage(n)).getTextContent()).items.map((i) => ('str' in i ? i.str : '')).join(' ');

/** The page numbers the header printed on a sheet, in reading order. */
const pageNumbersOn = (text: string) => [...text.matchAll(/(?:^|\s)(\d+)\.(?=\s|$)/g)].map((m) => Number(m[1]));

describe('two-up sheets in the PDF', () => {
  const everyScene = buildPageSelection(script, { mode: 'sides', scenes: new Set([0, 1, 2]), crossOut: true })!;
  const twoUp = buildPageSelection(script, { mode: 'sides', scenes: new Set([0, 1, 2]), crossOut: true }, { twoUp: true })!;

  it('halves the sheets, landscape, each page keeping its own number', async () => {
    const flat = await pdfjs.getDocument({
      data: (await renderPDF(script, 'T', DEFAULT_PAGE_LAYOUT, { pageSelection: everyScene.selection })).bytes,
    }).promise;
    const sheets = await pdfjs.getDocument({
      data: (await renderPDF(script, 'T', DEFAULT_PAGE_LAYOUT, { pageSelection: twoUp.selection })).bytes,
    }).promise;
    expect(flat.numPages).toBeGreaterThanOrEqual(3);
    expect(sheets.numPages).toBe(Math.ceil(flat.numPages / 2));

    const view = (await sheets.getPage(1)).view;
    expect(view[2]).toBeCloseTo(DEFAULT_PAGE_LAYOUT.pageHeight * 72, 1);
    expect(view[3]).toBeCloseTo(DEFAULT_PAGE_LAYOUT.pageWidth * 72, 1);

    // Every page's text is still there, scaled; and the numbers it printed
    // in its header come along — page 1 is never numbered.
    const all = (await Promise.all(Array.from({ length: sheets.numPages }, (_, i) => textOf(sheets, i + 1)))).join('\n');
    expect(all).toContain('INT. KITCHEN - NIGHT');
    expect(all).toContain('INT. HALL - LATER');
    expect(all).toContain('Hall beat 30.');
    const first = pageNumbersOn(await textOf(sheets, 1));
    expect(first).toContain(2);
    const last = pageNumbersOn(await textOf(sheets, sheets.numPages));
    expect(last).toContain(flat.numPages);

    // Text on the right half of the first sheet is the second page.
    const items = (await (await sheets.getPage(1)).getTextContent()).items as Array<{ str: string; transform: number[] }>;
    const roof = items.find((i) => i.str.includes('Roof beat') || i.str.includes('EXT. ROOF'));
    const kitchen = items.find((i) => i.str.includes('INT. KITCHEN - NIGHT'));
    expect(kitchen!.transform[4]).toBeLessThan(view[2] / 2);
    if (roof) expect(roof.transform[4]).toBeGreaterThan(view[2] / 2);
    await flat.destroy();
    await sheets.destroy();
  });

  it('keeps the watermark on each page and the password on the file', async () => {
    const { bytes } = await renderPDF(script, 'T', DEFAULT_PAGE_LAYOUT, {
      pageSelection: twoUp.selection,
      watermark: { text: 'FOR JANE DOE', style: 'footer' },
      security: { userPassword: 'hunter2' },
    });
    await expect(pdfjs.getDocument({ data: bytes.slice() }).promise).rejects.toMatchObject({ name: 'PasswordException' });
    const pdf = await pdfjs.getDocument({ data: bytes.slice(), password: 'hunter2' }).promise;
    const text = await textOf(pdf, 1);
    // One watermark per page, so two on a full sheet.
    expect(text.match(/FOR JANE DOE/g)).toHaveLength(2);
    expect(text).toContain('INT. KITCHEN - NIGHT');
    await pdf.destroy();
  });
});
