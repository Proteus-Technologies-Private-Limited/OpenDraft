/**
 * Right-to-left text, in the order a PDF draws it.
 *
 * Written in escapes, like the Indic tests and for the same reason: a
 * reordering is invisible in rendered text. An editor showing this file would
 * run the bidirectional algorithm over the expected value too, so a correct
 * result and a reversed one would look identical on screen.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { hasRtl, hasArabic, visualRuns, wrapForDrawing } from './bidi';
import { shapeArabic } from './arabicShaping';
import type { WrapRun } from './wrapText';

const run = (text: string, extra: Partial<WrapRun> = {}): WrapRun => ({
  text, bold: false, italic: false, underline: false, ...extra,
});

/** A line's drawn text, which is all most of these care about. */
const drawn = (runs: WrapRun[]): string => runs.map((r) => r.text).join('');

const points = (text: string): string[] => [...text].map(
  (char) => char.codePointAt(0)!.toString(16).padStart(4, '0'),
);

const SHALOM = 'שלום';        // שלום
const SHALOM_VISUAL = 'םולש';

describe('hasRtl', () => {
  it('is false for everything a screenplay usually contains', () => {
    for (const text of [
      'INT. LIBRARY - DAY', 'Привет', 'नमस्ते', '你好', 'สวัสดี', '', 'Café',
    ]) {
      expect(hasRtl(text)).toBe(false);
    }
  });

  it('is true for Hebrew and Arabic, and for a line that merely contains them', () => {
    expect(hasRtl(SHALOM)).toBe(true);
    expect(hasRtl('مرحبا')).toBe(true);
    expect(hasRtl(`INT. ${SHALOM} - DAY`)).toBe(true);
  });

  it('sees the presentation forms too, since shaping produces them', () => {
    expect(hasArabic('ﺑ')).toBe(true);
  });
});

describe('reordering a line', () => {
  it('leaves a Latin line alone, and hands back the very runs it was given', () => {
    const runs = [run('INT. LIBRARY - DAY')];
    expect(visualRuns(runs)).toBe(runs);
  });

  it('reverses a Hebrew line', () => {
    expect(drawn(visualRuns([run(SHALOM)]))).toBe(SHALOM_VISUAL);
  });

  it('keeps Latin words around it in their own direction', () => {
    expect(drawn(visualRuns([run(`A ${SHALOM} B`)]))).toBe(`A ${SHALOM_VISUAL} B`);
  });

  it('keeps a number reading left to right inside a right-to-left line', () => {
    // The digits are not reversed — 123 is not 321 — but they move to the far
    // side of the words, because the line as a whole runs the other way.
    expect(drawn(visualRuns([run(`${SHALOM} 123`)]))).toBe(`123 ${SHALOM_VISUAL}`);
  });

  it('carries each character style with it', () => {
    // The bold half must still be bold after the halves have swapped places.
    const out = visualRuns([run('אב'), run('גד', { bold: true })]);
    expect(out.map((r) => [r.text, r.bold])).toEqual([
      ['דג', true],
      ['בא', false],
    ]);
  });

  it('does not shatter a line into one run per character', () => {
    expect(visualRuns([run(`${SHALOM} ${SHALOM}`)])).toHaveLength(1);
  });

  it('leaves a line carrying a footnote marker in logical order', () => {
    // The marker is drawn after its run; moving the run would put the
    // reference in the middle of another sentence.
    const runs = [run(SHALOM, { marker: '1' })];
    expect(visualRuns(runs)).toBe(runs);
  });
});

describe('Arabic shaping', () => {
  const BEH = 0x0628;
  const LAM = 0x0644;
  const ALEF = 0x0627;
  const shaped = (text: string) => shapeArabic(text)
    .map((char) => char.codePoint.toString(16).padStart(4, '0'));

  it('gives a lone letter its isolated form', () => {
    expect(shaped(String.fromCodePoint(BEH))).toEqual(['fe8f']);
  });

  it('gives each letter of a word the shape its neighbours call for', () => {
    // ببب — initial, medial, final, which is what makes it one joined word
    // rather than three disconnected letters.
    expect(shaped(String.fromCodePoint(BEH, BEH, BEH)))
      .toEqual(['fe91', 'fe92', 'fe90']);
  });

  it('does not join a letter that cannot join forward', () => {
    // Alef joins only to what precedes it, so the beh after it opens a new
    // join rather than continuing one: isolated alef, then initial beh.
    expect(shaped(String.fromCodePoint(ALEF, BEH, BEH)))
      .toEqual(['fe8d', 'fe91', 'fe90']);
  });

  it('writes lam followed by alef as the one ligature Arabic requires', () => {
    // لا is a single glyph; two letters side by side would be wrong, not just
    // ugly. Two characters in, one out.
    expect(shaped(String.fromCodePoint(LAM, ALEF))).toEqual(['fefb']);
  });

  it('uses the joined form of that ligature when something precedes it', () => {
    expect(shaped(String.fromCodePoint(BEH, LAM, ALEF))).toEqual(['fe91', 'fefc']);
  });

  it('shapes the letters Persian and Urdu add, not only the Arabic alphabet', () => {
    // پ (peh) has all four forms in the Presentation Forms-A block.
    expect(shaped(String.fromCodePoint(0x067e, 0x067e))).toEqual(['fb58', 'fb57']);
  });

  it('joins across a mark that sits on a letter', () => {
    // A fatha between two letters must not break the join: it is transparent.
    expect(shaped(String.fromCodePoint(BEH, 0x064e, BEH)))
      .toEqual(['fe91', '064e', 'fe90']);
  });

  it('leaves everything that is not an Arabic letter exactly as it was', () => {
    expect(shaped('INT. 12')).toEqual(points('INT. 12'));
  });
});

describe('Arabic through the whole path', () => {
  it('shapes and then reverses, so the word reads right to left in joined forms', () => {
    // بب: shaped to initial+final, then drawn final-first because the line
    // runs the other way.
    const out = drawn(visualRuns([run(String.fromCodePoint(0x0628, 0x0628))]));
    expect(points(out)).toEqual(['fe90', 'fe91']);
  });

  it('shapes using the letters as written, not as drawn', () => {
    // If reordering happened first, the shaping would see the word backwards
    // and give the first letter a final form instead of an initial one. The
    // visual output starting with the *final* form is what proves the order.
    const out = drawn(visualRuns([run(String.fromCodePoint(0x0628, 0x0628, 0x0628))]));
    expect(points(out)).toEqual(['fe90', 'fe92', 'fe91']);
  });
});

describe('wrapForDrawing', () => {
  it('wraps and reorders together, so no drawing path can miss the reorder', () => {
    const lines = wrapForDrawing([run(SHALOM)], 40, false);
    expect(lines).toHaveLength(1);
    expect(drawn(lines[0])).toBe(SHALOM_VISUAL);
  });

  it('still wraps a Latin paragraph exactly as the wrapper alone would', () => {
    const text = 'The quick brown fox jumps over the lazy dog and keeps going';
    const lines = wrapForDrawing([run(text)], 20, false);
    expect(lines.map(drawn).join(' ')).toBe(text);
    expect(lines.length).toBeGreaterThan(1);
  });
});
