/**
 * A footnote longer than the room its page can spare.
 *
 * Drawing such a note whole is what made it climb up over the script: the
 * paginator held back half a page, the block drew forty lines into it, and the
 * overflow landed on top of the dialogue. Word splits a long footnote instead —
 * as much as fits stays, the rest continues at the foot of the next page — and
 * that is the contract pinned here.
 *
 * The rule that matters: the lines drawn on a page never exceed the lines
 * reserved on it. Everything else is detail.
 */
import { describe, it, expect } from 'vitest';
import {
  buildFootnotePlan,
  packFootnotePage,
  footnoteCap,
  FOOTNOTE_SEPARATOR_LINES,
  type FootnoteEntry,
} from './footnotes';
import { computeBreaks, getPageMetrics } from '../editor/pagination';
import { DEFAULT_PAGE_LAYOUT, type NoteInfo, type PageLayout } from '../stores/editorStore';
import { block, doc, marked, pmDoc } from '../test/screenplaySchema';

const CTX = { assets: [], assetUrl: () => null };
const { linesPerPage } = getPageMetrics(DEFAULT_PAGE_LAYOUT);
const CAP = footnoteCap(linesPerPage);

const L: PageLayout = {
  ...DEFAULT_PAGE_LAYOUT,
  footnotes: { ...DEFAULT_PAGE_LAYOUT.footnotes!, enabled: true },
};

const note = (id: string, content: string): NoteInfo => ({
  id, content, anchorText: '', elementType: 'action', contextLabel: '', color: 'Yellow',
  createdAt: '2026-01-01T00:00:00.000Z', sceneId: null, printInScript: true,
});
const noted = (t: string, id: string) => marked('action', t, { type: 'scriptNote', attrs: { noteId: id } });
const filler = (n: number, from = 0) => Array.from({ length: n }, (_, i) => block('action', `Line ${from + i}.`));
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

const entry = (id: string, n: number): FootnoteEntry =>
  ({ noteId: id, number: 1, entryLabel: '1', blocks: [], lines: n });

describe('packFootnotePage', () => {
  it('draws a short note whole and hands nothing on', () => {
    const fill = packFootnotePage([], [entry('a', 3)], linesPerPage);
    expect(fill.reserve).toBe(FOOTNOTE_SEPARATOR_LINES + 3);
    expect(fill.slices).toEqual([{ noteId: 'a', fromLine: 0, lines: 3, isStart: true }]);
    expect(fill.pending).toEqual([]);
  });

  it('never reserves more than a page can spare', () => {
    const fill = packFootnotePage([], [entry('a', 500)], linesPerPage);
    expect(fill.reserve).toBe(CAP);
  });

  it('draws only what fits and continues the rest', () => {
    const fill = packFootnotePage([], [entry('a', 40)], linesPerPage);
    const drawn = fill.slices.reduce((n, s) => n + s.lines, 0);
    expect(drawn).toBe(CAP - FOOTNOTE_SEPARATOR_LINES);
    expect(fill.pending).toEqual([
      { noteId: 'a', fromLine: drawn, lines: 40 - drawn, isStart: false },
    ]);
  });

  it('does not repeat the number on a continuation', () => {
    const first = packFootnotePage([], [entry('a', 40)], linesPerPage);
    const second = packFootnotePage(first.pending, [], linesPerPage);
    expect(first.slices[0].isStart).toBe(true);
    expect(second.slices[0].isStart).toBe(false);
  });

  it('finishes a long note across as many pages as it takes, losing nothing', () => {
    let pending = [{ noteId: 'a', fromLine: 0, lines: 200, isStart: true }];
    let drawn = 0;
    for (let guard = 0; pending.length > 0 && guard < 50; guard++) {
      const fill = packFootnotePage(pending, [], linesPerPage);
      expect(fill.slices.reduce((n, s) => n + s.lines, 0))
        .toBeLessThanOrEqual(fill.reserve - FOOTNOTE_SEPARATOR_LINES);
      drawn += fill.slices.reduce((n, s) => n + s.lines, 0);
      pending = fill.pending;
    }
    expect(pending).toEqual([]);
    expect(drawn).toBe(200);
  });

  it('puts a carried remainder before the notes arriving on the page', () => {
    const fill = packFootnotePage(
      [{ noteId: 'a', fromLine: 10, lines: 4, isStart: false }],
      [entry('b', 3)], linesPerPage,
    );
    expect(fill.slices.map((s) => s.noteId)).toEqual(['a', 'b']);
  });
});

describe('in the document', () => {
  const json = doc(noted('Anchor.', 'n1'), ...filler(60, 1));

  it('never draws more lines on a page than it held back', () => {
    // The bug this exists for: the drawn block outgrew the reserved gap and
    // climbed over the script.
    for (const len of [1, 5, 28, 29, 40, 120]) {
      const plan = buildFootnotePlan(json, L, [note('n1', lines(len))], CTX)!;
      const state = computeBreaks(pmDoc(json), L, undefined, plan);
      for (const page of state.footnotePages!) {
        const drawn = page.slices.reduce((n, s) => n + s.lines, 0);
        const reserved = plan.reserveLines(page.carryLines, page.noteIds, linesPerPage);
        expect(drawn).toBeLessThanOrEqual(Math.max(0, reserved - FOOTNOTE_SEPARATOR_LINES));
      }
    }
  });

  it('draws every line of a long note somewhere, across pages', () => {
    const plan = buildFootnotePlan(json, L, [note('n1', lines(120))], CTX)!;
    const state = computeBreaks(pmDoc(json), L, undefined, plan);
    const drawn = state.footnotePages!.flatMap((p) => p.slices).reduce((n, s) => n + s.lines, 0);
    expect(drawn).toBe(plan.entryById.get('n1')!.lines);
  });

  it('finishes on the notes sheets when it outlives the script', () => {
    // One page of script cannot hold 120 lines of note. The remainder goes to
    // the sheets at the end — which exist and render — rather than onto pages
    // invented for it that nothing would draw.
    const short = doc(noted('Anchor.', 'n1'), block('action', 'Just two blocks.'));
    const plan = buildFootnotePlan(short, L, [note('n1', lines(120))], CTX)!;
    const state = computeBreaks(pmDoc(short), L, undefined, plan);
    const total = plan.entryById.get('n1')!.lines;

    const onPages = state.footnotePages!.flatMap((p) => p.slices).reduce((n, s) => n + s.lines, 0);
    const onSheets = (state.endnotePages ?? []).flatMap((p) => p.slices).reduce((n, s) => n + s.lines, 0);
    expect(onPages).toBeGreaterThan(0);
    expect(onSheets).toBeGreaterThan(0);
    // Nothing is lost, and nothing is drawn twice.
    expect(onPages + onSheets).toBe(total);
    // Those sheets are counted, so the editor and the PDF agree on the length.
    expect(state.pageCount).toBeGreaterThan(1);
  });

  it('draws a slice in order, with no line drawn twice', () => {
    const plan = buildFootnotePlan(json, L, [note('n1', lines(120))], CTX)!;
    const state = computeBreaks(pmDoc(json), L, undefined, plan);
    let expected = 0;
    for (const page of state.footnotePages!) {
      for (const slice of page.slices) {
        expect(slice.fromLine).toBe(expected);
        expected += slice.lines;
      }
    }
  });
});
