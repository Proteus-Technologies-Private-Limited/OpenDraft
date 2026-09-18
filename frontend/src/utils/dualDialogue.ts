/**
 * Dual dialogue — two speeches side by side — measured once for everything
 * that lays a page out.
 *
 * The editor draws the block as a flex row of two equal columns (see
 * `.dual-dialogue` in styles/screenplay.css) and the PDF has to put the same
 * words in the same places. Neither the paginator nor the exporter knew the
 * type at all: pagination measured `node.textContent`, which is both columns
 * run together as one 62-character paragraph, and the exporter asked
 * `jsonBlockRuns` for the text of a node whose children are columns, got
 * nothing back, and drew an empty line — so a dual exchange was missing from
 * every exported PDF.
 *
 * The geometry here is the stylesheet's, in inches, so the two cannot drift:
 * the block spans the same band as Action, each column takes half of it, and
 * the paddings are the ones the CSS gives each element inside a column.
 *
 * Deliberately dependency-free apart from the shared line counter, so it is
 * testable in the node environment.
 */

import { getTextLines } from './wrapText';

/** One element inside a column. */
export interface DualChild {
  /** `character`, `dialogue` or `parenthetical`. */
  type: string;
  text: string;
}

/** The two columns, in document order. */
export type DualColumns = DualChild[][];

/** Final Draft Courier, as everywhere else in the layout code. */
const FD_CPI = 10.33;

/** The band a dual block occupies — Action's span, which is the text column. */
export const DUAL_BAND: readonly [number, number] = [1.50, 7.50];

/** Half the band, per column. */
export const DUAL_COLUMN_WIDTH_IN = (DUAL_BAND[1] - DUAL_BAND[0]) / 2;

/**
 * Padding inside a column, in inches: `[left, right]`.
 *
 * These are the `.dual-dialogue .screenplay-element.*` rules. A character cue
 * is indented rather than centred, exactly as the editor draws it.
 */
export const DUAL_PADDING: Record<string, readonly [number, number]> = {
  character: [0.8, 0],
  dialogue: [0.3, 0.1],
  parenthetical: [0.5, 0.1],
};

const DEFAULT_PADDING: readonly [number, number] = [0.3, 0.1];

/** Where an element inside column `col` starts and ends, in inches. */
export function dualChildBounds(col: number, type: string): [number, number] {
  const [padLeft, padRight] = DUAL_PADDING[type] ?? DEFAULT_PADDING;
  const colLeft = DUAL_BAND[0] + col * DUAL_COLUMN_WIDTH_IN;
  return [colLeft + padLeft, colLeft + DUAL_COLUMN_WIDTH_IN - padRight];
}

/** How many characters fit on one line of an element inside a column. */
export function dualCharsPerLine(type: string): number {
  const [left, right] = dualChildBounds(0, type);
  return Math.max(1, Math.round((right - left) * FD_CPI));
}

/**
 * The blank line above a column's first cue.
 *
 * `.dual-dialogue-column > .screenplay-element.character:first-child` gives it
 * a 12pt margin, and every other element inside the block has none — so a
 * column is one line of air and then its speech.
 */
export function dualColumnLeadLines(children: DualChild[]): number {
  return children[0]?.type === 'character' ? 1 : 0;
}

/** Lines one column occupies, its leading blank included. */
export function dualColumnLineCount(children: DualChild[]): number {
  let lines = dualColumnLeadLines(children);
  for (const child of children) lines += getTextLines(child.text, dualCharsPerLine(child.type));
  return lines;
}

/**
 * Lines the whole block occupies.
 *
 * The taller column decides: they are drawn side by side, so the block is as
 * deep as the deeper of the two and never the sum.
 */
export function dualDialogueLineCount(columns: DualColumns): number {
  let lines = 0;
  for (const column of columns) lines = Math.max(lines, dualColumnLineCount(column));
  return Math.max(1, lines);
}

/** The columns of a dual block, from anything shaped like the node tree. */
export function dualColumnsOf(
  node: { content?: { content?: { type?: string; text?: string }[] }[] } | null | undefined,
  textOf: (child: unknown) => string,
): DualColumns {
  return (node?.content ?? []).map((column) =>
    (column?.content ?? []).map((child) => ({
      type: String((child as { type?: string })?.type ?? 'dialogue'),
      text: textOf(child),
    })),
  );
}
