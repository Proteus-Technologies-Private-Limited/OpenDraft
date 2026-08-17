/**
 * Header/footer settings resolution and page numbering.
 *
 * These helpers are the single source the editor, the PDF exporter and the
 * settings dialog all read, so a document saved by an older version has to come
 * back with sane values rather than `undefined` leaking into a page number.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_LAYOUT,
  resolveHeaderFooter,
  printedPageNumber,
  showsHeaderFooter,
  resolveHFFields,
} from './editorStore';
import type { PageLayout } from './editorStore';

const layout = (over: Partial<PageLayout>): PageLayout => ({ ...DEFAULT_PAGE_LAYOUT, ...over });

describe('resolveHeaderFooter', () => {
  it('defaults to the industry standard: page 1 unnumbered, numbering from 1', () => {
    const hf = resolveHeaderFooter(DEFAULT_PAGE_LAYOUT);
    expect(hf.headerStartPage).toBe(2);
    expect(hf.startingPageNumber).toBe(1);
    expect(hf.headerContent.right).toBe('{page}.');
  });

  it('fills in fields a document saved before they existed has no value for', () => {
    // A layout as an older version wrote it — no starting number, no content.
    const legacy = { ...DEFAULT_PAGE_LAYOUT } as Partial<PageLayout>;
    delete legacy.startingPageNumber;
    delete legacy.headerContent;
    delete legacy.headerStartPage;
    const hf = resolveHeaderFooter(legacy as PageLayout);
    expect(hf.startingPageNumber).toBe(1);
    expect(hf.headerStartPage).toBe(2);
    expect(hf.headerContent.right).toBe('{page}.');
  });

  it('survives a layout that is missing entirely', () => {
    const hf = resolveHeaderFooter(undefined);
    expect(hf.startingPageNumber).toBe(1);
    expect(hf.footerStartPage).toBe(1);
  });

  it('clamps nonsense rather than passing NaN into a page number', () => {
    const hf = resolveHeaderFooter(layout({
      headerStartPage: 0,
      startingPageNumber: Number.NaN,
      footerStartPage: -12,
    }));
    expect(hf.headerStartPage).toBe(1);
    expect(hf.startingPageNumber).toBe(1);
    expect(hf.footerStartPage).toBe(1);
  });

  it('keeps a partially-filled content object from losing its other slots', () => {
    const hf = resolveHeaderFooter(layout({
      headerContent: { left: 'L' } as PageLayout['headerContent'],
    }));
    expect(hf.headerContent.left).toBe('L');
    expect(hf.headerContent.center).toBe('');
  });
});

describe('printedPageNumber', () => {
  it('is the page index when numbering starts at 1', () => {
    expect(printedPageNumber(1, 1)).toBe(1);
    expect(printedPageNumber(7, 1)).toBe(7);
  });

  it('shifts every page when the script starts at a later number', () => {
    // A synopsis occupies the opening sheet, so the script reads as page 2 on.
    expect(printedPageNumber(1, 2)).toBe(2);
    expect(printedPageNumber(2, 2)).toBe(3);
  });
});

describe('showsHeaderFooter', () => {
  const withPage = { left: '', center: '', right: '{page}.' };
  const empty = { left: '', center: '', right: '' };

  it('hides the band on the first page by default', () => {
    expect(showsHeaderFooter(withPage, 1, 2)).toBe(false);
    expect(showsHeaderFooter(withPage, 2, 2)).toBe(true);
  });

  it('shows it on the first page once the start page is lowered', () => {
    expect(showsHeaderFooter(withPage, 1, 1)).toBe(true);
  });

  it('compares against the PRINTED number, so an offset first page can show', () => {
    // Numbering starts at 2 and the band starts at 2: the opening sheet
    // qualifies, because its printed number already is 2.
    expect(showsHeaderFooter(withPage, printedPageNumber(1, 2), 2)).toBe(true);
  });

  it('draws nothing when every slot is empty, whatever the start page', () => {
    expect(showsHeaderFooter(empty, 5, 1)).toBe(false);
  });
});

describe('resolveHFFields', () => {
  it('substitutes the printed numbers it is given', () => {
    expect(resolveHFFields('{page} of {pages}', 3, 12, 'T', '')).toBe('3 of 12');
  });

  it('is case-insensitive and leaves unknown braces alone', () => {
    expect(resolveHFFields('{PAGE}. {scene}', 4, 9, 'T', '')).toBe('4. {scene}');
  });

  it('fills in the title and revision colour', () => {
    expect(resolveHFFields('{title} — {revision}', 1, 1, 'MY SCRIPT', 'Blue'))
      .toBe('MY SCRIPT — Blue');
  });

  it('returns an empty string for an empty template', () => {
    expect(resolveHFFields('', 1, 1, 'T', '')).toBe('');
  });
});
