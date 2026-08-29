/**
 * How a printed note's number is rendered.
 *
 * Four things have to agree on this: the marker drawn in the script, the label
 * that opens the note's own line, the PDF, and the settings dialog's preview.
 * They live here together for the same reason `getTextLines` and `wordWrapRuns`
 * live together in wrapText.ts — a preview that disagrees with the export is
 * worse than no preview at all.
 *
 * Deliberately dependency-free so it is testable in the node environment.
 */

export type NoteNumberFormat =
  | 'arabic'      // 1, 2, 3
  | 'lowerAlpha'  // a, b, c … z, aa, ab
  | 'upperAlpha'  // A, B, C
  | 'lowerRoman'  // i, ii, iii
  | 'upperRoman'  // I, II, III
  | 'symbol';     // *, †, ‡, § then **, ††, ‡‡, §§

/** In-script marker presentation. */
export type FootnoteMarkerStyle = 'superscript' | 'bracketed';

/** The dialog's dropdown, and the single source of truth for what is valid. */
export const NOTE_NUMBER_FORMATS: ReadonlyArray<{
  id: NoteNumberFormat;
  label: string;
}> = [
  { id: 'arabic', label: '1, 2, 3, …' },
  { id: 'lowerAlpha', label: 'a, b, c, …' },
  { id: 'upperAlpha', label: 'A, B, C, …' },
  { id: 'lowerRoman', label: 'i, ii, iii, …' },
  { id: 'upperRoman', label: 'I, II, III, …' },
  { id: 'symbol', label: '*, †, ‡, §' },
];

/** Word's footnote symbols, in Word's order. */
const SYMBOLS = ['*', '†', '‡', '§'];

const ROMAN: ReadonlyArray<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
  [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
  [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
];

/** Bijective base-26: 1→a, 26→z, 27→aa. Not the same as base-26 with a zero. */
function toAlpha(n: number): string {
  let out = '';
  let v = n;
  while (v > 0) {
    const rem = (v - 1) % 26;
    out = String.fromCharCode(97 + rem) + out;
    v = Math.floor((v - 1) / 26);
  }
  return out;
}

function toRoman(n: number): string {
  let out = '';
  let v = n;
  for (const [value, numeral] of ROMAN) {
    while (v >= value) {
      out += numeral;
      v -= value;
    }
  }
  return out;
}

/**
 * The number itself, in the chosen format. `n` is 1-based.
 *
 * Anything below 1 falls back to 1: a zero-numbered footnote is always a bug,
 * and the alpha and roman conversions have no representation for it.
 */
export function formatNoteNumber(n: number, format: NoteNumberFormat): string {
  const v = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  switch (format) {
    case 'lowerAlpha': return toAlpha(v);
    case 'upperAlpha': return toAlpha(v).toUpperCase();
    case 'lowerRoman': return toRoman(v);
    case 'upperRoman': return toRoman(v).toUpperCase();
    case 'symbol': {
      // Word cycles the four symbols, doubling each time round: * † ‡ § ** ††…
      const idx = (v - 1) % SYMBOLS.length;
      const repeat = Math.floor((v - 1) / SYMBOLS.length) + 1;
      return SYMBOLS[idx].repeat(repeat);
    }
    case 'arabic':
    default:
      return String(v);
  }
}

/** The marker drawn in the script at the anchor: `1` (raised) or `[1]`. */
export function noteMarkerText(
  n: number,
  format: NoteNumberFormat,
  style: FootnoteMarkerStyle,
): string {
  const num = formatNoteNumber(n, format);
  return style === 'bracketed' ? `[${num}]` : num;
}

/**
 * The label that opens the note's own line in the footnote block.
 *
 * Word writes the bare number there whatever the in-script style is — the
 * brackets are a reference affordance, not part of the note's identity.
 */
export function noteEntryLabel(n: number, format: NoteNumberFormat): string {
  return formatNoteNumber(n, format);
}

/**
 * The widest marker this document could possibly produce.
 *
 * This is what breaks the circularity that would otherwise make footnote
 * pagination iterative: a note's height depends on how much of its first line
 * the marker eats, the marker depends on the note's number, and in
 * "restart each page" mode the number depends on which page the note landed on
 * — which is what pagination is trying to work out.
 *
 * Measuring against the widest possible marker instead of the actual one makes
 * the reserved space always greater than or equal to the drawn space, which is
 * the safe direction, and makes pagination completely independent of the
 * numbers. It costs at most one extra wrapped line, and only when a note's text
 * ends within a character or two of a line boundary.
 *
 * Roman numerals are not monotone in width (`viii` is wider than `ix`), so the
 * range is scanned rather than assuming the last number is the widest.
 */
export function markerWidthUpperBound(
  startAt: number,
  count: number,
  format: NoteNumberFormat,
  style: FootnoteMarkerStyle,
): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  const first = Number.isFinite(startAt) ? Math.max(1, Math.floor(startAt)) : 1;
  // Bounded by the number of printing notes in one script; the cap only exists
  // so a corrupt count cannot spin.
  const last = first + Math.min(Math.floor(count), 10000) - 1;
  let widest = 0;
  for (let n = first; n <= last; n++) {
    const w = noteMarkerText(n, format, style).length;
    if (w > widest) widest = w;
  }
  return widest;
}
