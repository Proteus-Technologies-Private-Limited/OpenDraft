/** Layout fragments are not document nodes: undo, collaboration and exports keep the original paragraph. */
import { textLineOffsets } from './wrapText';
import type { FootnotePlan } from './footnotes';
export const SPLIT_PARAGRAPH_TYPES = new Set([
  'action',
  'general',
  'dialogue',
  'lyrics',
  'customElement',
]);
export interface ParagraphLine {
  from: number;
  to: number;
  text: string;
}
export function paragraphLines(text: string, cpl: number): ParagraphLine[] {
  const starts = textLineOffsets(text, cpl);
  return starts.map((from, i) => ({
    from,
    to: starts[i + 1] ?? text.length,
    text: text.slice(from, starts[i + 1] ?? text.length),
  }));
}
/** A bracketed marker occupies layout cells but is not part of the editable paragraph. */
export function originalTextOffset(
  plan: FootnotePlan | null,
  index: number,
  markedOffset: number,
): number {
  if (!plan?.markerCells) return markedOffset;
  let shift = 0;
  for (const ref of plan.refsByNode.get(index) ?? []) {
    const start = ref.charOffset + shift;
    if (markedOffset < start) break;
    if (markedOffset <= start + plan.markerCells) return ref.charOffset;
    shift += plan.markerCells;
  }
  return markedOffset - shift;
}

/** Slice styled runs without losing a mark or cutting a surrogate pair; offsets are from paragraphLines. */
export function sliceParagraphRuns<T extends { text: string; isBreak?: boolean; marker?: string }>(
  runs: T[],
  from: number,
  to: number,
): T[] {
  const out: T[] = [];
  let at = 0;
  for (const run of runs) {
    const end = at + (run.isBreak ? 1 : run.text.length);
    if (!run.isBreak && end > from && at < to) {
      const text = run.text.slice(Math.max(0, from - at), Math.min(run.text.length, to - at));
      out.push({ ...run, text, ...(end > to ? { marker: undefined } : {}) });
    } else if (!run.isBreak && run.marker && end >= from && end <= to && (end > from || from === 0))
      out.push({ ...run, text: '' });
    at = end;
  }
  return out;
}

/** Only oversized paragraphs use fragments. Every group has at least two
 * visual lines, with sentence boundaries preferred over the fallback grid. */
export function paragraphFragments(
  text: string,
  cpl: number,
): (ParagraphLine & { lines: ParagraphLine[] })[] {
  // Bound each reflow to ten original lines. Rewrapping the entire remaining
  // paragraph at every sentence would make long speeches quadratic.
  const original = paragraphLines(text, cpl);
  const fragments: (ParagraphLine & { lines: ParagraphLine[] })[] = [];
  let originalLine = 0;
  let from = 0;
  let followsSentence = false;
  while (from < text.length) {
    while (originalLine + 1 < original.length && original[originalLine + 1].from <= from) {
      originalLine++;
    }
    const windowEnd = original[Math.min(originalLine + 10, original.length - 1)].to;
    const window = text.slice(from, windowEnd);
    const lines = paragraphLines(window, cpl);
    if (windowEnd < text.length && lines.at(-1)?.from === window.length) lines.pop();
    const latest = Math.min(6, lines.length - 2);
    let sentence = -1;
    const limit = lines[latest - 1]?.to ?? 0;
    // A sentence can end inside a printed line. Keep that short line and
    // reflow the following fragment, rather than waiting for punctuation to
    // coincide with a pre-existing line end.
    for (const match of window.matchAll(/[.!?]["'’”)\]]*(?=\s|$)[ \t]*(?:\n)?/g)) {
      const end = match.index + match[0].length;
      if (end > limit) break;
      const before = paragraphLines(window.slice(0, end), cpl);
      if (before.at(-1)?.from === end) before.pop();
      if (before.length >= 2 && paragraphLines(window.slice(end), cpl).length >= 2) {
        sentence = end;
      }
    }
    const previous = fragments.at(-1);
    if (previous && sentence < 0 && lines.length >= 3 && /[.!?]["'’”)\]]*\s*$/.test(lines[0].text)) {
      const line = lines[0];
      previous.lines.push({ from: from + line.from, to: from + line.to, text: line.text });
      previous.to = from + line.to;
      previous.text = text.slice(previous.from, previous.to);
      from = previous.to;
      followsSentence = true;
      continue;
    }
    let count = Math.min(lines.length, followsSentence ? 6 : 2);
    if (lines.length - count === 1) count += count > 2 ? -1 : 1;
    const end = sentence >= 0 ? sentence : lines[count - 1].to;
    const fragmentText = window.slice(0, end);
    const fragmentLines = paragraphLines(fragmentText, cpl);
    if (from + end < text.length && fragmentLines.at(-1)?.from === end) fragmentLines.pop();
    fragments.push({
      from,
      to: from + end,
      text: fragmentText,
      lines: fragmentLines.map((line) => ({
        from: from + line.from,
        to: from + line.to,
        text: line.text,
      })),
    });
    followsSentence = /[.!?]["'’”)\]]*\s*$/.test(fragmentText);
    from += end;
  }
  return fragments;
}
