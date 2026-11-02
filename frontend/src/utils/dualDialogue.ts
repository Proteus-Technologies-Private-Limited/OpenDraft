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

import { getTextLines, type WrapRun } from './wrapText';

/** Layout-only Word paragraph separating adjacent tables; never screenplay text. */
export const DOCX_DUAL_SEPARATOR_STYLE = 'OpenDraftDualDialogueSeparator';

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

/** A visual row retains UTF-16 offsets into the unmodified source paragraph. */
export interface DualCell {
  column: number;
  child: number;
  type: string;
  from: number;
  to: number;
  /** Offsets in the PDF run stream, including bracketed references. */
  drawFrom: number;
  drawTo: number;
  sourceFrom: number;
  sourceTo: number;
  text: string;
}
export type DualRow = DualCell[];

/** Only oversized blocks need this more detailed version of the line counter. */
export function dualRows(
  columns: DualColumns,
  refs: readonly { charOffset: number }[] = [],
  markerCells = 0,
): DualRow[] {
  const rows: DualRow[] = [];
  let source = 0;
  columns.forEach((children, column) => {
    let row = dualColumnLeadLines(children);
    children.forEach((child, index) => {
      // Record an inverse offset map while inserting bracketed references.
      // Decorations still address original text; PDF slices address marked runs.
      const local = markerCells
        ? refs.filter(
            (ref) => ref.charOffset > source && ref.charOffset <= source + child.text.length,
          )
        : [];
      let measured = '';
      const original: number[] = [0];
      for (let i = 0; i < child.text.length; i++) {
        measured += child.text[i];
        original.push(i + 1);
        for (const ref of local)
          if (ref.charOffset === source + i + 1) {
            measured += '•'.repeat(markerCells);
            for (let j = 0; j < markerCells; j++) original.push(i + 1);
          }
      }
      const starts: number[] = [];
      getTextLines(measured, dualCharsPerLine(child.type), (at) => starts.push(at));
      starts.forEach((drawFrom, line) => {
        const drawTo = starts[line + 1] ?? measured.length;
        const from = original[drawFrom];
        const to = original[drawTo];
        (rows[row++] ??= []).push({
          column,
          child: index,
          type: child.type,
          from,
          to,
          drawFrom,
          drawTo,
          sourceFrom: source + from,
          sourceTo: source + to,
          text: child.text.slice(from, to),
        });
      });
      source += child.text.length;
    });
  });
  return Array.from({ length: rows.length }, (_, i) => rows[i] ?? []);
}

/** Speakers whose existing speech actually continues across this boundary. */
export function dualContinuations(
  columns: DualColumns,
  rows: DualRow[],
  at: number,
): Map<number, string> {
  const speakers = new Map<number, string>();
  for (const cell of rows[at] ?? []) {
    if (cell.type === 'character') continue;
    const children = columns[cell.column];
    for (let i = cell.child; i >= 0; i--) {
      if (children[i].type !== 'character') continue;
      speakers.set(cell.column, children[i].text.replace(/\s+/g, ' ').trim().toUpperCase());
      break;
    }
  }
  return speakers;
}

/** Pick a shared column boundary, keeping cues and parentheticals with speech. */
export function fitDualRows(
  columns: DualColumns,
  rows: DualRow[],
  from: number,
  room: number,
  labels: boolean,
  capacity: (to: number) => number = () => room,
): number {
  let to = Math.min(rows.length, from + Math.max(0, Math.floor(room)));
  for (; to > from; to--) {
    const more =
      to < rows.length && labels && dualContinuations(columns, rows, to).size > 0 ? 1 : 0;
    if (to - from + more > Math.min(room, capacity(to))) continue;
    if (to === rows.length) return to;
    if (to - from < (from === 0 ? 4 : 2) || rows.length - to < 2) continue;
    const unsafe = (rows[to - 1] ?? []).some(
      (cell) => cell.type === 'character' || cell.type === 'parenthetical',
    );
    if (unsafe) continue;
    // An unfinished column needs two spoken lines on either side. Completed
    // columns and new cues on the next sheet do not need continuation room.
    const orphan = [...dualContinuations(columns, rows, to).keys()].some((col) => {
      let before = 0;
      for (let r = to - 1; r >= from; r--) {
        const cell = rows[r].find((c) => c.column === col);
        if (cell?.type === 'character') break;
        if (cell?.type === 'dialogue') before++;
      }
      let after = 0;
      for (let r = to; r < rows.length && after < 2; r++) {
        const cell = rows[r].find((c) => c.column === col);
        if (!cell || cell.type === 'character') break;
        if (cell.type === 'dialogue') after++;
      }
      return before < 2 || after < 2;
    });
    if (!orphan) return to;
  }
  return from;
}

/** Styled source slice for a planned row; visual wrapping must not wrap it again. */
export function dualRowRuns(runs: WrapRun[], from: number, to: number): WrapRun[] {
  let offset = 0;
  const out: WrapRun[] = [];
  for (const run of runs) {
    const end = offset + (run.isBreak ? 1 : run.text.length);
    if (!run.isBreak && end > from && offset < to) {
      out.push({
        ...run,
        text: run.text.slice(Math.max(0, from - offset), to - offset),
        marker: end <= to ? run.marker : undefined,
      });
    }
    offset = end;
  }
  return out;
}

/** Position of a cell inside a ProseMirror dual block, without importing the editor. */
export function dualCellPosition(
  node: { child(index: number): { nodeSize: number; child(index: number): { nodeSize: number } } },
  offset: number,
  cell: DualCell,
): number {
  let pos = offset + 3;
  for (let i = 0; i < cell.column; i++) pos += node.child(i).nodeSize;
  for (let i = 0; i < cell.child; i++) pos += node.child(cell.column).child(i).nodeSize;
  return pos + cell.from;
}

/** A reference belongs to the row ending its annotated phrase, not the next row. */
export function dualRefsInRows<T extends { charOffset: number }>(
  refs: readonly T[],
  rows: DualRow[],
  from: number,
  to: number,
): T[] {
  return refs.filter((ref) =>
    rows
      .slice(from, to)
      .some((row) =>
        row.some((cell) => ref.charOffset > cell.sourceFrom && ref.charOffset <= cell.sourceTo),
      ),
  );
}
