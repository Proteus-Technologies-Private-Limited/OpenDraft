/**
 * The script font size the page is laid out for (#270).
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { BASE_FONT_PT, fontScaleOf, scaledCpl, scriptFontSize } from './fontScale';

describe('scriptFontSize', () => {
  it('is the standard 12pt when a layout does not say', () => {
    expect(scriptFontSize({})).toBe(BASE_FONT_PT);
    expect(scriptFontSize(undefined)).toBe(BASE_FONT_PT);
    expect(scriptFontSize(null)).toBe(BASE_FONT_PT);
  });

  it('reads the size a layout was saved with', () => {
    expect(scriptFontSize({ fontSize: 18 })).toBe(18);
  });

  it('ignores a size that cannot be laid out with', () => {
    for (const bad of [0, -4, NaN, Infinity, '18' as unknown as number]) {
      expect(scriptFontSize({ fontSize: bad }), String(bad)).toBe(BASE_FONT_PT);
    }
  });

  it('clamps an absurd size into the range the editor offers', () => {
    expect(scriptFontSize({ fontSize: 1 })).toBe(6);
    expect(scriptFontSize({ fontSize: 500 })).toBe(96);
  });
});

describe('fontScaleOf', () => {
  it('is 1 at the standard size, so nothing paginates differently there', () => {
    expect(fontScaleOf({})).toBe(1);
    expect(fontScaleOf({ fontSize: 12 })).toBe(1);
  });

  it('is the size over 12', () => {
    expect(fontScaleOf({ fontSize: 18 })).toBe(1.5);
    expect(fontScaleOf({ fontSize: 8 })).toBeCloseTo(2 / 3, 10);
  });
});

describe('scaledCpl', () => {
  it('is exactly the 12pt count at scale 1', () => {
    for (const cpl of [24, 36, 62]) expect(scaledCpl(cpl, 1)).toBe(cpl);
  });

  it('fits fewer characters on a line when the type is larger', () => {
    expect(scaledCpl(62, 1.5, 6)).toBe(41);
    expect(scaledCpl(36, 1.5, 3.5)).toBe(24); // 24.000…, not 23.999…
    expect(scaledCpl(62, 2, 6)).toBe(31);
  });

  it('measures from the width, not from the rounded count at 12pt', () => {
    // 3.5in of dialogue is 36.17 columns; 36 / 1.1667 = 30.86 would say 30,
    // but the browser fits 31 at 14pt.
    expect(scaledCpl(36, 14 / 12, 3.5)).toBe(31);
  });

  it('fits more when it is smaller', () => {
    expect(scaledCpl(62, 2 / 3, 6)).toBe(93);
  });

  it('never goes below one character', () => {
    expect(scaledCpl(10, 8, 1)).toBe(1);
  });
});
