/**
 * Where the title page ends — issue #52, re-opened.
 *
 * The reporter's symptom was title-page content stacked at the top of
 * screenplay page 1 with the first scene heading directly underneath. The cause
 * was this boundary: the exporters took it to be the leading run of title-page
 * nodes and stopped at the first node that was neither, and one blank Action
 * above the title (a single Enter keypress at the start of it) reclassified the
 * whole title page as body content.
 */
import { describe, it, expect } from 'vitest';
import { findTitlePageRegion, titlePageAttrsCarryData, type TitleNodeInfo } from './titlePageRegion';

const title = (text = 'THE LONG GOODBYE'): TitleNodeInfo => ({
  type: 'titlePage',
  hasText: text.length > 0,
  hasTitleData: true,
});
const spacer = (): TitleNodeInfo => ({ type: 'titlePage', hasText: false, hasTitleData: false });
const credit = (): TitleNodeInfo => ({ type: 'titlePage', hasText: true, hasTitleData: false });
const image = (): TitleNodeInfo => ({ type: 'screenplayImage', hasText: false, hasTitleData: false });
const blankLine = (type = 'action'): TitleNodeInfo => ({ type, hasText: false, hasTitleData: false });
const body = (type = 'sceneHeading'): TitleNodeInfo => ({ type, hasText: true, hasTitleData: false });

describe('findTitlePageRegion', () => {
  it('finds the plain leading run', () => {
    const region = findTitlePageRegion([spacer(), title(), spacer(), credit(), body(), body('action')]);
    expect(region).toEqual({ length: 4, isReal: true });
  });

  it('reports no region for a script without a title page', () => {
    expect(findTitlePageRegion([body(), body('action')])).toEqual({ length: 0, isReal: false });
  });

  it('survives a blank line above the title page', () => {
    // One Enter at the start of the title. This is issue #52.
    const region = findTitlePageRegion([blankLine(), spacer(), title(), credit(), body()]);
    expect(region.length).toBe(4);
    expect(region.isReal).toBe(true);
  });

  it('survives a stray typed line above the title page', () => {
    const region = findTitlePageRegion([body('action'), title(), credit(), body()]);
    expect(region.length).toBe(3);
    expect(region.isReal).toBe(true);
  });

  it('gives up when the document really opens with the script', () => {
    // Three lines of prose before any title-page node is a screenplay that
    // happens to contain one, not a title page with a typo above it.
    const region = findTitlePageRegion([
      body('action'), body('action'), body('action'), title(), body(),
    ]);
    expect(region).toEqual({ length: 0, isReal: false });
  });

  it('ends at the last title node, leaving trailing blanks to the body', () => {
    const region = findTitlePageRegion([title(), credit(), blankLine(), body()]);
    expect(region.length).toBe(2);
  });

  it('keeps leading images with the title page', () => {
    const region = findTitlePageRegion([image(), spacer(), title(), body()]);
    expect(region).toEqual({ length: 3, isReal: true });
  });

  describe('whether the region is worth its own page', () => {
    it('counts a title page carrying only a credit line', () => {
      // `hasTitlePage` used to require a non-empty tpTitle, so this exported as
      // no title page at all and every one of its lines was discarded.
      const region = findTitlePageRegion([spacer(), credit(), body()]);
      expect(region.isReal).toBe(true);
    });

    it('counts a title page whose text lives in attributes', () => {
      const attrsOnly: TitleNodeInfo = { type: 'titlePage', hasText: false, hasTitleData: true };
      expect(findTitlePageRegion([attrsOnly, body()]).isReal).toBe(true);
    });

    it('does not count a run of blank spacers', () => {
      expect(findTitlePageRegion([spacer(), spacer(), body()]).isReal).toBe(false);
    });

    it('does not count images on their own', () => {
      // A picture at the top of the script is body content, not a title page.
      expect(findTitlePageRegion([image(), body()]).isReal).toBe(false);
    });
  });
});

describe('titlePageAttrsCarryData', () => {
  it('is false for nothing at all', () => {
    expect(titlePageAttrsCarryData(null)).toBe(false);
    expect(titlePageAttrsCarryData(undefined)).toBe(false);
    expect(titlePageAttrsCarryData({})).toBe(false);
  });

  it('is false for a node whose fields are all empty', () => {
    expect(titlePageAttrsCarryData({ field: 'title', tpTitle: '', tpWrittenBy: '   ' })).toBe(false);
  });

  it('is true for any field the writer filled in', () => {
    expect(titlePageAttrsCarryData({ field: 'title', tpTitle: 'X' })).toBe(true);
    expect(titlePageAttrsCarryData({ field: 'title', tpTitle: '', tpWrittenBy: 'Jane' })).toBe(true);
    expect(titlePageAttrsCarryData({ field: 'title', tpCopyright: '© 2026' })).toBe(true);
  });
});
