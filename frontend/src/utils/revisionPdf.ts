/**
 * Where a PDF puts Revision Mode's margin asterisks.
 *
 * Final Draft prints a `*` in the right margin of each line holding revised
 * text. The right-hand scene number is right-aligned to 7.75in, so the
 * asterisk goes just past it — and never closer than 0.4in to the paper's
 * edge, for A4 and other narrow sizes.
 */
import type { WrapRun } from './wrapText';
import { latestRevision } from '../editor/revisionColors';

const PTS_PER_INCH = 72;

export function revisionMarkXPt(pageWidthPt: number): number {
  return Math.min(7.85 * PTS_PER_INCH, pageWidthPt - 0.4 * PTS_PER_INCH);
}

export function lineHasRevision(line: WrapRun[]): boolean {
  return line.some((run) => run.revised === true);
}

/**
 * The revision a line is marked for — the latest round among its runs — or
 * null for an unrevised line. A run flagged revised without a colour (built by
 * hand, or by an older caller) still marks the line: '' is returned.
 */
export function lineRevision(line: WrapRun[]): string | null {
  if (!lineHasRevision(line)) return null;
  return latestRevision(line.map((r) => (r.revised ? r.revision : null))) ?? '';
}

/** The indices of the wrapped lines that get an asterisk. */
export function revisedLineIndices(lines: WrapRun[][]): number[] {
  return lines.flatMap((line, i) => (lineHasRevision(line) ? [i] : []));
}
