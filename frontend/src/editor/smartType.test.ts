import { describe, it, expect } from 'vitest';
import {
  MAX_ITEMS,
  buildScriptIndex,
  emptyScriptIndex,
  suggestSmartType,
  type ScriptIndex,
} from './smartType';

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
