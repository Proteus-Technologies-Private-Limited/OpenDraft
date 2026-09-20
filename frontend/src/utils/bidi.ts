/**
 * Putting a right-to-left line into the order it is drawn in.
 *
 * Hebrew and Arabic are stored in the order they are read — first letter
 * first — and drawn from the right edge of the line leftwards. Every renderer
 * that shows them correctly is running the Unicode bidirectional algorithm to
 * get from one to the other. jsPDF runs nothing: it paints characters left to
 * right in the order it is handed them, so שלום goes out as םולש. That is a
 * worse failure than the blank page the fallback fonts exist to prevent,
 * because it looks like text — a writer who cannot read the script would send
 * the file out.
 *
 * So the line is reordered here, after wrapping and before drawing. The
 * algorithm itself is `bidi-js`, which implements the whole of UAX #9
 * including the bracket-pair rules; writing another one by hand would be a
 * month of subtle bugs for no gain.
 *
 * ## What this does and does not change
 *
 * It reorders characters within a line. It does **not** mirror the page: the
 * margins, indents and alignment of a screenplay stay exactly where Final
 * Draft puts them, and a Hebrew line still starts at the left margin of its
 * block. A conventionally laid-out RTL screenplay — right-aligned dialogue,
 * mirrored margins — is a larger change that reaches the editor and every
 * exporter, and it is not this. What this buys is that the text reads
 * correctly, which it did not before at any price.
 *
 * Wrapping still happens in logical order, which is correct: a line is chosen
 * by the words in it, and only then laid out. The consequence is that a line
 * is reordered after it has been measured, and since reordering moves the same
 * characters about, the measurement stays true.
 */
import bidiFactory from 'bidi-js';
import { wordWrapRuns, type WrapRun } from './wrapText';
import { shapeArabic } from './arabicShaping';

const bidi = bidiFactory();

/** Hebrew, and the presentation forms of Hebrew. */
const HEBREW: readonly (readonly [number, number])[] = [
  [0x0590, 0x05ff], [0xfb1d, 0xfb4f],
];

/** Arabic, its extensions, and both presentation-form blocks. */
const ARABIC: readonly (readonly [number, number])[] = [
  [0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff],
  [0xfb50, 0xfdff], [0xfe70, 0xfeff],
];

function inAny(codePoint: number, ranges: readonly (readonly [number, number])[]): boolean {
  for (const [lo, hi] of ranges) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/** Whether there is any Arabic here to shape. */
export function hasArabic(text: string): boolean {
  for (const char of text) {
    if (inAny(char.codePointAt(0)!, ARABIC)) return true;
  }
  return false;
}

/**
 * Whether there is any right-to-left text here at all.
 *
 * Every line of every Latin screenplay is asked this, so it is a range check
 * per character and nothing more. Only a line that answers yes pays for the
 * algorithm.
 */
export function hasRtl(text: string): boolean {
  for (const char of text) {
    const codePoint = char.codePointAt(0)!;
    if (codePoint < 0x0590) continue; // below every RTL block: the common case
    if (inAny(codePoint, HEBREW) || inAny(codePoint, ARABIC)) return true;
  }
  return false;
}

/** One character of a line, and which run's style it is drawn in. */
interface Cell {
  char: string;
  run: number;
}

/** Flatten a line's runs into characters that remember where they came from. */
function cells(runs: WrapRun[]): Cell[] {
  const out: Cell[] = [];
  runs.forEach((run, index) => {
    if (run.isBreak) return;
    for (const char of run.text) out.push({ char, run: index });
  });
  return out;
}

/** Rebuild runs from characters that are now in the order they are drawn. */
function rebuild(ordered: Cell[], runs: WrapRun[]): WrapRun[] {
  const out: WrapRun[] = [];
  let openRun = -1;
  for (const cell of ordered) {
    // Characters from the same run that are still next to each other stay one
    // run, so this does not shatter a line into one run per letter.
    if (openRun === cell.run) {
      out[out.length - 1].text += cell.char;
      continue;
    }
    const source = runs[cell.run];
    out.push({
      text: cell.char,
      bold: source.bold,
      italic: source.italic,
      underline: source.underline,
      ...(source.fontFamily ? { fontFamily: source.fontFamily } : {}),
    });
    openRun = cell.run;
  }
  return out;
}

/**
 * Reorder one wrapped line into the order it is drawn, shaping Arabic on the
 * way.
 *
 * Shaping happens first and in logical order, because which shape a letter
 * takes depends on the letters either side of it as they were written, not as
 * they will be painted. The presentation forms it produces are classified as
 * Arabic by the bidirectional algorithm exactly as the letters they replace
 * were, so reordering afterwards sees the same line it would have seen.
 *
 * A run carrying a footnote marker is left alone: the marker is drawn after
 * its run and moving the run out from under it would put the reference
 * somewhere else in the sentence. Those lines keep their logical order, which
 * for a Latin script — where footnotes are actually used — is also the order
 * they are drawn in.
 */
export function visualRuns(runs: WrapRun[]): WrapRun[] {
  if (runs.some((run) => run.isBreak || run.marker)) return runs;

  const logical = cells(runs);
  const text = logical.map((cell) => cell.char).join('');
  if (!hasRtl(text)) return runs;

  let line = logical;
  if (hasArabic(text)) {
    const shaped = shapeArabic(text);
    line = shaped.map((char) => ({
      char: String.fromCodePoint(char.codePoint),
      run: logical[char.source].run,
    }));
  }

  const shapedText = line.map((cell) => cell.char).join('');
  const levels = bidi.getEmbeddingLevels(shapedText);
  const order = bidi.getReorderedIndices(shapedText, levels);

  return rebuild(order.map((index) => line[index]), runs);
}

/**
 * Wrap runs for the page, then put each line in the order it is drawn.
 *
 * Every PDF drawing path goes through here rather than calling
 * `wordWrapRuns` directly, so there is one place a right-to-left line can be
 * missed rather than six. The editor's own pagination still calls the wrapper
 * itself, and should: the browser runs the bidirectional algorithm over what
 * it is given, and handing it text already reordered would reorder it twice.
 *
 * That split is also why this lives here and not in `wrapText`, which is
 * deliberately dependency-free — pulling `bidi-js` into it would put the
 * algorithm on the path of every keystroke.
 */
export function wrapForDrawing(
  runs: WrapRun[],
  maxChars: number,
  forceUppercase: boolean,
): WrapRun[][] {
  return wordWrapRuns(runs, maxChars, forceUppercase).map(visualRuns);
}
