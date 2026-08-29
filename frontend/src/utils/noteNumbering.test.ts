import { describe, it, expect } from 'vitest';
import {
  formatNoteNumber,
  noteMarkerText,
  noteEntryLabel,
  markerWidthUpperBound,
  NOTE_NUMBER_FORMATS,
  type NoteNumberFormat,
} from './noteNumbering';

describe('formatNoteNumber', () => {
  it('numbers arabic from one', () => {
    expect(formatNoteNumber(1, 'arabic')).toBe('1');
    expect(formatNoteNumber(42, 'arabic')).toBe('42');
  });

  it('rolls lower alpha over at z', () => {
    expect(formatNoteNumber(1, 'lowerAlpha')).toBe('a');
    expect(formatNoteNumber(26, 'lowerAlpha')).toBe('z');
    expect(formatNoteNumber(27, 'lowerAlpha')).toBe('aa');
    expect(formatNoteNumber(28, 'lowerAlpha')).toBe('ab');
    expect(formatNoteNumber(52, 'lowerAlpha')).toBe('az');
    expect(formatNoteNumber(53, 'lowerAlpha')).toBe('ba');
  });

  it('upper alpha is the same sequence, cased', () => {
    expect(formatNoteNumber(27, 'upperAlpha')).toBe('AA');
  });

  it('writes roman subtractively', () => {
    expect(formatNoteNumber(4, 'lowerRoman')).toBe('iv');
    expect(formatNoteNumber(9, 'lowerRoman')).toBe('ix');
    expect(formatNoteNumber(14, 'lowerRoman')).toBe('xiv');
    expect(formatNoteNumber(40, 'lowerRoman')).toBe('xl');
    expect(formatNoteNumber(1990, 'lowerRoman')).toBe('mcmxc');
    expect(formatNoteNumber(14, 'upperRoman')).toBe('XIV');
  });

  it('cycles the four symbols and doubles them, as Word does', () => {
    expect(formatNoteNumber(1, 'symbol')).toBe('*');
    expect(formatNoteNumber(2, 'symbol')).toBe('†');
    expect(formatNoteNumber(3, 'symbol')).toBe('‡');
    expect(formatNoteNumber(4, 'symbol')).toBe('§');
    expect(formatNoteNumber(5, 'symbol')).toBe('**');
    expect(formatNoteNumber(8, 'symbol')).toBe('§§');
    expect(formatNoteNumber(9, 'symbol')).toBe('***');
  });

  it('falls back to one below the first number', () => {
    // A zero-numbered footnote is always a bug, and alpha/roman cannot express it.
    expect(formatNoteNumber(0, 'lowerRoman')).toBe('i');
    expect(formatNoteNumber(-3, 'arabic')).toBe('1');
    expect(formatNoteNumber(NaN, 'lowerAlpha')).toBe('a');
  });
});

describe('markers and entry labels', () => {
  it('raises the bare number, or brackets it', () => {
    expect(noteMarkerText(3, 'arabic', 'superscript')).toBe('3');
    expect(noteMarkerText(3, 'arabic', 'bracketed')).toBe('[3]');
  });

  it('opens the note line with the bare number whatever the marker style', () => {
    // Word does the same: the brackets are a reference affordance, not identity.
    expect(noteEntryLabel(3, 'lowerRoman')).toBe('iii');
  });
});

describe('markerWidthUpperBound', () => {
  const FORMATS = NOTE_NUMBER_FORMATS.map((f) => f.id);

  it('is zero when nothing prints', () => {
    expect(markerWidthUpperBound(1, 0, 'arabic', 'superscript')).toBe(0);
  });

  it('never under-reports the widest marker actually drawn', () => {
    // The whole point: reserved space must be >= drawn space, in every format,
    // or a footnote silently overflows the room pagination left for it.
    for (const format of FORMATS as NoteNumberFormat[]) {
      for (const style of ['superscript', 'bracketed'] as const) {
        for (const startAt of [1, 5, 97]) {
          const count = 40;
          const bound = markerWidthUpperBound(startAt, count, format, style);
          for (let i = 0; i < count; i++) {
            expect(noteMarkerText(startAt + i, format, style).length)
              .toBeLessThanOrEqual(bound);
          }
        }
      }
    }
  });

  it('covers roman, whose width is not monotone', () => {
    // viii (4) is wider than ix (2), so taking the last number would under-reserve.
    expect(markerWidthUpperBound(1, 9, 'lowerRoman', 'superscript')).toBe(4);
  });

  it('does not shrink as more notes are added', () => {
    for (const format of FORMATS as NoteNumberFormat[]) {
      let prev = 0;
      for (const count of [1, 5, 30, 200]) {
        const w = markerWidthUpperBound(1, count, format, 'superscript');
        expect(w).toBeGreaterThanOrEqual(prev);
        prev = w;
      }
    }
  });

  it('accounts for the brackets', () => {
    expect(markerWidthUpperBound(1, 9, 'arabic', 'bracketed'))
      .toBe(markerWidthUpperBound(1, 9, 'arabic', 'superscript') + 2);
  });
});
