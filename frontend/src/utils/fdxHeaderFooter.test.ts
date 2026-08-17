/**
 * Header/footer settings surviving an FDX round trip.
 *
 * The exporter used to write a fixed `<HeaderAndFooter>` — a right-aligned page
 * number, first page off, starting at 1 — no matter what the document was set
 * to, so a custom header or a starting page number was dropped on export.
 */
import { describe, it, expect } from 'vitest';
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';
import { exportFDX } from './fdxExporter';
import { parseHeaderAndFooter } from './fdxParser';
import { doc, block } from '../test/screenplaySchema';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';
import type { PageLayout } from '../stores/editorStore';

const layout = (over: Partial<PageLayout>): PageLayout => ({ ...DEFAULT_PAGE_LAYOUT, ...over });

const script = doc(block('sceneHeading', 'INT. HOUSE - DAY'), block('action', 'She waits.'));

const exportWith = (l: PageLayout): string =>
  exportFDX(script, 'Test', undefined, undefined, undefined, undefined, undefined, l);

/**
 * Export, then read the header block back.
 *
 * `parseFDX` as a whole needs a browser DOM (it uses querySelector) and this
 * suite runs on node, so the round trip is driven through the header/footer
 * reader directly — the half that this change touched.
 */
const roundTrip = (l: PageLayout) =>
  parseHeaderAndFooter(
    new XmldomDOMParser().parseFromString(exportWith(l), 'text/xml') as unknown as Document,
  );

describe('FDX header and footer export', () => {
  it('writes the default as a right-aligned page number that skips page 1', () => {
    const xml = exportWith(DEFAULT_PAGE_LAYOUT);
    expect(xml).toContain('HeaderFirstPage="No"');
    expect(xml).toContain('HeaderVisible="Yes"');
    expect(xml).toContain('StartingPage="1"');
    expect(xml).toContain('<DynamicLabel Type="Page #"/>');
  });

  it('carries a custom header instead of the hardcoded page number', () => {
    const xml = exportWith(layout({
      headerContent: { left: 'DRAFT', center: '', right: '{title} — {page}' },
    }));
    expect(xml).toContain('>DRAFT<');
    expect(xml).toContain('<DynamicLabel Type="Title"/>');
    expect(xml).toContain('Alignment="Left"');
  });

  it('marks the header visible on page 1 when it is set to show there', () => {
    expect(exportWith(layout({ headerStartPage: 1 }))).toContain('HeaderFirstPage="Yes"');
  });

  it('writes the starting page number', () => {
    expect(exportWith(layout({ startingPageNumber: 2 }))).toContain('StartingPage="2"');
  });

  it('reports no header at all when every slot is empty', () => {
    const xml = exportWith(layout({ headerContent: { left: '', center: '', right: '' } }));
    expect(xml).toContain('HeaderVisible="No"');
    expect(xml).not.toContain('<Header>');
  });

  it('exports a footer, which the fixed block never did', () => {
    const xml = exportWith(layout({ footerContent: { left: '', center: 'CONFIDENTIAL', right: '' } }));
    expect(xml).toContain('FooterVisible="Yes"');
    expect(xml).toContain('>CONFIDENTIAL<');
  });
});

describe('FDX header and footer round trip', () => {
  it('brings the default header back unchanged', () => {
    const back = roundTrip(DEFAULT_PAGE_LAYOUT);
    expect(back.headerContent?.right).toBe('{page}.');
    expect(back.headerStartPage).toBe(2);
    expect(back.startingPageNumber).toBe(1);
  });

  it('preserves a starting page number and the first-page rule together', () => {
    const back = roundTrip(layout({ startingPageNumber: 2, headerStartPage: 3 }));
    expect(back.startingPageNumber).toBe(2);
    // Skipping the opening page when it is numbered 2 means starting at 3.
    expect(back.headerStartPage).toBe(3);
  });

  it('keeps a header shown on the very first page', () => {
    const back = roundTrip(layout({ headerStartPage: 1 }));
    expect(back.headerStartPage).toBe(1);
  });

  it('preserves custom text and fields in each slot', () => {
    const back = roundTrip(layout({
      headerContent: { left: 'DRAFT', center: '{date}', right: '{page} of {pages}' },
    }));
    expect(back.headerContent).toEqual({
      left: 'DRAFT',
      center: '{date}',
      right: '{page} of {pages}',
    });
  });

  it('preserves a footer', () => {
    const back = roundTrip(layout({
      footerContent: { left: '', center: 'CONFIDENTIAL', right: '' },
      footerStartPage: 1,
    }));
    expect(back.footerContent?.center).toBe('CONFIDENTIAL');
    expect(back.footerStartPage).toBe(1);
  });

  it('leaves the document alone when the file has no HeaderAndFooter block', () => {
    // A file from a tool that omits the block entirely: the importer must not
    // blank a header the file never spoke about.
    const xml = exportWith(DEFAULT_PAGE_LAYOUT).replace(
      /<HeaderAndFooter[\s\S]*?<\/HeaderAndFooter>/,
      '',
    );
    const back = parseHeaderAndFooter(
      new XmldomDOMParser().parseFromString(xml, 'text/xml') as unknown as Document,
    );
    expect(back).toEqual({});
  });
});
