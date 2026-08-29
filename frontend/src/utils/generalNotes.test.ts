/**
 * General notes that print.
 *
 * A general note belongs to the file rather than to any line of it. There is no
 * text to anchor a marker to and no page that is its own, so it can only ever
 * be an endnote — even when the anchored notes are set to print at the foot of
 * the page. These pin that, and pin the numbering: one sequence for the
 * document, with the general notes continuing after the anchored ones.
 */
import { describe, it, expect } from 'vitest';
import { buildFootnotePlan } from './footnotes';
import { computeBreaks, getPageMetrics } from '../editor/pagination';
import {
  DEFAULT_PAGE_LAYOUT,
  generalNoteWillPrint,
  type GeneralNote,
  type NoteInfo,
  type PageLayout,
  type FootnoteSettings,
} from '../stores/editorStore';
import { block, doc, marked, pmDoc } from '../test/screenplaySchema';
import type { JSONContent } from '@tiptap/react';

const CTX = { assets: [], assetUrl: () => null };
const { linesPerPage } = getPageMetrics(DEFAULT_PAGE_LAYOUT);

const note = (id: string, content = 'Anchored source.', over: Partial<NoteInfo> = {}): NoteInfo => ({
  id, content, anchorText: '', elementType: 'action', contextLabel: '',
  color: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z', sceneId: null,
  printInScript: true, ...over,
});

const general = (id: string, content = 'A file-level reference.', over: Partial<GeneralNote> = {}): GeneralNote => ({
  id, title: '', content, color: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z',
  printInScript: true, ...over,
});

const layout = (over: Partial<FootnoteSettings> = {}): PageLayout => ({
  ...DEFAULT_PAGE_LAYOUT,
  footnotes: { ...DEFAULT_PAGE_LAYOUT.footnotes!, enabled: true, ...over },
});

const noted = (text: string, noteId: string): JSONContent =>
  marked('action', text, { type: 'scriptNote', attrs: { noteId, color: '#f4d35e' } });

const filler = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => block('action', `Line ${from + i}.`));

const SCRIPT = doc(noted('Referenced action.', 'n1'), ...filler(10, 1));
const PLAIN = doc(...filler(11));

describe('generalNoteWillPrint', () => {
  it('needs both the flag and some text', () => {
    expect(generalNoteWillPrint(general('g1'))).toBe(true);
    expect(generalNoteWillPrint(general('g1', 'x', { printInScript: false }))).toBe(false);
    expect(generalNoteWillPrint(general('g1', '   '))).toBe(false);
    expect(generalNoteWillPrint(undefined)).toBe(false);
  });
});

describe('a general note alone', () => {
  it('makes a plan even with no anchored note anywhere', () => {
    const plan = buildFootnotePlan(PLAIN, layout(), [], CTX, [general('g1')])!;
    expect(plan).not.toBeNull();
    expect(plan.refs).toHaveLength(0);
    expect(plan.generalEntries.map((e) => e.noteId)).toEqual(['g1']);
  });

  it('is still nothing when the document switch is off', () => {
    expect(buildFootnotePlan(PLAIN, DEFAULT_PAGE_LAYOUT, [], CTX, [general('g1')])).toBeNull();
  });

  it('is still nothing when it is not set to print, or is empty', () => {
    expect(buildFootnotePlan(PLAIN, layout(), [], CTX, [general('g1', 'x', { printInScript: false })])).toBeNull();
    expect(buildFootnotePlan(PLAIN, layout(), [], CTX, [general('g1', '  ')])).toBeNull();
  });

  it('draws no marker in the script, having nothing to anchor to', () => {
    const plan = buildFootnotePlan(PLAIN, layout(), [], CTX, [general('g1')])!;
    expect(plan.refs).toHaveLength(0);
    expect(plan.refsByNode.size).toBe(0);
    expect(plan.textWithMarkers(0, 'Line 0.')).toBe('Line 0.');
  });
});

describe('it always lands at the end', () => {
  it('goes to the endnote sheets even when the placement is footnotes', () => {
    const plan = buildFootnotePlan(SCRIPT, layout({ placement: 'footnote' }), [note('n1')], CTX, [general('g1')])!;
    // The anchored note stays at the foot of its page...
    expect(plan.entries.map((e) => e.noteId)).toEqual(['n1']);
    // ...and only the general one is bound for the end.
    expect(plan.endnoteEntries.map((e) => e.noteId)).toEqual(['g1']);
  });

  it('joins the anchored notes on the end sheets when they are endnotes too', () => {
    const plan = buildFootnotePlan(SCRIPT, layout({ placement: 'endnote' }), [note('n1')], CTX, [general('g1')])!;
    expect(plan.endnoteEntries.map((e) => e.noteId)).toEqual(['n1', 'g1']);
  });

  it('adds sheets to the page count in footnote placement', () => {
    const withGeneral = computeBreaks(pmDoc(SCRIPT), layout(), undefined,
      buildFootnotePlan(SCRIPT, layout(), [note('n1')], CTX, [general('g1')]));
    const without = computeBreaks(pmDoc(SCRIPT), layout(), undefined,
      buildFootnotePlan(SCRIPT, layout(), [note('n1')], CTX, []));
    expect(withGeneral.pageCount).toBe(without.pageCount + 1);
    expect(withGeneral.endnotePages).toHaveLength(1);
  });

  it('never takes room from a page foot', () => {
    // Only the anchored note reserves; the general one is not on any page.
    const one = computeBreaks(pmDoc(SCRIPT), layout(), undefined,
      buildFootnotePlan(SCRIPT, layout(), [note('n1')], CTX, []));
    const both = computeBreaks(pmDoc(SCRIPT), layout(), undefined,
      buildFootnotePlan(SCRIPT, layout(), [note('n1')], CTX, [general('g1')]));
    expect(both.footnotePages![0]).toEqual(one.footnotePages![0]);
  });

  it('leaves the script pages untouched when it is the only note', () => {
    const plan = buildFootnotePlan(PLAIN, layout(), [], CTX, [general('g1')]);
    const withNote = computeBreaks(pmDoc(PLAIN), layout(), undefined, plan);
    const plain = computeBreaks(pmDoc(PLAIN), DEFAULT_PAGE_LAYOUT);
    expect(withNote.breaks).toEqual(plain.breaks);
    expect(withNote.pageCount).toBe(plain.pageCount + 1);
  });
});

describe('numbering', () => {
  it('continues the sequence after the anchored notes', () => {
    const plan = buildFootnotePlan(
      doc(noted('First.', 'n1'), noted('Second.', 'n2'), ...filler(5, 2)),
      layout(), [note('n1'), note('n2')], CTX, [general('g1'), general('g2')],
    )!;
    expect(plan.entries.map((e) => e.number)).toEqual([1, 2]);
    expect(plan.generalEntries.map((e) => e.number)).toEqual([3, 4]);
  });

  it('honours Start at and the number format', () => {
    const plan = buildFootnotePlan(
      SCRIPT, layout({ startAt: 5, numberFormat: 'lowerRoman' }),
      [note('n1')], CTX, [general('g1')],
    )!;
    expect(plan.entries[0].entryLabel).toBe('v');
    expect(plan.generalEntries[0].entryLabel).toBe('vi');
  });

  it('widens the marker measurement to cover the general notes too', () => {
    // Ten notes in total means a two-character marker, even though only one is
    // anchored — otherwise the reserve could under-measure.
    const many = Array.from({ length: 9 }, (_, i) => general(`g${i}`));
    const plan = buildFootnotePlan(SCRIPT, layout(), [note('n1')], CTX, many)!;
    expect(plan.markerWidth).toBe(2);
  });
});

describe('a title', () => {
  it('is carried through and costs a line', () => {
    const plain = buildFootnotePlan(PLAIN, layout(), [], CTX, [general('g1')])!;
    const titled = buildFootnotePlan(PLAIN, layout(), [], CTX,
      [general('g1', 'A file-level reference.', { title: 'Sources' })])!;
    expect(titled.generalEntries[0].title).toBe('Sources');
    expect(titled.generalEntries[0].lines).toBe(plain.generalEntries[0].lines + 1);
  });

  it('is absent on an anchored note, which has none', () => {
    const plan = buildFootnotePlan(SCRIPT, layout(), [note('n1')], CTX, [])!;
    expect(plan.entries[0].title).toBeUndefined();
    expect(plan.entries[0].isGeneral).toBeUndefined();
  });
});

describe('the off contract still holds', () => {
  it('paginates identically when no note of either kind prints', () => {
    const plan = buildFootnotePlan(
      SCRIPT, layout(),
      [note('n1', 'x', { printInScript: false })], CTX,
      [general('g1', 'x', { printInScript: false })],
    );
    expect(plan).toBeNull();
    expect(computeBreaks(pmDoc(SCRIPT), layout(), undefined, plan))
      .toEqual(computeBreaks(pmDoc(SCRIPT), DEFAULT_PAGE_LAYOUT));
  });

  it('reserves nothing and adds no sheets', () => {
    const state = computeBreaks(pmDoc(SCRIPT), DEFAULT_PAGE_LAYOUT);
    expect(state.endnotePages).toBeUndefined();
    expect(state.footnotePages).toBeUndefined();
    expect(linesPerPage).toBe(58);
  });
});

describe('a note can override where it prints', () => {
  const TWO = doc(noted('First.', 'n1'), noted('Second.', 'n2'), ...filler(8, 2));

  it('follows the document when it has no choice of its own', () => {
    const plan = buildFootnotePlan(TWO, layout({ placement: 'footnote' }),
      [note('n1'), note('n2')], CTX)!;
    expect(plan.entries.map((e) => e.noteId)).toEqual(['n1', 'n2']);
    expect(plan.endnoteEntries).toHaveLength(0);
  });

  it('moves to the end of the script on its own, against the document', () => {
    const plan = buildFootnotePlan(TWO, layout({ placement: 'footnote' }),
      [note('n1'), note('n2', 'Second source.', { printPlacement: 'endnote' })], CTX)!;
    expect(plan.entries.map((e) => e.noteId)).toEqual(['n1']);
    expect(plan.anchoredEndnotes.map((e) => e.noteId)).toEqual(['n2']);
    expect(plan.footnoteIds.has('n2')).toBe(false);
  });

  it('stays at the page foot when the document sends the rest to the end', () => {
    const plan = buildFootnotePlan(TWO, layout({ placement: 'endnote' }),
      [note('n1', 'First source.', { printPlacement: 'footnote' }), note('n2')], CTX)!;
    expect(plan.entries.map((e) => e.noteId)).toEqual(['n1']);
    expect(plan.anchoredEndnotes.map((e) => e.noteId)).toEqual(['n2']);
  });

  it('keeps one run of numbers across both destinations', () => {
    // Two independent sequences sharing one format would show two "1"s.
    const plan = buildFootnotePlan(TWO, layout({ placement: 'footnote' }),
      [note('n1'), note('n2', 'Second source.', { printPlacement: 'endnote' })], CTX)!;
    expect(plan.refs.map((r) => r.number)).toEqual([1, 2]);
    expect(plan.entryById.get('n2')!.number).toBe(2);
  });

  it('still draws a marker for a note sent to the end', () => {
    const plan = buildFootnotePlan(TWO, layout({ placement: 'footnote' }),
      [note('n1'), note('n2', 'Second source.', { printPlacement: 'endnote' })], CTX)!;
    expect(plan.refs.map((r) => r.noteId)).toEqual(['n1', 'n2']);
  });

  it('costs its page nothing once it is bound for the end', () => {
    const atFoot = buildFootnotePlan(TWO, layout(), [note('n1'), note('n2')], CTX);
    const atEnd = buildFootnotePlan(TWO, layout(),
      [note('n1'), note('n2', 'Second source.', { printPlacement: 'endnote' })], CTX);
    const foot = computeBreaks(pmDoc(TWO), layout(), undefined, atFoot);
    const end = computeBreaks(pmDoc(TWO), layout(), undefined, atEnd);
    expect(foot.footnotePages![0].noteIds).toEqual(['n1', 'n2']);
    expect(end.footnotePages![0].noteIds).toEqual(['n1']);
    // ...and it turns up on a sheet at the end instead.
    expect(end.endnotePages).toHaveLength(1);
  });
});
