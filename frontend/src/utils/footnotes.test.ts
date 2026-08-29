import { describe, it, expect } from 'vitest';
import {
  buildFootnotePlan,
  buildEndnotePages,
  footnoteBlockLines,
  footnoteEntryLines,
  footnoteCap,
  FOOTNOTE_SEPARATOR_LINES,
  FOOTNOTE_IMAGE_LINES,
  ENDNOTE_HEADING_LINES,
  FOOTNOTE_CPL,
  type FootnoteEntry,
} from './footnotes';
import { parseNoteContent } from './noteContent';
import {
  DEFAULT_PAGE_LAYOUT,
  type NoteInfo,
  type PageLayout,
  type FootnoteSettings,
} from '../stores/editorStore';
import type { JSONContent } from '@tiptap/react';

const CTX = { assets: [], assetUrl: () => null };

function note(id: string, content: string, over: Partial<NoteInfo> = {}): NoteInfo {
  return {
    id, content, anchorText: '', elementType: 'action', contextLabel: '',
    color: 'Yellow', createdAt: '2026-01-01T00:00:00.000Z', sceneId: null,
    printInScript: true, ...over,
  };
}

/** An action block whose middle phrase carries a script note. */
function anchored(before: string, marked: string, after: string, noteId: string): JSONContent {
  return {
    type: 'action',
    content: [
      ...(before ? [{ type: 'text', text: before }] : []),
      { type: 'text', text: marked, marks: [{ type: 'scriptNote', attrs: { noteId, color: '#f4d35e' } }] },
      ...(after ? [{ type: 'text', text: after }] : []),
    ],
  };
}

const layout = (footnotes: Partial<FootnoteSettings>): PageLayout => ({
  ...DEFAULT_PAGE_LAYOUT,
  footnotes: { ...DEFAULT_PAGE_LAYOUT.footnotes!, enabled: true, ...footnotes },
});

const doc = (...blocks: JSONContent[]): JSONContent => ({ type: 'doc', content: blocks });

describe('buildFootnotePlan — the off contract', () => {
  const d = doc(anchored('one small ', 'step', ' for a man', 'n1'));
  const notes = [note('n1', 'Armstrong, N. (1969).')];

  it('is null when the document setting is off', () => {
    expect(buildFootnotePlan(d, DEFAULT_PAGE_LAYOUT, notes, CTX)).toBeNull();
  });

  it('is null when no note is set to print', () => {
    const off = [note('n1', 'Armstrong.', { printInScript: false })];
    expect(buildFootnotePlan(d, layout({}), off, CTX)).toBeNull();
  });

  it('is null when the printing note is empty', () => {
    // An empty numbered footnote is always a bug, so it never reserves space.
    expect(buildFootnotePlan(d, layout({}), [note('n1', '   ')], CTX)).toBeNull();
  });

  it('is null when the note has no anchor left in the document', () => {
    expect(buildFootnotePlan(doc({ type: 'action', content: [{ type: 'text', text: 'plain' }] }),
      layout({}), notes, CTX)).toBeNull();
  });

  it('is null for an empty document or no notes at all', () => {
    expect(buildFootnotePlan(null, layout({}), notes, CTX)).toBeNull();
    expect(buildFootnotePlan(d, layout({}), [], CTX)).toBeNull();
  });
});

describe('buildFootnotePlan — anchoring and numbering', () => {
  it('finds the anchor at the end of the marked phrase', () => {
    const plan = buildFootnotePlan(
      doc(anchored('one small ', 'step', ' for a man', 'n1')),
      layout({}), [note('n1', 'Armstrong.')], CTX,
    )!;
    expect(plan.refs).toHaveLength(1);
    expect(plan.refs[0]).toMatchObject({ srcIndex: 0, charOffset: 'one small step'.length, number: 1, label: '1' });
  });

  it('numbers in document order, not note creation order', () => {
    const plan = buildFootnotePlan(
      doc(anchored('', 'a', '', 'n2'), anchored('', 'b', '', 'n1')),
      layout({}), [note('n1', 'first created'), note('n2', 'second created')], CTX,
    )!;
    expect(plan.refs.map((r) => r.noteId)).toEqual(['n2', 'n1']);
    expect(plan.refs.map((r) => r.number)).toEqual([1, 2]);
  });

  it('counts a note anchored twice as one reference, as Word does', () => {
    const plan = buildFootnotePlan(
      doc(anchored('', 'a', '', 'n1'), anchored('', 'b', '', 'n1')),
      layout({}), [note('n1', 'once')], CTX,
    )!;
    expect(plan.refs).toHaveLength(1);
    expect(plan.refs[0].srcIndex).toBe(0);
  });

  it('honours Start at and the number format', () => {
    const plan = buildFootnotePlan(
      doc(anchored('', 'a', '', 'n1'), anchored('', 'b', '', 'n2')),
      layout({ startAt: 5, numberFormat: 'lowerRoman' }),
      [note('n1', 'x'), note('n2', 'y')], CTX,
    )!;
    expect(plan.refs.map((r) => r.label)).toEqual(['v', 'vi']);
    expect(plan.entries.map((e) => e.entryLabel)).toEqual(['v', 'vi']);
  });

  it('brackets the marker but never the entry label', () => {
    const plan = buildFootnotePlan(
      doc(anchored('', 'a', '', 'n1')),
      layout({ markerStyle: 'bracketed' }), [note('n1', 'x')], CTX,
    )!;
    expect(plan.refs[0].label).toBe('[1]');
    expect(plan.entries[0].entryLabel).toBe('1');
  });

  it('takes the end of the last run carrying the mark', () => {
    // A phrase split by a bold run must still put the marker after the whole thing.
    const block: JSONContent = {
      type: 'action',
      content: [
        { type: 'text', text: 'see ' },
        { type: 'text', text: 'one', marks: [{ type: 'scriptNote', attrs: { noteId: 'n1' } }] },
        { type: 'text', text: ' small', marks: [{ type: 'bold' }, { type: 'scriptNote', attrs: { noteId: 'n1' } }] },
        { type: 'text', text: ' step' },
      ],
    };
    const plan = buildFootnotePlan(doc(block), layout({}), [note('n1', 'x')], CTX)!;
    expect(plan.refs[0].charOffset).toBe('see one small'.length);
  });

  it('counts a hard break as one character, like every other measurement', () => {
    const block: JSONContent = {
      type: 'action',
      content: [
        { type: 'text', text: 'up' },
        { type: 'hardBreak' },
        { type: 'text', text: 'down', marks: [{ type: 'scriptNote', attrs: { noteId: 'n1' } }] },
      ],
    };
    const plan = buildFootnotePlan(doc(block), layout({}), [note('n1', 'x')], CTX)!;
    expect(plan.refs[0].charOffset).toBe('up\ndown'.length);
  });
});

describe('marker cells in the character grid', () => {
  it('costs nothing for a superscript, which overhangs like the editor draws it', () => {
    const plan = buildFootnotePlan(
      doc(anchored('one small ', 'step', ' for a man', 'n1')),
      layout({}), [note('n1', 'x')], CTX,
    )!;
    expect(plan.markerCells).toBe(0);
    expect(plan.textWithMarkers(0, 'one small step for a man')).toBe('one small step for a man');
  });

  it('costs its width for a bracketed marker, which is ordinary text', () => {
    const plan = buildFootnotePlan(
      doc(anchored('one small ', 'step', ' for a man', 'n1')),
      layout({ markerStyle: 'bracketed' }), [note('n1', 'x')], CTX,
    )!;
    expect(plan.markerCells).toBe(3); // [1]
    expect(plan.textWithMarkers(0, 'one small step for a man'))
      .toBe('one small step••• for a man');
  });

  it('splices several markers in one block without shifting each other', () => {
    const block: JSONContent = {
      type: 'action',
      content: [
        { type: 'text', text: 'a', marks: [{ type: 'scriptNote', attrs: { noteId: 'n1' } }] },
        { type: 'text', text: 'bb' },
        { type: 'text', text: 'c', marks: [{ type: 'scriptNote', attrs: { noteId: 'n2' } }] },
      ],
    };
    const plan = buildFootnotePlan(doc(block), layout({ markerStyle: 'bracketed' }),
      [note('n1', 'x'), note('n2', 'y')], CTX)!;
    expect(plan.textWithMarkers(0, 'abbc')).toBe('a•••bbc•••');
  });

  it('leaves a block with no notes alone', () => {
    const plan = buildFootnotePlan(
      doc(anchored('', 'a', '', 'n1'), { type: 'action', content: [{ type: 'text', text: 'plain' }] }),
      layout({ markerStyle: 'bracketed' }), [note('n1', 'x')], CTX,
    )!;
    expect(plan.textWithMarkers(1, 'plain')).toBe('plain');
  });
});

describe('measuring an entry', () => {
  const blocks = (s: string) => parseNoteContent(s, CTX);

  it('counts the label against the first line it opens', () => {
    expect(footnoteEntryLines(blocks('short'), 1, undefined, FOOTNOTE_CPL)).toBe(1);
  });

  it('wraps at the action measure', () => {
    const long = 'x'.repeat(FOOTNOTE_CPL * 2);
    expect(footnoteEntryLines(blocks(long), 1, undefined, FOOTNOTE_CPL)).toBe(3);
  });

  it('gives an unmeasured image its default height', () => {
    const b = blocks('https://x.test/a.png');
    expect(footnoteEntryLines(b, 1, undefined, FOOTNOTE_CPL)).toBe(1 + FOOTNOTE_IMAGE_LINES);
  });

  it('uses the measured height once one is known', () => {
    const b = blocks('https://x.test/a.png');
    expect(footnoteEntryLines(b, 1, 3, FOOTNOTE_CPL)).toBe(1 + 3);
  });

  it('counts a video as the one line its URL occupies', () => {
    expect(footnoteEntryLines(blocks('https://youtu.be/abc'), 1, undefined, FOOTNOTE_CPL)).toBe(1);
  });
});

describe('reserving room on the page', () => {
  const plan = () => buildFootnotePlan(
    doc(anchored('', 'a', '', 'n1'), anchored('', 'b', '', 'n2')),
    layout({}), [note('n1', 'one'), note('n2', 'two')], CTX,
  )!;

  it('charges one separator for the whole block, not one per note', () => {
    const p = plan();
    expect(p.reserveLines(0, ['n1', 'n2'], 58)).toBe(FOOTNOTE_SEPARATOR_LINES + 2);
    expect(footnoteBlockLines(p.entries)).toBe(FOOTNOTE_SEPARATOR_LINES + 2);
  });

  it('reserves nothing for a page with no notes', () => {
    expect(plan().reserveLines(0, [], 58)).toBe(0);
  });

  it('never gives up more than half the page', () => {
    const tall = 'y'.repeat(FOOTNOTE_CPL * 80);
    const p = buildFootnotePlan(doc(anchored('', 'a', '', 'n1')), layout({}), [note('n1', tall)], CTX)!;
    expect(p.reserveLines(0, ['n1'], 58)).toBe(footnoteCap(58));
    expect(p.overflowLines(0, ['n1'], 58)).toBeGreaterThan(0);
  });

  it('charges a separator on a continuation page too, as Word draws one', () => {
    const p = plan();
    expect(p.reserveLines(4, [], 58)).toBe(FOOTNOTE_SEPARATOR_LINES + 4);
  });

  it('finds the notes anchored in a block range', () => {
    const p = plan();
    expect(p.notesForNodes(0, 1)).toEqual(['n1', 'n2']);
    expect(p.notesForNodes(1, 1)).toEqual(['n2']);
    expect(p.notesForNodes(5, 9)).toEqual([]);
  });
});

describe('buildEndnotePages', () => {
  const entry = (id: string, lines: number): FootnoteEntry =>
    ({ noteId: id, number: 1, entryLabel: '1', blocks: [], lines });

  it('is empty when nothing prints', () => {
    expect(buildEndnotePages([], 58)).toEqual([]);
  });

  it('puts the heading on the first page only', () => {
    const pages = buildEndnotePages([entry('a', 2)], 58);
    expect(pages).toHaveLength(1);
    expect(pages[0].hasHeading).toBe(true);
  });

  it('leaves room for the heading when packing', () => {
    const pages = buildEndnotePages([entry('a', 58 - ENDNOTE_HEADING_LINES)], 58);
    expect(pages).toHaveLength(1);
  });

  it('opens a second page when the first is full', () => {
    const pages = buildEndnotePages([entry('a', 58 - ENDNOTE_HEADING_LINES), entry('b', 4)], 58);
    expect(pages).toHaveLength(2);
    expect(pages[1].hasHeading).toBe(false);
    expect(pages[1].slices[0]).toMatchObject({ noteId: 'b', isStart: true });
  });

  it('splits a note taller than a page rather than dropping it', () => {
    const pages = buildEndnotePages([entry('a', 100)], 58);
    expect(pages).toHaveLength(2);
    expect(pages[0].slices[0]).toMatchObject({ noteId: 'a', fromLine: 0, isStart: true });
    expect(pages[1].slices[0]).toMatchObject({ noteId: 'a', isStart: false });
    const total = pages.flatMap((p) => p.slices).reduce((n, s) => n + s.lines, 0);
    expect(total).toBe(100);
  });
});
