import { describe, it, expect, afterEach } from 'vitest';
import type { JSONContent } from '@tiptap/react';
import type { ParsedPdfScreenplay, PdfElementLayout } from './pdfImport';
import {
  reviewRowsFrom, sceneOrdinals, lookKey, clickSelect, selectSameType, selectSameLook,
  setTypeOf, countChanged, applyReviewedTypes, reviewPdfImport, setPdfImportReviewer,
  isImportCancelled, ImportCancelledError,
} from './pdfImportReview';

const el = (type: string, text: string, attrs?: Record<string, unknown>): JSONContent =>
  ({ type, content: [{ type: 'text', text }], ...(attrs ? { attrs } : {}) });
const at = (page: number, indent: number): PdfElementLayout => ({ page, indent });

/** A small parsed script: a title page, a scene, a misread cue, and dual dialogue. */
function parsedScript(): ParsedPdfScreenplay {
  return {
    title: 'Test',
    warnings: [],
    doc: {
      type: 'doc',
      content: [
        { type: 'titlePage', content: [{ type: 'text', text: 'TEST' }] },
        el('sceneHeading', 'INT. OFFICE - DAY', { sceneNumber: '1' }),
        el('action', 'Papers everywhere.'),
        el('action', 'BOSS', { textAlign: 'center' }), // a cue read as a title card
        el('dialogue', 'Sit down.'),
        el('action', 'MAYA', { textAlign: 'center' }),
        el('dialogue', 'No.'),
        {
          type: 'dualDialogue',
          content: [
            { type: 'dualDialogueColumn', content: [el('character', 'ANA'), el('dialogue', 'Hi.')] },
            { type: 'dualDialogueColumn', content: [el('character', 'BEN'), el('dialogue', 'Hey.')] },
          ],
        },
        el('sceneHeading', 'EXT. STREET - NIGHT'),
      ],
    },
    layout: [null, at(2, 0), at(2, 0), at(2, 2.2), at(2, 1), at(3, 2.2), at(3, 1), null, at(3, 0)],
  };
}

const rowsAndTypes = () => {
  const rows = reviewRowsFrom(parsedScript());
  return { rows, types: rows.map((r) => r.originalType) };
};
const noneLocked = () => false;

describe('reviewRowsFrom', () => {
  it('lists every body paragraph in order, leaving the title page out', () => {
    const { rows } = rowsAndTypes();
    expect(rows.map((r) => `${r.originalType}:${r.text}`)).toEqual([
      'sceneHeading:INT. OFFICE - DAY',
      'action:Papers everywhere.',
      'action:BOSS',
      'dialogue:Sit down.',
      'action:MAYA',
      'dialogue:No.',
      'dualDialogue:ANA / BEN',
      'sceneHeading:EXT. STREET - NIGHT',
    ]);
    expect(rows[0].node).toBe(1);
  });

  it('carries the page, indent and case, and locks dual dialogue', () => {
    const { rows } = rowsAndTypes();
    expect(rows[2]).toMatchObject({ page: 2, indent: 2.2, caps: true, locked: false });
    expect(rows[1].caps).toBe(false);
    expect(rows[6]).toMatchObject({ locked: true, page: null, indent: null });
  });

  it('copes with a parse that has no layout', () => {
    const parsed = parsedScript();
    delete parsed.layout;
    const rows = reviewRowsFrom(parsed);
    expect(rows.every((r) => r.indent === null && r.page === null)).toBe(true);
    expect(lookKey(rows[0])).toBeNull();
  });
});

describe('sceneOrdinals', () => {
  it('numbers by the types as they stand, so a new heading moves what follows', () => {
    expect(sceneOrdinals(['action', 'sceneHeading', 'action', 'sceneHeading', 'dialogue'])).toEqual([0, 1, 1, 2, 2]);
    expect(sceneOrdinals(['action', 'action', 'sceneHeading'])).toEqual([0, 0, 1]);
  });
});

describe('clickSelect', () => {
  const order = [0, 1, 2, 3, 4, 5];
  const empty = { selected: new Set<number>(), anchor: null };

  it('selects just the row on a plain click', () => {
    const s = clickSelect({ selected: new Set([1, 2]), anchor: 1 }, 4, {}, order, noneLocked);
    expect([...s.selected]).toEqual([4]);
    expect(s.anchor).toBe(4);
  });

  it('adds and removes a row with toggle', () => {
    let s = clickSelect(empty, 1, { toggle: true }, order, noneLocked);
    s = clickSelect(s, 3, { toggle: true }, order, noneLocked);
    expect([...s.selected].sort()).toEqual([1, 3]);
    s = clickSelect(s, 1, { toggle: true }, order, noneLocked);
    expect([...s.selected]).toEqual([3]);
  });

  it('selects a range from the anchor either way, replacing the selection', () => {
    const start = clickSelect({ selected: new Set([0]), anchor: null }, 4, {}, order, noneLocked);
    const s = clickSelect(start, 1, { range: true }, order, noneLocked);
    expect([...s.selected].sort()).toEqual([1, 2, 3, 4]);
    expect(s.anchor).toBe(4);
  });

  it('adds a range to the selection when toggle is held too', () => {
    const s = clickSelect({ selected: new Set([0]), anchor: 3 }, 4, { range: true, toggle: true }, order, noneLocked);
    expect([...s.selected].sort()).toEqual([0, 3, 4]);
  });

  it('ranges over the rows on show, skipping locked ones', () => {
    const filtered = [0, 2, 4, 5];
    const locked = (i: number) => i === 4;
    const s = clickSelect({ selected: new Set(), anchor: 0 }, 5, { range: true }, filtered, locked);
    expect([...s.selected].sort()).toEqual([0, 2, 5]);
  });

  it('never selects a locked row', () => {
    const state = { selected: new Set([1]), anchor: 1 };
    expect(clickSelect(state, 2, {}, order, (i) => i === 2)).toBe(state);
  });

  it('falls back to a plain click when there is no anchor', () => {
    const s = clickSelect(empty, 2, { range: true }, order, noneLocked);
    expect([...s.selected]).toEqual([2]);
  });
});

describe('bulk selection', () => {
  it('selects every line of the types already selected', () => {
    const { rows, types } = rowsAndTypes();
    expect([...selectSameType(rows, types, new Set([3]))].sort()).toEqual([3, 5]);
    expect([...selectSameType(rows, types, new Set([0, 3]))].sort()).toEqual([0, 3, 5, 7]);
  });

  it('selects by the current type, not the parsed one', () => {
    const { rows, types } = rowsAndTypes();
    const retyped = setTypeOf(rows, types, new Set([2]), 'character');
    expect([...selectSameType(rows, retyped, new Set([2]))]).toEqual([2]);
  });

  it('selects every line at the same indent and in the same case', () => {
    const { rows } = rowsAndTypes();
    // The two cues at 2.2in, but not the mixed-case action at the margin.
    expect([...selectSameLook(rows, new Set([2]))].sort()).toEqual([2, 4]);
    // Mixed case at the margin: the action line only, not the headings.
    expect([...selectSameLook(rows, new Set([1]))]).toEqual([1]);
    expect([...selectSameLook(rows, new Set([3]))].sort()).toEqual([3, 5]);
  });

  it('never picks up a locked row', () => {
    const { rows, types } = rowsAndTypes();
    const all = new Set(rows.map((_, i) => i));
    expect(selectSameType(rows, types, all).has(6)).toBe(false);
    expect(selectSameLook(rows, all).has(6)).toBe(false);
  });
});

describe('setTypeOf and countChanged', () => {
  it('retypes the selected unlocked rows only', () => {
    const { rows, types } = rowsAndTypes();
    const next = setTypeOf(rows, types, new Set([2, 4, 6]), 'character');
    expect(next[2]).toBe('character');
    expect(next[4]).toBe('character');
    expect(next[6]).toBe('dualDialogue');
    expect(types[2]).toBe('action'); // not mutated
    expect(countChanged(rows, next)).toBe(2);
  });

  it('returns the same array when nothing changes', () => {
    const { rows, types } = rowsAndTypes();
    expect(setTypeOf(rows, types, new Set([0]), 'sceneHeading')).toBe(types);
    expect(setTypeOf(rows, types, new Set(), 'action')).toBe(types);
  });
});

describe('applyReviewedTypes', () => {
  it('retypes paragraphs, keeps their text and drops what belonged to the old type', () => {
    const parsed = parsedScript();
    const rows = reviewRowsFrom(parsed);
    let types = rows.map((r) => r.originalType);
    types = setTypeOf(rows, types, new Set([2, 4]), 'character');
    types = setTypeOf(rows, types, new Set([0]), 'action');
    const doc = applyReviewedTypes(parsed.doc, rows, types);
    const content = doc.content!;
    expect(content[0].type).toBe('titlePage');
    expect(content[1]).toEqual({ type: 'action', content: [{ type: 'text', text: 'INT. OFFICE - DAY' }] });
    expect(content[3]).toEqual({ type: 'character', content: [{ type: 'text', text: 'BOSS' }] });
    expect(content[5].type).toBe('character');
    expect(content[7]).toBe(parsed.doc.content![7]);
    // The parsed document is left as it was.
    expect(parsed.doc.content![3].type).toBe('action');
  });

  it('leaves a paragraph set back to its own type whole', () => {
    const parsed = parsedScript();
    const rows = reviewRowsFrom(parsed);
    const types = rows.map((r) => r.originalType);
    const doc = applyReviewedTypes(parsed.doc, rows, types);
    expect(doc.content![1]).toBe(parsed.doc.content![1]);
    expect(doc.content![1].attrs?.sceneNumber).toBe('1');
  });
});

describe('reviewPdfImport', () => {
  let unregister: (() => void) | null = null;
  afterEach(() => { unregister?.(); unregister = null; });

  it('passes the document through when no preview is registered', async () => {
    const parsed = parsedScript();
    expect(await reviewPdfImport('a.pdf', parsed)).toBe(parsed.doc);
  });

  it('returns what the preview approves', async () => {
    const approved: JSONContent = { type: 'doc', content: [el('action', 'Edited.')] };
    unregister = setPdfImportReviewer(async ({ filename }) => (filename === 'a.pdf' ? approved : null));
    expect(await reviewPdfImport('a.pdf', parsedScript())).toBe(approved);
  });

  it('rejects with a cancellation the callers can tell apart', async () => {
    unregister = setPdfImportReviewer(async () => null);
    const err = await reviewPdfImport('a.pdf', parsedScript()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportCancelledError);
    expect(isImportCancelled(err)).toBe(true);
    expect(isImportCancelled(new Error('Import cancelled.'))).toBe(false);
  });

  it('unregisters only its own preview', async () => {
    const first = setPdfImportReviewer(async () => null);
    unregister = setPdfImportReviewer(async (r) => r.parsed.doc);
    first();
    const parsed = parsedScript();
    expect(await reviewPdfImport('a.pdf', parsed)).toBe(parsed.doc);
  });
});
