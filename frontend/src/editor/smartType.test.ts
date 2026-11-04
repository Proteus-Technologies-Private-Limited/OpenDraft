import { describe, it, expect } from 'vitest';
import {
  MAX_ITEMS,
  buildScriptIndex,
  collectScriptBlocks,
  emptyScriptIndex,
  isLocalSmartTypeUpdate,
  isNonLatinComposition,
  smartTypeKeyAction,
  smartTypeMove,
  suggestSmartType,
  type ScriptIndex,
  type BlockNodeLike,
} from './smartType';
import { pmDoc } from '../test/screenplaySchema';

const items = (element: string, text: string, index: ScriptIndex = emptyScriptIndex()) => {
  const result = suggestSmartType(element, text, text.length, index);
  return result?.items ?? [];
};

const index: ScriptIndex = buildScriptIndex([
  { type: 'sceneHeading', text: 'INT. DINER - NIGHT' },
  { type: 'sceneHeading', text: 'EXT. DINER PARKING LOT - NIGHT' },
  { type: 'sceneHeading', text: 'INT. MARGO APARTMENT - DAWN' },
  { type: 'character', text: 'MARGO (V.O.)' },
  { type: 'character', text: 'TEO' },
  { type: 'transition', text: 'INTERCUT WITH:' },
]);

describe('suggestSmartType: scene headings', () => {
  it('offers scene prefixes while the prefix is being typed', () => {
    expect(items('sceneHeading', 'IN')).toEqual(['INT. ', 'INT./EXT. ']);
    expect(items('sceneHeading', 'E')).toEqual(['EXT. ', 'EST. ']);
    expect(items('sceneHeading', 'I/E.')).toEqual(['I/E. ']);
  });

  it('offers the locations the script already uses after a prefix', () => {
    expect(items('sceneHeading', 'INT. ', index)).toEqual(['DINER', 'DINER PARKING LOT', 'MARGO APARTMENT']);
    expect(items('sceneHeading', 'EXT. D', index)).toEqual(['DINER', 'DINER PARKING LOT']);
  });

  it('excludes the location that is already typed out', () => {
    expect(items('sceneHeading', 'INT. DINER', index)).not.toContain('DINER');
    expect(items('sceneHeading', 'INT. MARGO APARTMENT', index)).toEqual([]);
  });

  it('offers times of day after the dash, built-in and seen', () => {
    expect(items('sceneHeading', 'INT. DINER - N', index)).toEqual(['NIGHT']);
    expect(items('sceneHeading', 'INT. DINER - ', index)).toContain('NIGHT');
    expect(items('sceneHeading', 'INT. DINER - ', index)).toContain('DAWN');
  });

  it('offers a time the script used even when it is not built in', () => {
    const withCustom = buildScriptIndex([{ type: 'sceneHeading', text: 'INT. DINER - NOON' }]);
    expect(items('sceneHeading', 'INT. DINER - NO', withCustom)).toEqual(['NOON']);
  });

  it('does not mistake a custom time for part of the location', () => {
    const withCustom = buildScriptIndex([{ type: 'sceneHeading', text: 'INT. DINER - NOON' }]);
    expect(withCustom.locations).toEqual(['DINER']);
    expect(withCustom.times).toEqual(['NOON']);
  });

  it('ignores the case the writer typed', () => {
    expect(items('sceneHeading', 'int. ', index)).toEqual(['DINER', 'DINER PARKING LOT', 'MARGO APARTMENT']);
    expect(items('sceneHeading', 'INT. din', index)).toEqual(['DINER', 'DINER PARKING LOT']);
  });

  it('indexes an EST. heading by its location, not by the whole slugline', () => {
    const withEst = buildScriptIndex([
      { type: 'sceneHeading', text: 'EST. CITY - DAY' },
      { type: 'sceneHeading', text: 'INT. HOUSE - DAY' },
    ]);
    expect(withEst.locations).toEqual(['CITY', 'HOUSE']);
    expect(items('sceneHeading', 'EST. C', withEst)).toEqual(['CITY']);
    // "EST. CITY" used to be indexed as a location, so "INT. E" offered it
    // and accepting produced "INT. EST. CITY".
    expect(items('sceneHeading', 'INT. E', withEst)).toEqual([]);
  });
});

describe('suggestSmartType: characters', () => {
  it('offers the names already used, without the extension', () => {
    expect(items('character', 'MA', index)).toEqual(['MARGO']);
    expect(items('character', 'T', index)).toEqual(['TEO']);
  });

  it('offers extensions after an opening parenthesis', () => {
    expect(items('character', 'TEO (V', index)).toEqual(['(V.O.)']);
    expect(items('character', 'TEO (')).toEqual(['(V.O.)', '(O.S.)', '(O.C.)', "(CONT'D)"]);
  });

  it('replaces only the extension, leaving the name in place', () => {
    const result = suggestSmartType('character', 'TEO (V', 6, index);
    expect(result?.from).toBe(4);
  });
});

describe('suggestSmartType: transitions', () => {
  it('offers the standard transitions', () => {
    expect(items('transition', 'CU')).toEqual(['CUT TO:']);
    expect(items('transition', 'D')).toEqual(['DISSOLVE TO:']);
  });

  it('offers a transition the script already uses', () => {
    expect(items('transition', 'INTER', index)).toEqual(['INTERCUT WITH:']);
  });
});

describe('suggestSmartType: limits and boundaries', () => {
  it('offers nothing in elements without completions', () => {
    expect(items('action', 'INT. DIN', index)).toEqual([]);
    expect(items('dialogue', 'NI', index)).toEqual([]);
  });

  it('offers nothing unless the caret is at the end of the block', () => {
    expect(suggestSmartType('sceneHeading', 'INT. DIN', 5, index)).toBeNull();
  });

  it('offers nothing for an empty block', () => {
    expect(suggestSmartType('character', '', 0, index)).toBeNull();
    expect(suggestSmartType('transition', '  ', 2, index)).toBeNull();
  });

  it('excludes the exact match and duplicates', () => {
    const repeated = buildScriptIndex([
      { type: 'character', text: 'TEO' },
      { type: 'character', text: 'TEO (V.O.)' },
    ]);
    expect(items('character', 'TEO', repeated)).toEqual([]);
    expect(items('character', 'T', repeated)).toEqual(['TEO']);
  });

  it('caps the list at MAX_ITEMS', () => {
    const many = buildScriptIndex(
      Array.from({ length: MAX_ITEMS * 2 }, (_, i) => ({ type: 'character', text: `NAME${i}` })),
    );
    expect(items('character', 'N', many)).toHaveLength(MAX_ITEMS);
  });
});

describe('collectScriptBlocks', () => {
  const fakeDoc = (entries: Array<{ pos: number; block: BlockNodeLike }>) => ({
    descendants: (callback: (node: BlockNodeLike, pos: number) => boolean | void) => {
      for (const entry of entries) {
        if (callback(entry.block, entry.pos) === false) return;
      }
    },
  });

  it('collects text blocks nested inside wrappers, not only top-level blocks', () => {
    const doc = fakeDoc([
      { pos: 0, block: { isTextblock: true, type: { name: 'sceneHeading' }, textContent: 'INT. HOUSE - DAY' } },
      // dualDialogue / dualDialogueColumn wrappers are not text blocks
      { pos: 20, block: { isTextblock: false, type: { name: 'dualDialogue' }, textContent: '' } },
      { pos: 21, block: { isTextblock: true, type: { name: 'character' }, textContent: 'DUAL ONLY' } },
      { pos: 40, block: { isTextblock: true, type: { name: 'character' }, textContent: 'MARGO' } },
    ]);
    expect(collectScriptBlocks(doc)).toEqual([
      { type: 'sceneHeading', text: 'INT. HOUSE - DAY' },
      { type: 'character', text: 'DUAL ONLY' },
      { type: 'character', text: 'MARGO' },
    ]);
  });

  it('leaves out the block being typed', () => {
    const doc = fakeDoc([
      { pos: 0, block: { isTextblock: true, type: { name: 'character' }, textContent: 'MARGO' } },
      { pos: 20, block: { isTextblock: true, type: { name: 'character' }, textContent: 'MARG' } },
    ]);
    expect(collectScriptBlocks(doc, 20)).toEqual([
      { type: 'character', text: 'MARGO' },
    ]);
  });
});
describe('smartTypeKeyAction', () => {
  it('accepts a character cue with Enter or Tab at once', () => {
    expect(smartTypeKeyAction(false, false, 'Enter')).toBe('accept');
    expect(smartTypeKeyAction(false, false, 'Tab')).toBe('accept');
  });

  it('lets Enter and Tab keep moving in a heading until the writer navigates', () => {
    expect(smartTypeKeyAction(true, false, 'Enter')).toBe('pass');
    expect(smartTypeKeyAction(true, false, 'Tab')).toBe('pass');
    expect(smartTypeKeyAction(true, true, 'Enter')).toBe('accept');
    expect(smartTypeKeyAction(true, true, 'Tab')).toBe('accept');
  });

  it('navigates, dismisses and lets every other key through', () => {
    expect(smartTypeKeyAction(true, false, 'ArrowDown')).toBe('down');
    expect(smartTypeKeyAction(true, false, 'ArrowUp')).toBe('up');
    expect(smartTypeKeyAction(true, false, 'Escape')).toBe('dismiss');
    expect(smartTypeKeyAction(true, false, 'a')).toBe('pass');
  });
});

describe('collectScriptBlocks on a real ProseMirror document', () => {
  it('finds a character that only appears inside dual dialogue', () => {
    const doc = pmDoc({
      type: 'doc',
      content: [
        { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. HOUSE - DAY' }] },
        {
          type: 'dualDialogue',
          content: [
            {
              type: 'dualDialogueColumn',
              content: [
                { type: 'character', content: [{ type: 'text', text: 'DUALONLY' }] },
                { type: 'dialogue', content: [{ type: 'text', text: 'Left.' }] },
              ],
            },
            {
              type: 'dualDialogueColumn',
              content: [
                { type: 'character', content: [{ type: 'text', text: 'BOB' }] },
                { type: 'dialogue', content: [{ type: 'text', text: 'Right.' }] },
              ],
            },
          ],
        },
        { type: 'character' },
      ],
    });

    expect(collectScriptBlocks(doc)).toContainEqual({ type: 'character', text: 'DUALONLY' });
    expect(collectScriptBlocks(doc)).toContainEqual({ type: 'character', text: 'BOB' });

    let emptyPos: number | null = null;
    doc.descendants((node, pos) => {
      if (node.type.name === 'character' && node.textContent === '') emptyPos = pos;
      return true;
    });
    expect(emptyPos).not.toBeNull();
    const withoutCurrent = collectScriptBlocks(doc, emptyPos!);
    expect(withoutCurrent.filter((block) => block.type === 'character' && block.text === '')).toHaveLength(0);
    expect(withoutCurrent).toContainEqual({ type: 'character', text: 'DUALONLY' });
  });
});

describe('isLocalSmartTypeUpdate', () => {
  const step = (from: number, to: number) => ({
    forEach: (cb: (a: number, b: number, c: number, d: number) => void) => cb(from, to, from, to),
  });
  const transaction = (ranges: Array<[number, number]>, meta: Record<string, unknown> = {}) => ({
    docChanged: true,
    mapping: { maps: ranges.map(([from, to]) => step(from, to)) },
    getMeta: (key: string) => meta[key],
  });

  it('accepts a character typed inside the current block', () => {
    expect(isLocalSmartTypeUpdate(transaction([[20, 21]]), 10, 40)).toBe(true);
    // A character inserted exactly at the caret at the end of the block.
    expect(isLocalSmartTypeUpdate(transaction([[40, 40]]), 10, 40)).toBe(true);
  });

  it('ignores an edit in another block', () => {
    expect(isLocalSmartTypeUpdate(transaction([[2, 3]]), 10, 40)).toBe(false);
  });

  it('ignores remote collaboration edits, undo and programmatic passes', () => {
    expect(isLocalSmartTypeUpdate(transaction([[20, 21]], { 'y-sync$': {} }), 10, 40)).toBe(false);
    expect(isLocalSmartTypeUpdate(transaction([[20, 21]], { 'history$': {} }), 10, 40)).toBe(false);
    expect(isLocalSmartTypeUpdate(transaction([[20, 21]], { addToHistory: false }), 10, 40)).toBe(false);
  });

  it('ignores transactions that do not change the document', () => {
    const tr = transaction([[20, 21]]);
    tr.docChanged = false;
    expect(isLocalSmartTypeUpdate(tr, 10, 40)).toBe(false);
  });
});

describe('isNonLatinComposition', () => {
  it('lets a Latin word composed by an Android keyboard through', () => {
    expect(isNonLatinComposition(true, 'MAR')).toBe(false);
  });

  it('keeps the popup closed while a CJK or Hangul composition runs', () => {
    expect(isNonLatinComposition(true, '马')).toBe(true);
    expect(isNonLatinComposition(true, 'あ')).toBe(true);
    expect(isNonLatinComposition(true, '한')).toBe(true);
    // Han extension B, a surrogate pair: the old range list missed it.
    expect(isNonLatinComposition(true, '𠀀')).toBe(true);
  });

  it('does nothing when no composition is active', () => {
    expect(isNonLatinComposition(false, '马')).toBe(false);
  });
});
describe('smartTypeMove', () => {
  it('lands the first Down on the first row where Enter waits for navigation', () => {
    expect(smartTypeMove(0, false, true, 'down', 3)).toBe(0);
    expect(smartTypeMove(0, false, true, 'up', 3)).toBe(2);
  });

  it('steps one row at a time once navigating, clamped to the list', () => {
    expect(smartTypeMove(0, true, true, 'down', 3)).toBe(1);
    expect(smartTypeMove(2, true, true, 'down', 3)).toBe(2);
    expect(smartTypeMove(0, true, true, 'up', 3)).toBe(0);
  });

  it('moves from the highlighted first row in a character cue', () => {
    expect(smartTypeMove(0, false, false, 'down', 3)).toBe(1);
    expect(smartTypeMove(0, false, false, 'up', 3)).toBe(0);
  });

  it('copes with an empty list', () => {
    expect(smartTypeMove(0, false, true, 'down', 0)).toBe(0);
  });
});

describe('custom SmartType lists', () => {
  const lists = {
    scenePrefixes: ['DREAM. ', 'INT. DREAM: ', '[PAST]+ '], times: ['MAGIC HOUR', 'NOON'],
    characterExtensions: ['(THROUGH PHONE)'], transitions: ['FADE TO WHITE:', 'CUT TO:'],
  };
  const customItems = (element: string, text: string, script = emptyScriptIndex()) =>
    suggestSmartType(element, text, text.length, script, lists)?.items ?? [];

  it('offers saved values in each category instead of restoring removed defaults', () => {
    expect(customItems('sceneHeading', 'DR')).toEqual(['DREAM. ']);
    expect(customItems('sceneHeading', 'EX')).toEqual([]);
    expect(customItems('sceneHeading', 'DREAM. ROOM - N')).toEqual(['NOON']);
    expect(customItems('character', 'MARY (T')).toEqual(['(THROUGH PHONE)']);
    expect(customItems('character', 'MARY (V')).toEqual([]);
    expect(customItems('transition', 'FA')).toEqual(['FADE TO WHITE:']);
  });

  it('indexes locations after custom prefixes and offers them at the correct offset', () => {
    const script = buildScriptIndex([
      { type: 'sceneHeading', text: 'DREAM. CASTLE - NOON' },
      { type: 'sceneHeading', text: 'INT. DREAM: CASTLE GARDEN - MAGIC HOUR' },
      { type: 'sceneHeading', text: '[PAST]+ HALL - NIGHT' },
    ], lists);
    expect(script.locations).toEqual(['CASTLE', 'CASTLE GARDEN', 'HALL']);
    expect(suggestSmartType('sceneHeading', 'DREAM. C', 8, script, lists))
      .toEqual({ from: 7, items: ['CASTLE', 'CASTLE GARDEN'] });
    expect(suggestSmartType('sceneHeading', 'INT. DREAM: C', 13, script, lists)?.from).toBe(12);
    expect(customItems('sceneHeading', '[PAST]+ H', script)).toEqual(['HALL']);
  });

  it('still recognizes standard prefixes after they are removed from suggestions', () => {
    const script = buildScriptIndex([{ type: 'sceneHeading', text: 'INT. DINER - DAY' }], lists);
    expect(script.locations).toEqual(['DINER']);
    expect(customItems('sceneHeading', 'INT. D', script)).toEqual(['DINER']);
  });

  it('continues suggesting script-used times and transitions with empty saved lists', () => {
    const empty = { scenePrefixes: [], times: [], characterExtensions: [], transitions: [] };
    const script = buildScriptIndex([
      { type: 'sceneHeading', text: 'INT. DINER - NIGHT' },
      { type: 'transition', text: 'SMASH CUT TO:' },
    ], empty);
    expect(suggestSmartType('sceneHeading', 'INT. DINER - N', 14, script, empty)?.items).toEqual(['NIGHT']);
    expect(suggestSmartType('transition', 'S', 1, script, empty)?.items).toEqual(['SMASH CUT TO:']);
    expect(suggestSmartType('character', 'MARY (', 6, script, empty)).toBeNull();
  });

  it('keeps the saved order and removes overlaps with learned suggestions', () => {
    const script = { characters: [], locations: [], times: ['NOON', 'NIGHT'], transitions: [] };
    expect(customItems('sceneHeading', 'INT. ROOM - ', script)).toEqual(['MAGIC HOUR', 'NOON', 'NIGHT']);
  });
});
