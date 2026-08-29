import { describe, it, expect } from 'vitest';
import { computeBreaks, getPageMetrics } from './pagination';
import {
  DEFAULT_PAGE_LAYOUT,
  type NoteInfo,
  type PageLayout,
  type FootnoteSettings,
} from '../stores/editorStore';
import { buildFootnotePlan, FOOTNOTE_SEPARATOR_LINES, footnoteCap } from '../utils/footnotes';
import { block, doc, marked, pmDoc } from '../test/screenplaySchema';
import type { JSONContent } from '@tiptap/react';

const CTX = { assets: [], assetUrl: () => null };
const { linesPerPage } = getPageMetrics(DEFAULT_PAGE_LAYOUT);

function note(id: string, content = 'Armstrong, N. (1969).', over: Partial<NoteInfo> = {}): NoteInfo {
  return {
    id, content, anchorText: '', elementType: 'action', contextLabel: '',
    color: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z', sceneId: null,
    printInScript: true, ...over,
  };
}

const layout = (over: Partial<FootnoteSettings> = {}): PageLayout => ({
  ...DEFAULT_PAGE_LAYOUT,
  footnotes: { ...DEFAULT_PAGE_LAYOUT.footnotes!, enabled: true, ...over },
});

/** An action block whose text carries a script note. */
const noted = (text: string, noteId: string): JSONContent =>
  marked('action', text, { type: 'scriptNote', attrs: { noteId, color: '#f4d35e' } });

/** Plain action blocks. The first is one line; each after it costs two, since
 *  action carries a blank line before it — so 29 of them fill the default page. */
const filler = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => block('action', `Line ${from + i}.`));

const plan = (json: JSONContent, notes: NoteInfo[], l: PageLayout = layout()) =>
  buildFootnotePlan(json, l, notes, CTX);

const breaksOf = (json: JSONContent, notes: NoteInfo[] | null, l: PageLayout = layout()) =>
  computeBreaks(pmDoc(json), notes ? l : DEFAULT_PAGE_LAYOUT, undefined,
    notes ? plan(json, notes, l) : null);

describe('the off contract', () => {
  // The requirement this feature is judged by: with nothing printing,
  // pagination must be indistinguishable from before footnotes existed.
  const json = doc(noted('Referenced action.', 'n1'), ...filler(60, 1));

  it('paginates identically when no note is set to print', () => {
    const p = plan(json, [note('n1', 'text', { printInScript: false })]);
    expect(p).toBeNull();
    expect(computeBreaks(pmDoc(json), layout(), undefined, p))
      .toEqual(computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT));
  });

  it('paginates identically when the document switch is off', () => {
    const p = buildFootnotePlan(json, DEFAULT_PAGE_LAYOUT, [note('n1')], CTX);
    expect(p).toBeNull();
    expect(computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT, undefined, p))
      .toEqual(computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT));
  });

  it('paginates identically when the note has lost its anchor', () => {
    const orphaned = doc(block('action', 'Nothing marked here.'), ...filler(60, 1));
    expect(plan(orphaned, [note('n1')])).toBeNull();
  });

  it('reports no footnotePages at all when nothing prints', () => {
    expect(computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT).footnotePages).toBeUndefined();
  });
});

describe('reserving room shrinks the page', () => {
  const plain = computeBreaks(pmDoc(doc(...filler(60))), DEFAULT_PAGE_LAYOUT).breaks;

  it('fills the page with 29 blocks and 57 lines when nothing prints', () => {
    // The baseline the tests below are measured against.
    expect(plain[0]).toMatchObject({ nodeIndex: 29, linesOnPage: 57 });
  });

  it('gives up exactly the separator plus the note for one note', () => {
    const json = doc(noted('Referenced action.', 'n1'), ...filler(60, 1));
    const b = breaksOf(json, [note('n1')]).breaks;
    const reserve = FOOTNOTE_SEPARATOR_LINES + 1;
    expect(b[0].linesOnPage).toBeLessThanOrEqual(linesPerPage - reserve);
    // ...and no more than a whole block more than it had to.
    expect(b[0].linesOnPage).toBeGreaterThan(linesPerPage - reserve - 2);
    expect(b[0].linesOnPage).toBe(55);
  });

  it('charges one separator for two notes on a page, not two', () => {
    // Two notes cost one line more than one note — the separator is not repeated.
    const one = breaksOf(doc(noted('First.', 'n1'), ...filler(60, 1)), [note('n1')]).breaks;
    const two = breaksOf(
      doc(noted('First.', 'n1'), noted('Second.', 'n2'), ...filler(60, 2)),
      [note('n1'), note('n2')],
    ).breaks;
    expect(one[0].linesOnPage).toBe(55);
    expect(two[0].linesOnPage).toBe(53);
  });

  it('records which notes each page carries', () => {
    const json = doc(noted('Early.', 'n1'), block('action', 'Plain.'));
    const state = breaksOf(json, [note('n1')]);
    expect(state.footnotePages).toMatchObject([{ pageNumber: 1, noteIds: ['n1'], carryLines: 0 }]);
    // ...and exactly what to draw there, clipped to the room reserved.
    expect(state.footnotePages![0].slices).toEqual([
      { noteId: 'n1', fromLine: 0, lines: 1, isStart: true },
    ]);
  });

  it('leaves a page carrying no printing note exactly as it was', () => {
    const json = doc(...filler(29), noted('Noted.', 'n1'), ...filler(5, 30));
    const state = breaksOf(json, [note('n1')]);
    // Page one has no note anchored on it, so it keeps every line it had.
    expect(state.footnotePages![0]).toMatchObject({ pageNumber: 1, noteIds: [], carryLines: 0, slices: [] });
    expect(state.breaks[0].linesOnPage).toBe(57);
  });
});

describe('it cannot oscillate', () => {
  // The trap: reserving room for a note pushes its own line off the page, so
  // the note is no longer on the page, so the room is not needed, so the line
  // fits again. Deciding a block jointly with its own notes avoids it.
  const json = doc(...filler(28), noted('Referenced.', 'n1'), ...filler(5, 29));

  it('keeps the block on the page when nothing prints', () => {
    expect(computeBreaks(pmDoc(json), DEFAULT_PAGE_LAYOUT).breaks[0].nodeIndex).toBe(29);
  });

  it('moves the block and its reservation down together', () => {
    const state = breaksOf(json, [note('n1', 'x'.repeat(400))]);
    // The noted block opens page two...
    expect(state.breaks[0].nodeIndex).toBe(28);
    // ...and page one's reservation went back to nothing, rather than settling
    // into a cycle of reserving and un-reserving.
    expect(state.footnotePages![0]).toMatchObject({ pageNumber: 1, noteIds: [], carryLines: 0, slices: [] });
    expect(state.footnotePages![1].noteIds).toEqual(['n1']);
  });

  it('is stable — the same input always gives the same answer', () => {
    const notes = [note('n1', 'x'.repeat(400))];
    expect(breaksOf(json, notes)).toEqual(breaksOf(json, notes));
  });
});

describe('it always terminates', () => {
  it('still places a block whose note is taller than the page', () => {
    const huge = 'y'.repeat(62 * 400);
    const json = doc(...filler(28), noted('Referenced.', 'n1'), ...filler(5, 29));
    const state = breaksOf(json, [note('n1', huge)]);
    expect(state.pageCount).toBeGreaterThan(1);
    expect(state.pageCount).toBeLessThan(20);
  });

  it('caps the reservation at half a page and carries the rest forward', () => {
    const huge = 'y'.repeat(62 * 200);
    const json = doc(noted('Referenced.', 'n1'), ...filler(60, 1));
    const state = breaksOf(json, [note('n1', huge)]);
    expect(state.footnotePages![0]).toMatchObject({ pageNumber: 1, noteIds: ['n1'] });
    expect(state.breaks[0].linesOnPage).toBeLessThanOrEqual(linesPerPage - footnoteCap(linesPerPage));
    // Page two inherits what would not fit on page one.
    expect(state.footnotePages![1].carryLines).toBeGreaterThan(0);
  });
});

describe('numbering never feeds back into pagination', () => {
  // What the upper-bound marker width buys: the page layout cannot depend on
  // the numbers, so no mode or offset can move a break.
  const json = doc(noted('First.', 'n1'), noted('Second.', 'n2'), ...filler(60, 2));
  const notes = [note('n1'), note('n2')];

  it('restarting each page gives the same breaks as continuous', () => {
    const cont = layout({ numbering: 'continuous' });
    const restart = layout({ numbering: 'restartEachPage' });
    expect(breaksOf(json, notes, restart).breaks).toEqual(breaksOf(json, notes, cont).breaks);
  });

  it('changing Start at does not move a single break', () => {
    expect(breaksOf(json, notes, layout({ startAt: 900 })).breaks)
      .toEqual(breaksOf(json, notes, layout({ startAt: 1 })).breaks);
  });

  it('changing the number format does not move a single break', () => {
    expect(breaksOf(json, notes, layout({ numberFormat: 'symbol' })).breaks)
      .toEqual(breaksOf(json, notes, layout({ numberFormat: 'arabic' })).breaks);
  });
});

describe('the marker only occupies the line when it is real text', () => {
  // 62 characters exactly fills an action line, so three more wrap it.
  const text = 'z'.repeat(62);
  const json = doc(noted(text, 'n1'), ...filler(60, 1));
  const notes = [note('n1')];

  it('costs nothing for a superscript, which overhangs as the editor draws it', () => {
    expect(plan(json, notes)!.textWithMarkers(0, text)).toBe(text);
    expect(breaksOf(json, notes).breaks[0].linesOnPage).toBe(55);
  });

  it('costs its width for a bracketed marker, wrapping the line it lands on', () => {
    const l = layout({ markerStyle: 'bracketed' });
    expect(plan(json, notes, l)!.textWithMarkers(0, text)).toHaveLength(65);
    // The anchored line now takes two lines, so one fewer fits on the page.
    expect(breaksOf(json, notes, l).breaks[0].linesOnPage).toBe(54);
  });
});

describe('the title page is not script', () => {
  it('reserves no footnote room on the title sheet', () => {
    const json = doc(
      { type: 'titlePage', content: [{ type: 'text', text: 'THE SCRIPT' }] },
      noted('Body action.', 'n1'),
      ...filler(5, 1),
    );
    const state = breaksOf(json, [note('n1')]);
    expect(state.breaks.find((b) => b.isTitlePage)).toBeDefined();
    // The note is anchored in the body, so it still prints — on the body page.
    expect(state.footnotePages!.some((f) => f.noteIds.includes('n1'))).toBe(true);
  });
});
