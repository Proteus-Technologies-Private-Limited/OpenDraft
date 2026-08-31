/**
 * Whether the PDF draws the title page.
 *
 * File ▸ Include Title Page is the writer's own preference — sending a script to
 * someone who wants the pages and nothing else should not mean deleting the
 * title page from the script (issue #98).
 *
 * The trap this pins down: the exporter already had a path for a leading region
 * that turned out not to be a title page, and that one deliberately *keeps*
 * whatever carries text, as body content. Excluding the title page by reusing it
 * would have moved the title onto the first line of page 1 rather than removing
 * it. The region has to be dropped outright instead.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';

interface DrawCall { text: string; page: number }

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

/** A script whose leading run is a real title page. */
const script = (): JSONContent => ({
  type: 'doc',
  content: [
    { type: 'titlePage', attrs: { field: 'title', tpTitle: 'THE SCRIPT' }, content: [{ type: 'text', text: 'THE SCRIPT' }] },
    block('sceneHeading', 'INT. HOUSE - DAY'),
    block('action', 'She waits.'),
  ],
});

const drawn = () => draws.map((d) => d.text).join('\n');

beforeEach(() => { draws.length = 0; pages = 1; currentPage = 1; });

describe('PDF title page', () => {
  it('draws it by default, on a sheet of its own', async () => {
    await exportPDF(script(), 'Test', DEFAULT_PAGE_LAYOUT);
    expect(drawn()).toContain('THE SCRIPT');
    expect(draws.find((d) => d.text.includes('THE SCRIPT'))?.page).toBe(1);
    expect(draws.find((d) => d.text.includes('INT. HOUSE'))?.page).toBe(2);
  });

  it('still draws it when the option says so explicitly', async () => {
    await exportPDF(script(), 'Test', DEFAULT_PAGE_LAYOUT, { includeTitlePage: true });
    expect(drawn()).toContain('THE SCRIPT');
  });

  it('leaves it out entirely when the writer has turned it off', async () => {
    await exportPDF(script(), 'Test', DEFAULT_PAGE_LAYOUT, { includeTitlePage: false });
    expect(drawn()).not.toContain('THE SCRIPT');
    // Not merely moved: the script now opens the file.
    expect(draws.find((d) => d.text.includes('INT. HOUSE'))?.page).toBe(1);
  });

  it('leaves a script without a title page alone either way', async () => {
    const bare: JSONContent = {
      type: 'doc',
      content: [block('sceneHeading', 'INT. HOUSE - DAY'), block('action', 'She waits.')],
    };
    await exportPDF(bare, 'Test', DEFAULT_PAGE_LAYOUT, { includeTitlePage: false });
    expect(drawn()).toContain('INT. HOUSE - DAY');
    expect(pages).toBe(1);
  });
});
