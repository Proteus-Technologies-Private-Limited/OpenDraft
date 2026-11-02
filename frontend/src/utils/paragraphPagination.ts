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
  const lines = paragraphLines(text, cpl);
  const fragments: (ParagraphLine & { lines: ParagraphLine[] })[] = [];
  const endsSentence = (index: number) => /[.!?]["'’”)\]]*\s*$/.test(lines[index].text);
  for (let from = 0; from < lines.length; ) {
    const latest = Math.min(from + 6, lines.length - 2);
    let sentence = -1;
    // Search back four lines, retaining at least two lines on both sides.
    for (let end = latest; end >= from + 2; end--) {
      if (endsSentence(end - 1)) { sentence = end; break; }
    }
    const previous = fragments.at(-1);
    if (previous && sentence < 0 && lines.length - from >= 3 && endsSentence(from)) {
      // A sentence one line ahead cannot form a fragment on its own. Extend
      // the preceding fragment instead of hiding that valid turn boundary.
      previous.lines.push(lines[from]);
      previous.to = lines[from].to;
      previous.text = text.slice(previous.from, previous.to);
      from++;
      continue;
    }
    // Do not introduce fallback cuts in the four lines immediately after an
    // available sentence ending. Elsewhere keep the compact two-line grid.
    let to = Math.min(lines.length, from + (from > 0 && endsSentence(from - 1) ? 6 : 2));
    if (lines.length - to === 1) to += to - from > 2 ? -1 : 1;
    if (sentence >= 0) to = sentence;
    const first = lines[from].from;
    const end = lines[to - 1].to;
    fragments.push({
      from: first,
      to: end,
      text: text.slice(first, end),
      lines: lines.slice(from, to),
    });
    from = to;
  }
  return fragments;
}
