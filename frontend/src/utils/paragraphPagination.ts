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

/** Only oversized paragraphs use fragments. Two/three-line groups prevent
 * either side of a page turn containing a single orphaned line. */
export function paragraphFragments(
  text: string,
  cpl: number,
): (ParagraphLine & { lines: ParagraphLine[] })[] {
  const lines = paragraphLines(text, cpl);
  const fragments = [];
  for (let from = 0; from < lines.length; ) {
    let to = Math.min(lines.length, from + 2);
    if (lines.length - to === 1) to++;
    // Prefer a nearby sentence ending; a single oversized paragraph may fall
    // back to a visual line boundary when there is no sentence ending here.
    if (
      to + 3 <= lines.length &&
      !/[.!?]["'’”)\]]*\s*$/.test(lines[to - 1].text) &&
      /[.!?]["'’”)\]]*\s*$/.test(lines[to].text)
    )
      to++;
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
