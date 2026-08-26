/**
 * The laid-out title page the importers build.
 *
 * `buildTitlePageBlocks` is what turns the fields an importer read out of a
 * file into the run of nodes the paginator and both exporters measure. Before
 * it existed each importer emitted a single attrs-only node, which exported as
 * one nearly-blank page with every field but the title dropped (issue #52).
 *
 * The page size matters and is the reason this takes a layout rather than
 * reading the editor store: during an import the store still holds the layout
 * of the document being replaced, so a Letter .fdx opened after an A4 one would
 * be laid out for the wrong page. That path cannot be exercised through
 * `parseFDXFull` in this suite — fdxParser is built on querySelector, which
 * @xmldom/xmldom does not implement (see fdxFonts.test.ts) — so it is pinned
 * here on the function the FDX parser hands the layout to.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { buildTitlePageBlocks, deriveTitlePageLines, hasTitlePageContent } from './titlePageBlocks';
import { findTitlePageRegion, titlePageAttrsCarryData } from './titlePageRegion';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';

/** US Letter, against the A4 default. 54 lines a page rather than 58. */
const LETTER = { ...DEFAULT_PAGE_LAYOUT, pageWidth: 8.5, pageHeight: 11 };

const FULL = {
  tpTitle: 'THE LONG GOODBYE',
  tpWrittenBy: 'Jane Writer',
  tpDraft: 'Second Draft',
  tpDraftDate: '2026-08-17',
  tpContact: 'jane@example.com',
  tpCopyright: 'Copyright 2026 Jane Writer',
  tpNotes: 'CONFIDENTIAL',
};

const linesPerPage = (layout: typeof DEFAULT_PAGE_LAYOUT) =>
  Math.floor((layout.pageHeight * 72 - layout.topMargin - layout.bottomMargin) / 12);

const regionOf = (blocks: ReturnType<typeof buildTitlePageBlocks>) =>
  findTitlePageRegion(
    blocks.map((node) => ({
      type: node.type,
      hasText: (node.content ?? []).some((c) => (c.text ?? '').trim().length > 0),
      hasTitleData: titlePageAttrsCarryData(node.attrs),
    })),
  );

describe('buildTitlePageBlocks', () => {
  it('produces a run the region resolver accepts', () => {
    const region = regionOf(buildTitlePageBlocks(FULL));
    expect(region.isReal).toBe(true);
    expect(region.length).toBeGreaterThan(1);
  });

  it('keeps the structured fields on one node, where the dialog reads them', () => {
    const blocks = buildTitlePageBlocks(FULL);
    const carrying = blocks.filter((b) => titlePageAttrsCarryData(b.attrs));
    expect(carrying).toHaveLength(1);
    expect(carrying[0].attrs).toMatchObject({ field: 'title', tpTitle: 'THE LONG GOODBYE' });
  });

  it('renders every field the writer entered', () => {
    const rendered = buildTitlePageBlocks(FULL)
      .flatMap((b) => (b.content ?? []).map((c) => c.text ?? ''))
      .join('\n');
    for (const expected of [
      'THE LONG GOODBYE',
      'Written by\nJane Writer',
      'Second Draft - 2026-08-17',
      'jane@example.com',
      'Copyright 2026 Jane Writer',
      'CONFIDENTIAL',
    ]) {
      expect(rendered).toContain(expected);
    }
  });

  it('fits the page it is laid out for', () => {
    for (const layout of [DEFAULT_PAGE_LAYOUT, LETTER]) {
      expect(buildTitlePageBlocks(FULL, layout).length).toBeLessThanOrEqual(linesPerPage(layout));
    }
  });

  it('lays a shorter page out shorter', () => {
    // The bug this guards: spacer counts fixed for one page size overflow a
    // smaller one, and the overflow is dropped rather than reflowed.
    expect(linesPerPage(LETTER)).toBeLessThan(linesPerPage(DEFAULT_PAGE_LAYOUT));
    expect(buildTitlePageBlocks(FULL, LETTER).length)
      .toBeLessThan(buildTitlePageBlocks(FULL, DEFAULT_PAGE_LAYOUT).length);
  });

  it('makes a title page from a credit alone, with no title', () => {
    const region = regionOf(buildTitlePageBlocks({ tpWrittenBy: 'Jane Writer' }));
    expect(region.isReal).toBe(true);
  });

  it('makes nothing at all from empty fields', () => {
    expect(buildTitlePageBlocks({})).toEqual([]);
    expect(buildTitlePageBlocks({ tpTitle: '   ' })).toEqual([]);
    expect(hasTitlePageContent({})).toBe(false);
  });
});

describe('deriveTitlePageLines', () => {
  // The credit is its own line above the author, which is how a title page is
  // laid out everywhere else: the FDX and DOCX importers both read files that
  // put "Written by" on one line and the name on the next. Gluing the two
  // together meant an imported title page came back out reshaped, and left
  // Fountain's `Credit:` — which may say "Screenplay by" — with nowhere to go
  // but the "based on" line, where it printed a second time (issue #87).
  it('puts the credit label on its own line above the author', () => {
    expect(deriveTitlePageLines({ tpWrittenBy: 'Jane Writer' }).byLine).toBe('Written by\nJane Writer');
  });

  it('takes the label the writer gave it', () => {
    expect(deriveTitlePageLines({ tpCredit: 'Screenplay by', tpWrittenBy: 'Jane Writer' }).byLine)
      .toBe('Screenplay by\nJane Writer');
  });

  it('falls back to "Written by" for a blank credit', () => {
    expect(deriveTitlePageLines({ tpCredit: '   ', tpWrittenBy: 'Jane Writer' }).byLine)
      .toBe('Written by\nJane Writer');
  });

  it('writes no credit block at all without an author', () => {
    expect(deriveTitlePageLines({ tpCredit: 'Screenplay by' }).byLine).toBe('');
  });

  it('puts the source on its own line under the author', () => {
    expect(deriveTitlePageLines({ tpWrittenBy: 'Jane Writer', tpBasedOn: 'Based on a true story' }).byLine)
      .toBe('Written by\nJane Writer\nBased on a true story');
  });

  it('joins the draft and its date, and either alone', () => {
    expect(deriveTitlePageLines({ tpDraft: 'Second Draft', tpDraftDate: '2026-08-17' }).draftLine)
      .toBe('Second Draft - 2026-08-17');
    expect(deriveTitlePageLines({ tpDraft: 'Second Draft' }).draftLine).toBe('Second Draft');
    expect(deriveTitlePageLines({ tpDraftDate: '2026-08-17' }).draftLine).toBe('2026-08-17');
  });

  it('shares the copyright block with the WGA registration', () => {
    expect(deriveTitlePageLines({ tpCopyright: 'Copyright 2026', tpWgaRegistration: 'WGA #1234' }).copyrightLine)
      .toBe('Copyright 2026\nWGA #1234');
  });
});
