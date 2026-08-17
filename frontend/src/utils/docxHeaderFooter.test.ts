/**
 * Header/footer behaviour of the real .docx exporter, read back out of the
 * produced OOXML.
 *
 * Three regressions live here:
 *  - a single `skipFirstPage` flag decided BOTH bands, so a footer meant for
 *    page 1 vanished whenever the header started on page 2 (the default);
 *  - with a title page, Word counted it as page 1, so the opening script page
 *    printed "2." and carried a header the layout said to suppress;
 *  - `{pages}` used Word's NUMPAGES, which counts the title page and is
 *    therefore always one higher than the editor and the PDF report.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { doc, block } from '../test/screenplaySchema';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import type { PageLayout } from '../stores/editorStore';

const saved: { buf: Uint8Array | null } = { buf: null };
vi.mock('./fileOps', () => ({
  saveFile: (data: Uint8Array) => {
    saved.buf = data;
    return Promise.resolve();
  },
}));

interface DocxParts {
  /** word/document.xml — carries the sectPr blocks. */
  document: string;
  /** Every word/header*.xml, in file-name order. */
  headers: string[];
  /** Every word/footer*.xml, in file-name order. */
  footers: string[];
}

async function exportParts(
  input: JSONContent,
  layout: PageLayout,
  options?: Record<string, unknown>,
): Promise<DocxParts> {
  const { exportDocx } = await import('./docxExporter');
  await exportDocx(input, 'Test', layout, options);
  const bytes = saved.buf;
  if (!bytes) throw new Error('exportDocx wrote nothing');
  const zip = await JSZip.loadAsync(bytes.slice());
  const read = async (prefix: string): Promise<string[]> => {
    const names = Object.keys(zip.files)
      .filter((n) => n.startsWith(`word/${prefix}`) && n.endsWith('.xml'))
      .sort();
    return Promise.all(names.map((n) => zip.files[n].async('string')));
  };
  return {
    document: (await zip.file('word/document.xml')?.async('string')) ?? '',
    headers: await read('header'),
    footers: await read('footer'),
  };
}

/** A body with no title page. */
const script = () =>
  doc(block('sceneHeading', 'INT. HOUSE - DAY'), block('action', 'She waits.'));

/** A body whose leading block is a real title page. */
const scriptWithTitlePage = () =>
  doc(
    block('titlePage', 'THE SCRIPT'),
    block('sceneHeading', 'INT. HOUSE - DAY'),
    block('action', 'She waits.'),
  );

const layout = (over: Partial<PageLayout>): PageLayout => ({ ...DEFAULT_PAGE_LAYOUT, ...over });

/** Text content of every `w:t` in a part, concatenated. */
const textOf = (xml: string): string =>
  (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? [])
    .map((m) => m.replace(/<[^>]+>/g, ''))
    .join('');

beforeEach(() => {
  saved.buf = null;
});

describe('DOCX header and footer bands are decided independently', () => {
  it('keeps a page-1 footer when the header starts on page 2', async () => {
    const parts = await exportParts(
      script(),
      layout({
        headerContent: { left: '', center: '', right: '{page}.' },
        footerContent: { left: '', center: 'DRAFT', right: '' },
        headerStartPage: 2,
        footerStartPage: 1,
      }),
    );
    // "Different first page" is on, because the header must skip page 1...
    expect(parts.document).toContain('w:titlePg');
    // ...but the footer that belongs on page 1 still has its content there.
    // Exactly one footer part may be blank (none, if both carry the text).
    expect(parts.footers.length).toBeGreaterThan(0);
    const nonEmptyFooters = parts.footers.filter((f) => textOf(f).includes('DRAFT'));
    expect(nonEmptyFooters.length).toBe(parts.footers.length);
  });

  it('still blanks the header on the first page', async () => {
    const parts = await exportParts(
      script(),
      layout({
        headerContent: { left: '', center: 'HEADER', right: '' },
        footerContent: { left: '', center: '', right: '' },
        headerStartPage: 2,
      }),
    );
    expect(parts.document).toContain('w:titlePg');
    expect(parts.headers.some((h) => !textOf(h).includes('HEADER'))).toBe(true);
    expect(parts.headers.some((h) => textOf(h).includes('HEADER'))).toBe(true);
  });

  it('shows the header on page 1 when asked, with no first-page override', async () => {
    const parts = await exportParts(
      script(),
      layout({
        headerContent: { left: '', center: 'HEADER', right: '' },
        headerStartPage: 1,
        footerStartPage: 1,
      }),
    );
    expect(parts.document).not.toContain('w:titlePg');
    expect(parts.headers.length).toBeGreaterThan(0);
    expect(parts.headers.every((h) => textOf(h).includes('HEADER'))).toBe(true);
  });
});

describe('DOCX page numbering with a title page', () => {
  it('restarts numbering so the first script page is page 1, not 2', async () => {
    const parts = await exportParts(scriptWithTitlePage(), layout({}));
    // The script's own section restarts the count.
    expect(parts.document).toMatch(/w:pgNumType[^>]*w:start="1"/);
  });

  it('gives the title page its own section so the script gets its own first page', async () => {
    const parts = await exportParts(scriptWithTitlePage(), layout({}));
    // Two sectPr blocks: one closing the title-page section, one for the body.
    const sectPrCount = (parts.document.match(/<w:sectPr/g) ?? []).length;
    expect(sectPrCount).toBe(2);
  });

  it('does not also force a paragraph page break, which would leave a blank sheet', async () => {
    const parts = await exportParts(scriptWithTitlePage(), layout({}));
    expect(parts.document).not.toContain('w:pageBreakBefore');
  });

  it('honours a starting page number', async () => {
    const parts = await exportParts(
      scriptWithTitlePage(),
      layout({ startingPageNumber: 2 }),
    );
    expect(parts.document).toMatch(/w:pgNumType[^>]*w:start="2"/);
  });
});

describe('DOCX {pages} field', () => {
  it('writes the script page count as a literal when the caller supplies it', async () => {
    const parts = await exportParts(
      scriptWithTitlePage(),
      layout({ headerContent: { left: '', center: '', right: '{page} of {pages}' } }),
      { scriptPageCount: 9 },
    );
    const header = parts.headers.map(textOf).join(' ');
    expect(header).toContain('9');
    // NUMPAGES would count the title page and report 10.
    expect(parts.headers.join('')).not.toContain('NUMPAGES');
  });

  it('shifts the total by the starting page number', async () => {
    const parts = await exportParts(
      script(),
      layout({
        headerContent: { left: '', center: '', right: '{pages}' },
        startingPageNumber: 2,
      }),
      { scriptPageCount: 9 },
    );
    // Pages 2…10 — the last page's number is what "{pages}" has to read.
    expect(parts.headers.map(textOf).join(' ')).toContain('10');
  });

  it('falls back to NUMPAGES when no count is supplied', async () => {
    const parts = await exportParts(
      script(),
      layout({ headerContent: { left: '', center: '', right: '{pages}' } }),
    );
    expect(parts.headers.join('')).toContain('NUMPAGES');
  });
});
