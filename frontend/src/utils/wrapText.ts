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
}

const emptyRun = (): WrapRun => ({ text: '', bold: false, italic: false, underline: false });

/**
 * How many rendered lines a block's text occupies at `cpl` characters per line.
 */
export function getTextLines(text: string, cpl: number): number {
  if (text.length === 0) return 1;
  return text
    .split('\n')
    .reduce((n, seg) => n + (seg.length === 0 ? 1 : Math.ceil(seg.length / cpl)), 0);
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
    if (word.text.length > maxChars) {
      if (currentLine.length > 0) flush();
      let rest = word.text;
      while (rest.length > maxChars) {
        lines.push([{ ...word, text: rest.slice(0, maxChars) }]);
        rest = rest.slice(maxChars);
      }
      // Whatever is left starts the next line, so a following word can still
      // share it — `getTextLines` counts the segment as one run of characters.
      if (rest.length > 0) {
        currentLine = [{ ...word, text: rest }];
        currentLineChars = rest.length;
      }
      continue;
    }

    const wordLen = word.text.length;

    if (currentLine.length === 0) {
      currentLine.push({ text: word.text, bold: word.bold, italic: word.italic, underline: word.underline, fontFamily: word.fontFamily });
      currentLineChars = wordLen;
    } else if (currentLineChars + wordLen <= maxChars) {
      const last = currentLine[currentLine.length - 1];
      // Runs merge only when they render identically — a differing typeface
      // keeps them apart, or the second would be drawn in the first's font.
      if (last.bold === word.bold && last.italic === word.italic
        && last.underline === word.underline && last.fontFamily === word.fontFamily) {
        last.text += word.text;
      } else {
        currentLine.push({ text: word.text, bold: word.bold, italic: word.italic, underline: word.underline, fontFamily: word.fontFamily });
      }
      currentLineChars += wordLen;
    } else {
      const lastRun = currentLine[currentLine.length - 1];
      lastRun.text = lastRun.text.replace(/ +$/, '');
      lines.push(currentLine);
      const trimmedWord = word.text.replace(/^ +/, '');
      currentLine = [{ text: trimmedWord, bold: word.bold, italic: word.italic, underline: word.underline, fontFamily: word.fontFamily }];
      currentLineChars = trimmedWord.length;
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
