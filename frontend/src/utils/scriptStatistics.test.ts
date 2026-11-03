import { describe, it, expect } from 'vitest';
import { parseHeading } from './scriptStatistics';

describe('parseHeading', () => {
  it('splits prefix, location and time', () => {
    expect(parseHeading('INT. KITCHEN - DAY')).toEqual({ prefix: 'INT.', location: 'KITCHEN', timeOfDay: 'DAY' });
  });

  it('reads the time before a year or note in brackets', () => {
    expect(parseHeading("INT.  WILL'S BEDROOM - NIGHT (1973)")).toEqual({
      prefix: 'INT.', location: "WILL'S BEDROOM", timeOfDay: 'NIGHT',
    });
    expect(parseHeading('EXT. BLOOM BACK YARD - NIGHT [CONTINUOUS]').timeOfDay).toBe('NIGHT');
    expect(parseHeading('EXT. FIELD - DAY (FLASHBACK) (1950)').location).toBe('FIELD');
  });

  it('keeps brackets that are part of the location', () => {
    expect(parseHeading('INT. A.P. NEWSROOM (PARIS) - DAY')).toEqual({
      prefix: 'INT.', location: 'A.P. NEWSROOM (PARIS)', timeOfDay: 'DAY',
    });
  });

  it('leaves the time empty when there is none', () => {
    expect(parseHeading('EXT. OUTSIDE LA RUE 14°').timeOfDay).toBe('');
  });

  it('knows the EST. prefix', () => {
    expect(parseHeading('EST. CITY - DAY')).toEqual({
      prefix: 'EST.', location: 'CITY', timeOfDay: 'DAY',
    });
  });

  it('does not read a prefix out of the end of a word', () => {
    expect(parseHeading('FOREST CLEARING - NIGHT')).toEqual({
      prefix: '', location: 'FOREST CLEARING', timeOfDay: 'NIGHT',
    });
    expect(parseHeading('THE WEST WING - DAY').location).toBe('THE WEST WING');
    expect(parseHeading('GUEST ROOM - LATER').location).toBe('GUEST ROOM');
    expect(parseHeading('PRINT SHOP - DAY').location).toBe('PRINT SHOP');
    expect(parseHeading('NEXT DOOR - NIGHT').location).toBe('NEXT DOOR');
  });
});
