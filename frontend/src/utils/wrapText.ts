/**
 * Monospace line breaking — the shared contract between on-screen pagination
 * and PDF output.
 *
 * These two must agree exactly. `getTextLines` decides where the editor draws
 * page breaks; `wordWrapRuns` decides where the PDF exporter starts a new line.
 * If they disagree by even one line, a script paginates differently on screen
 * than in the file the writer sends out. They live together here, and a test
 * asserts they return the same count for the same block.
 *
 * Hard breaks arrive as newlines (see `leafText` in
 * `editor/extensions/ScreenplayHardBreak.ts` for the ProseMirror side, and
 * `jsonBlockText` for the JSON side) and force a line boundary. A blank segment
 * — from a doubled or trailing break — still occupies a line, because that is
 * what the writer sees in the editor.
 *
 * Deliberately dependency-free so it is testable in the node environment.
 */

export interface WrapRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** A hard break: forces a line boundary, contributes no characters. */
  isBreak?: boolean;
  /**
   * Typeface the run was given, carried through for renderers.  Line breaking
   * deliberately ignores it: the character grid is what the editor paginates
   * on, so a font change must not move a page break.
   */
  fontFamily?: string;
  /**
   * A footnote reference drawn immediately after this run's text, raised and
   * small.
   *
   * It is carried beside the text rather than in it because it advances the
   * cursor by nothing: a superscript overhangs into the space that follows, the
   * same way the editor's marker decoration does. That is what lets the PDF and
   * the editor agree to the character — the editor cannot see a decoration in
   * `node.textContent`, so if the marker consumed cells here the two would
   * wrap differently. A bracketed marker is ordinary text and is spliced into
   * the run's own text instead, where it does consume cells in both.
   */
  marker?: string;
}

const emptyRun = (): WrapRun => ({ text: '', bold: false, italic: false, underline: false });

/**
 * The characters that occupy two cells of the grid rather than one.
 *
 * Han, kana and hangul are drawn square — as wide as they are tall — which is
 * twice the width of the Courier cell everything here counts in. Counting them
 * as one cell each would break a Chinese line at twice the margin: the count
 * says the line fits, and the glyphs run off the page. This is the East Asian
 * Wide and Fullwidth classification, which is what every terminal and text
 * editor uses for the same purpose.
 *
 * Nothing else is affected. For any text without these blocks in it — Latin,
 * Cyrillic, Greek, and every Indic script, which are drawn narrow — the column
 * count and the character count are the same number, so this changes no
 * pagination that existed before it.
 */
const WIDE_RANGES: readonly (readonly [number, number])[] = [
  [0x1100, 0x115f], // hangul jamo
  [0x2e80, 0x303e], // CJK radicals, kangxi, CJK symbols and punctuation
  [0x3041, 0x33ff], // kana, hangul compatibility jamo, CJK compatibility
  [0x3400, 0x4dbf], // CJK extension A
  [0x4e00, 0x9fff], // CJK unified ideographs
  [0xa000, 0xa4cf], // yi
  [0xa960, 0xa97f], // hangul jamo extended-A
  [0xac00, 0xd7a3], // hangul syllables
  [0xf900, 0xfaff], // CJK compatibility ideographs
  [0xfe10, 0xfe19], // vertical forms
  [0xfe30, 0xfe6f], // CJK compatibility forms, small form variants
  [0xff00, 0xff60], // fullwidth forms
  [0xffe0, 0xffe6], // fullwidth signs
  [0x1f300, 0x1f64f], // emoji, which browsers and readers also draw square
  [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd], // CJK extensions B and beyond
];

function isWide(codePoint: number): boolean {
  for (const [lo, hi] of WIDE_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/**
 * How many cells of the grid `text` occupies.
 *
 * Pagination calls this for every block in the script on every keystroke, so
 * the common case has to be cheap: one comparison per character establishes
 * that a Latin script has nothing wide in it, and only a character above the
 * hangul jamo block is looked up properly.
 */
export function textColumns(text: string): number {
  let columns = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x1100) { columns += 1; continue; }
    const codePoint = text.codePointAt(i)!;
    if (codePoint > 0xffff) i++; // a surrogate pair is one character
    columns += isWide(codePoint) ? 2 : 1;
  }
  return columns;
}

/**
 * The longest prefix of `text` that fits in `max` cells.
 *
 * Always at least one character, even where that one character is wider than
 * the whole line: a prefix of nothing would leave the caller slicing forever.
 * Both the counter and the wrapper cut over-long tokens through here, which is
 * what keeps them agreeing on where a wide character lands.
 */
export function sliceColumns(text: string, max: number): string {
  let taken = '';
  let columns = 0;
  for (const char of text) {
    const width = isWide(char.codePointAt(0)!) ? 2 : 1;
    if (taken.length > 0 && columns + width > max) break;
    taken += char;
    columns += width;
    if (columns >= max) break;
  }
  return taken;
}

/** Would merging these two runs change how either is drawn? */
function drawsAlike(a: WrapRun, b: WrapRun): boolean {
  return a.bold === b.bold && a.italic === b.italic
    && a.underline === b.underline && a.fontFamily === b.fontFamily;
}

/**
 * How many rendered lines a block's text occupies at `cpl` characters per line.
 *
 * This counts the lines `wordWrapRuns` would produce for the same text — the
 * same greedy fill, the same treatment of indents, trailing spaces and
 * over-long tokens — without building any of them, because pagination calls it
 * for every block in the script on every keystroke.
 *
 * It used to answer `ceil(length / cpl)`, as if a line could be cut mid-word.
 * Nothing breaks text that way: the PDF wraps on spaces and so does the browser
 * rendering the editor, so on any paragraph whose last word did not happen to
 * land flush with the margin this returned one line too few. The error is per
 * paragraph and cumulative — three or four lines into a page is routine — so
 * the editor drew its page break well after the page had actually filled and
 * the exported PDF turned over somewhere else entirely (issue #123).
 *
 * The one shape it cannot see is a mark that starts or ends inside a word:
 * `wordWrapRuns` can break at that run boundary, and plain text has no boundary
 * to break at. Emphasis normally spans whole words, and an extra break
 * opportunity can only ever save a line, never cost one.
 */
export function getTextLines(text: string, cpl: number): number {
  let lines = 0;
  /** Spaces with no word yet to hang them on — a deliberate indent. */
  let pendingIndent = 0;
  /** Characters already on the line being filled, and whether one is open. */
  let chars = 0;
  let open = false;
  let sawToken = false;
  let wordsInSegment = 0;

  /**
   * Place one word — `token` includes its indent and the spaces trailing it.
   *
   * It is the text rather than its width because an over-long token has to be
   * cut exactly where the wrapper cuts it, and with a double-width character
   * straddling the margin that is not something a width alone can say.
   */
  const place = (token: string, indent: number) => {
    sawToken = true;
    wordsInSegment++;
    const len = textColumns(token);
    if (len > cpl) {
      // An unbroken token wider than the line is cut at the margin, exactly as
      // the wrapper cuts it; whatever is left over opens the next line.
      if (open) { lines++; chars = 0; open = false; }
      let rest = token;
      let left = len;
      while (left > cpl) {
        const head = sliceColumns(rest, cpl);
        lines++;
        rest = rest.slice(head.length);
        left -= textColumns(head);
      }
      if (left > 0) { chars = left; open = true; }
    } else if (!open) {
      chars = len;
      open = true;
    } else if (chars + len <= cpl) {
      chars += len;
    } else {
      // Wrapped: the word starts the next line, and its leading indent — which
      // belonged to the gap it has just left — is trimmed off.
      lines++;
      chars = len - indent;
      open = true;
    }
  };

  const segments = text.split('\n');
  for (let s = 0; s < segments.length; s++) {
    if (s > 0) {
      // A hard break closes the line whether or not anything is on it.
      lines++;
      chars = 0;
      open = false;
      sawToken = true;
      wordsInSegment = 0;
    }
    const seg = segments[s];
    let i = 0;
    // Spaces with no word ahead of them are held, not counted here — they are
    // an indent, and they belong to the first word that follows, even if that
    // word is past a hard break.
    while (i < seg.length && seg[i] === ' ') { pendingIndent++; i++; }
    while (i < seg.length) {
      let j = i;
      while (j < seg.length && seg[j] !== ' ') j++;
      // The spaces after a word ride on it, so they are paid for by the line
      // the word lands on — which is how the wrapper measures them.
      let k = j;
      while (k < seg.length && seg[k] === ' ') k++;
      const indent = pendingIndent;
      pendingIndent = 0;
      place(' '.repeat(indent) + seg.slice(i, k), indent);
      i = k;
    }
  }

  if (open) lines++;
  // A trailing break opens a line the writer left empty.
  else if (segments.length > 1 && wordsInSegment === 0) lines++;
  // Nothing at all — an empty block still occupies its line.
  return sawToken ? lines : 1;
}

/**
 * Word-wrap styled runs using character counting (monospace).
 */
export function wordWrapRuns(
  runs: WrapRun[],
  maxChars: number,
  forceUppercase: boolean,
): WrapRun[][] {
  const words: WrapRun[] = [];
  // Spaces with no preceding word to hang them on — i.e. at the very start of a
  // block, or straight after a hard break. That is exactly where deliberate
  // indentation lives, and it used to be dropped: the empty token was skipped
  // and the "put the space back on the previous word" branch had no previous
  // word to use. `getTextLines` counted those spaces all along, so the PDF came
  // out both unindented and, at a wrap boundary, a line out of step with the
  // editor. Held here and prepended to the next real word instead.
  let pendingIndent = '';
  for (const run of runs) {
    if (run.isBreak) {
      // Never uppercased, never merged into a neighbouring word.
      words.push({ ...emptyRun(), isBreak: true });
      continue;
    }
    const text = forceUppercase ? run.text.toUpperCase() : run.text;
    const parts = text.split(' ');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        const prev = words[words.length - 1];
        if (prev && !prev.isBreak) {
          prev.text += ' ';
        } else {
          pendingIndent += ' ';
        }
      }
      if (parts[i].length > 0) {
        words.push({
          text: pendingIndent + parts[i],
          bold: run.bold,
          italic: run.italic,
          underline: run.underline,
          fontFamily: run.fontFamily,
        });
        pendingIndent = '';
      }
    }
    if (run.marker) {
      // Rides on the word the reference is anchored to, so it can never be
      // wrapped onto a line of its own away from the phrase it belongs to.
      const last = words[words.length - 1];
      if (last && !last.isBreak) last.marker = (last.marker ?? '') + run.marker;
      else words.push({ ...emptyRun(), marker: run.marker });
    }
  }

  if (words.length === 0) return [[emptyRun()]];

  const lines: WrapRun[][] = [];
  let currentLine: WrapRun[] = [];
  let currentLineChars = 0;

  const flush = () => {
    if (currentLine.length > 0) {
      const lastRun = currentLine[currentLine.length - 1];
      lastRun.text = lastRun.text.replace(/ +$/, '');
      lines.push(currentLine);
    } else {
      // A break with nothing before it on this line — a line the writer left
      // deliberately empty.
      lines.push([emptyRun()]);
    }
    currentLine = [];
    currentLineChars = 0;
  };

  for (const word of words) {
    if (word.isBreak) {
      flush();
      continue;
    }

    // A token longer than the line — a URL, a file path, an unbroken string of
    // dashes — cannot be placed by splitting on spaces. Emitting it whole left
    // it running past the right margin, and made this function disagree with
    // `getTextLines`, which has always counted it as ceil(length / cpl). The
    // editor's own page thumbnail broke it too (`.page-thumb-el`), so the PDF
    // was the last place a script could still overflow its margin.
    if (textColumns(word.text) > maxChars) {
      if (currentLine.length > 0) flush();
      let rest = word.text;
      let left = textColumns(rest);
      while (left > maxChars) {
        const head = sliceColumns(rest, maxChars);
        lines.push([{ ...word, text: head }]);
        rest = rest.slice(head.length);
        left -= textColumns(head);
      }
      // Whatever is left starts the next line, so a following word can still
      // share it — `getTextLines` counts the segment as one run of characters.
      if (rest.length > 0) {
        currentLine = [{ ...word, text: rest }];
        currentLineChars = left;
      } else if (word.marker) {
        // The token divided exactly; the reference belongs to its last piece.
        const tail = lines[lines.length - 1];
        tail[tail.length - 1].marker = word.marker;
      }
      continue;
    }

    const wordLen = textColumns(word.text);

    const asRun = (text: string): WrapRun => ({
      text, bold: word.bold, italic: word.italic, underline: word.underline,
      fontFamily: word.fontFamily, ...(word.marker ? { marker: word.marker } : {}),
    });

    if (currentLine.length === 0) {
      currentLine.push(asRun(word.text));
      currentLineChars = wordLen;
    } else if (currentLineChars + wordLen <= maxChars) {
      const last = currentLine[currentLine.length - 1];
      // Runs merge only when they render identically — a differing typeface
      // keeps them apart, or the second would be drawn in the first's font.
      // A run carrying a marker never absorbs another, or the reference would
      // end up drawn in the middle of the following word.
      if (drawsAlike(last, word) && !last.marker) {
        last.text += word.text;
        if (word.marker) last.marker = word.marker;
      } else {
        currentLine.push(asRun(word.text));
      }
      currentLineChars += wordLen;
    } else {
      const lastRun = currentLine[currentLine.length - 1];
      lastRun.text = lastRun.text.replace(/ +$/, '');
      lines.push(currentLine);
      const trimmedWord = word.text.replace(/^ +/, '');
      currentLine = [asRun(trimmedWord)];
      currentLineChars = textColumns(trimmedWord);
    }
  }

  if (currentLine.length > 0) {
    const lastRun = currentLine[currentLine.length - 1];
    lastRun.text = lastRun.text.replace(/ +$/, '');
    lines.push(currentLine);
  } else if (words[words.length - 1]?.isBreak) {
    // A trailing break opens a line the writer left empty. Emitting it keeps
    // the count equal to getTextLines, which counts the empty segment after a
    // trailing newline — otherwise the PDF would be a line short.
    lines.push([emptyRun()]);
  }

  return lines.length > 0 ? lines : [[emptyRun()]];
}
