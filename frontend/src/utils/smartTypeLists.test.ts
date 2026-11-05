import { describe, expect, it } from 'vitest';
import { DEFAULT_SMARTTYPE_LISTS, matchScenePrefix, normalizeSmartTypeLists } from './smartTypeLists';

describe('SmartType vocabulary', () => {
  it('keeps the shipped defaults for missing and malformed settings', () => {
    for (const raw of [null, false, 'bad', [], { times: 42 }, { times: ['DAY', null] }]) {
      expect(normalizeSmartTypeLists(raw)).toEqual(DEFAULT_SMARTTYPE_LISTS);
    }
  });

  it('normalizes case, whitespace, duplicates and insertion syntax without sorting', () => {
    expect(normalizeSmartTypeLists({
      scenePrefixes: [' dream. ', 'DREAM.', 'STOCK   FOOTAGE:'],
      times: ['Magic Hour', '  ', 'magic hour', 'noon'],
      characterExtensions: ['through phone', '(V.O.)', 'THROUGH PHONE', '()'],
      transitions: ['fade to white:', 'MATCH   CUT:', 'Fade to white:'],
    })).toEqual({
      scenePrefixes: ['DREAM. ', 'STOCK FOOTAGE: '], times: ['MAGIC HOUR', 'NOON'],
      characterExtensions: ['(THROUGH PHONE)', '(V.O.)'], transitions: ['FADE TO WHITE:', 'MATCH CUT:'],
    });
  });

  it('preserves intentionally empty lists and defaults only missing categories', () => {
    expect(normalizeSmartTypeLists({ times: [] })).toEqual({ ...DEFAULT_SMARTTYPE_LISTS, times: [] });
  });

  it('does not mutate or reuse the input/default arrays', () => {
    const raw = { times: ['noon', 'NOON'] };
    const clean = normalizeSmartTypeLists(raw);
    expect(raw.times).toEqual(['noon', 'NOON']);
    expect(clean.scenePrefixes).not.toBe(DEFAULT_SMARTTYPE_LISTS.scenePrefixes);
  });

  it('matches literal, bounded prefixes and prefers the longest', () => {
    const prefixes = ['INT. ', 'INT. DREAM: ', '[DREAM]+ ', 'ÉXT. '];
    expect(matchScenePrefix('int. dream:   ROOM', prefixes)).toEqual({ prefix: 'INT. DREAM:', length: 14 });
    expect(matchScenePrefix('[DREAM]+ ROOM', prefixes)?.length).toBe(9);
    expect(matchScenePrefix('éxt. ROOM', prefixes)?.length).toBe(5);
    expect(matchScenePrefix('INT. DREAM:ROOM', ['INT. DREAM: '])).toBeNull();
    expect(matchScenePrefix('XINT. ROOM', prefixes)).toBeNull();
  });
});
