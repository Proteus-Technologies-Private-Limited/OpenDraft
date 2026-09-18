/**
 * Drawing an AV body into the PDF.
 *
 * The screenplay exporter draws a single column of blocks down the page; an AV
 * body is a table, so it needs its own pass: column x-positions from the body's
 * width config, a header row repeated on every page it spills onto, and page
 * breaks taken between rows rather than through them.
 *
 * Row-level pagination is the rule here, matching what the editor and print CSS
 * do (`break-inside: avoid` on `.av-row`). A shot split across a page boundary
 * is unreadable on set — the video and the audio for one cue have to stay side
 * by side — so a row that will not fit moves whole to the next page. The one
 * exception is a row taller than a whole page, which cannot move anywhere and
 * is therefore allowed to split rather than loop forever.
 *
 * Text is wrapped with `wordWrapRuns`, the same character-cell wrapper the
 * screenplay body and the on-screen paginator use, so an AV cell breaks lines
 * where the editor says it does.
 */
import type { jsPDF } from 'jspdf';
import type { JSONContent } from '@tiptap/react';
import { wordWrapRuns, type WrapRun } from './wrapText';
import { jsonBlockRuns } from './nodeText';
import type { AvExportBody, AvExportRow } from './avDocument';
import { avParaStyle } from './avDocument';

/** Vertical padding inside a cell, in points. */
const CELL_PAD_PT = 3;
/** Gap between columns, in points. */
const COL_GAP_PT = 8;
/** Rule weight under the header row. */
const RULE_WEIGHT = 0.6;

/** A styled line ready to draw: the runs plus the face flags they carry. */
export type AvLine = WrapRun[];

/** One resolved column: where it starts, how wide, and what it holds. */
export interface AvPdfColumn {
  key: 'cue' | 'video' | 'audio' | 'image';
  xPt: number;
  widthPt: number;
  header: string;
}

/**
 * Resolve column geometry for a body.
 *
 * Widths are the relative units stored on the block; they are normalised across
 * whichever columns are switched on, so turning the storyboard column off
 * widens the remaining ones instead of leaving a gap.
 */
export function layoutAvColumns(
  body: AvExportBody,
  widths: { cue: number; video: number; audio: number; image: number },
  leftPt: number,
  contentWidthPt: number,
): AvPdfColumn[] {
  const keys: AvPdfColumn['key'][] = [];
  if (body.columns.cue) keys.push('cue');
  keys.push('video', 'audio');
  if (body.columns.image) keys.push('image');

  const total = keys.reduce((sum, k) => sum + (widths[k] || 1), 0) || 1;
  const gaps = COL_GAP_PT * Math.max(0, keys.length - 1);
  const usable = Math.max(contentWidthPt - gaps, 1);

  const headers: Record<AvPdfColumn['key'], string> = {
    cue: body.headers.cue,
    video: body.headers.video,
    audio: body.headers.audio,
    image: body.headers.image,
  };

  const out: AvPdfColumn[] = [];
  let x = leftPt;
  for (const key of keys) {
    const widthPt = (usable * (widths[key] || 1)) / total;
    out.push({ key, xPt: x, widthPt, header: headers[key] });
    x += widthPt + COL_GAP_PT;
  }
  return out;
}

/** Characters that fit in a column, for the monospace wrap cell. */
function charsPerColumn(widthPt: number, charWidthPt: number): number {
  if (!Number.isFinite(charWidthPt) || charWidthPt <= 0) return 40;
  return Math.max(4, Math.floor(widthPt / charWidthPt));
}

/** Split a cell's text into wrapped, styled lines. Paragraph breaks preserved. */
export function wrapCell(
  cellNode: JSONContent | null | undefined,
  maxChars: number,
): AvLine[] {
  if (!cellNode || !Array.isArray(cellNode.content)) return [];
  const lines: AvLine[] = [];
  for (const para of cellNode.content) {
    const runs = jsonBlockRuns(para) as WrapRun[];
    // Face flags come from the shared style map, so the PDF and the DOCX agree
    // about every element a cell can hold — including the screenplay elements a
    // template admits to a column. Bold and italic ride on the runs themselves.
    const style = avParaStyle(para.type);
    const styled = (style.bold || style.italic)
      ? runs.map(r => ({ ...r, bold: r.bold || style.bold, italic: r.italic || style.italic }))
      : runs;
    const wrapped = wordWrapRuns(styled, maxChars, style.upper);
    if (wrapped.length === 0) lines.push([]);
    else lines.push(...wrapped);
  }
  // Trailing blank paragraphs just pad the row.
  while (lines.length && lines[lines.length - 1].every(r => !r.text)) lines.pop();
  return lines;
}

/** Plain text of a wrapped line, for measuring. */
function lineText(line: AvLine): string {
  return line.map(r => r.text || '').join('');
}

/** Everything the caller must supply for the table to draw itself. */
export interface AvPdfContext {
  pdf: jsPDF;
  /** Draw one wrapped line at (x, y). Supplied by the exporter so AV text uses
   *  the same font selection and character spacing as the rest of the script. */
  drawLine: (line: AvLine, xPt: number, yPt: number) => void;
  /** Width of one character cell, in points. */
  charWidthPt: number;
  /** Height of one line, in points. */
  lineHeightPt: number;
  leftPt: number;
  contentWidthPt: number;
  topMarginPt: number;
  bottomMarginPt: number;
  pageHeightPt: number;
  getY: () => number;
  setY: (y: number) => void;
  newPage: () => void;
  /** Preloaded storyboard frames, keyed by the image node's resolved URL. */
  images?: Map<string, { dataUrl: string; width: number; height: number }>;
}

/** The raw cell nodes for one row, matched to the resolved export row. */
export interface AvRowNodes {
  video: JSONContent | null;
  audio: JSONContent | null;
  image: JSONContent | null;
}

/**
 * Stable lookup key for a storyboard frame.
 *
 * A frame may be stored as an asset id with no src, or as a bare src, so both
 * the preload pass and the draw pass have to agree on one key or every frame
 * silently renders as an empty slot.
 */
export function avFrameKey(
  image: { src?: string | null; assetId?: string | null; scratchId?: string | null } | null | undefined,
): string {
  if (!image) return '';
  return image.assetId || image.scratchId || image.src || '';
}

/** Height a storyboard frame occupies in its column. */
function frameHeightPt(widthPt: number, aspect: string | null | undefined): number {
  const [w, h] = String(aspect || '16:9').split(':');
  const nw = Number(w);
  const nh = Number(h);
  if (!Number.isFinite(nw) || !Number.isFinite(nh) || nw <= 0 || nh <= 0) return widthPt * 0.5625;
  return widthPt * (nh / nw);
}

/**
 * Draw the header row at the current Y and advance past it.
 *
 * Each label is wrapped into its own column, the same way the cells beneath it
 * are. Drawn as one unwrapped line it simply overflowed: the default cue column
 * is 0.5 units against video and audio's 2, which is narrower than the word
 * "Shot / Time" it carries, so the cue header printed straight over the video
 * header and the two came out as one unreadable smear of overlapping glyphs.
 *
 * Labels sit on the rule rather than hanging from the top, so a two-line header
 * beside one-line headers still lines up where the eye expects the column to
 * begin.
 */
function drawHeader(ctx: AvPdfContext, columns: AvPdfColumn[]): void {
  const y = ctx.getY();

  const wrapped = columns.map(col =>
    wordWrapRuns(
      [{ text: col.header, bold: true } as WrapRun],
      charsPerColumn(col.widthPt, ctx.charWidthPt),
      false,
    ),
  );
  const lineCount = Math.max(1, ...wrapped.map(w => w.length));

  wrapped.forEach((lines, i) => {
    // Bottom-aligned: shorter labels start further down so every one of them
    // ends on the last line.
    let lineY = y + (lineCount - lines.length) * ctx.lineHeightPt;
    for (const line of lines) {
      lineY += ctx.lineHeightPt;
      ctx.drawLine(line, columns[i].xPt, lineY);
    }
  });

  const ruleY = y + lineCount * ctx.lineHeightPt + 3;
  ctx.pdf.setLineWidth(RULE_WEIGHT);
  ctx.pdf.line(ctx.leftPt, ruleY, ctx.leftPt + ctx.contentWidthPt, ruleY);
  ctx.setY(ruleY + CELL_PAD_PT);
}

/**
 * Draw one AV body, paginating between rows.
 *
 * `repeatHeaders` controls whether the header row is redrawn after a page
 * break; an AV script read on set is scrolled through page by page, and losing
 * the column labels halfway is the same problem a frozen header row solves in
 * the spreadsheet export.
 */
export function drawAvBody(
  ctx: AvPdfContext,
  body: AvExportBody,
  rowNodes: AvRowNodes[],
  opts: {
    widths: { cue: number; video: number; audio: number; image: number };
    repeatHeaders: boolean;
    showTotal?: boolean;
  },
): void {
  const columns = layoutAvColumns(body, opts.widths, ctx.leftPt, ctx.contentWidthPt);
  if (!columns.length) return;

  const bottomLimit = ctx.pageHeightPt - ctx.bottomMarginPt;

  drawHeader(ctx, columns);

  body.rows.forEach((row: AvExportRow, index) => {
    const nodes = rowNodes[index] || { video: null, audio: null, image: null };

    // Wrap every column first so the row's height is known before deciding
    // whether it fits — that decision is what keeps a shot whole.
    const cellLines = new Map<AvPdfColumn['key'], AvLine[]>();
    let imageHeight = 0;

    for (const col of columns) {
      const chars = charsPerColumn(col.widthPt, ctx.charWidthPt);
      if (col.key === 'cue') {
        const parts: AvLine[] = [[{ text: row.shot, bold: true } as WrapRun]];
        if (row.start) parts.push([{ text: row.start } as WrapRun]);
        if (row.duration) parts.push([{ text: `(${row.duration})` } as WrapRun]);
        cellLines.set('cue', parts);
      } else if (col.key === 'video') {
        cellLines.set('video', wrapCell(nodes.video, chars));
      } else if (col.key === 'audio') {
        cellLines.set('audio', wrapCell(nodes.audio, chars));
      } else if (col.key === 'image') {
        cellLines.set('image', []);
        if (row.image) imageHeight = frameHeightPt(col.widthPt, row.image.aspect);
      }
    }

    const textHeight = Math.max(
      ...columns.map(c => (cellLines.get(c.key)?.length || 0) * ctx.lineHeightPt),
      0,
    );
    const rowHeight = Math.max(textHeight, imageHeight) + CELL_PAD_PT * 2;

    // Page break between rows. A row taller than a whole page cannot be moved
    // anywhere, so it is drawn where it stands rather than looping.
    const fitsOnAPage = rowHeight <= bottomLimit - ctx.topMarginPt;
    if (ctx.getY() + rowHeight > bottomLimit && fitsOnAPage) {
      ctx.newPage();
      if (opts.repeatHeaders) drawHeader(ctx, columns);
    }

    const rowTop = ctx.getY();
    for (const col of columns) {
      const lines = cellLines.get(col.key) || [];
      let y = rowTop;
      for (const line of lines) {
        y += ctx.lineHeightPt;
        if (lineText(line).length === 0) continue;
        ctx.drawLine(line, col.xPt, y);
      }
      if (col.key === 'image' && row.image) {
        const loaded = ctx.images?.get(avFrameKey(row.image));
        const hPt = frameHeightPt(col.widthPt, row.image.aspect);
        if (loaded) {
          try {
            ctx.pdf.addImage(loaded.dataUrl, col.xPt, rowTop + CELL_PAD_PT, col.widthPt, hPt);
          } catch {
            // A frame that will not decode must not take the export down; the
            // outline below still shows where it belongs.
            ctx.pdf.setLineWidth(0.4);
            ctx.pdf.rect(col.xPt, rowTop + CELL_PAD_PT, col.widthPt, hPt);
          }
        } else {
          // Empty or unresolved frame — draw the slot, which is meaningful in
          // an AV document: it is where art is still to come.
          ctx.pdf.setLineWidth(0.4);
          ctx.pdf.rect(col.xPt, rowTop + CELL_PAD_PT, col.widthPt, hPt);
        }
      }
    }

    ctx.setY(rowTop + rowHeight);
  });

  if (opts.showTotal !== false && body.totalSeconds > 0) {
    const y = ctx.getY() + ctx.lineHeightPt;
    ctx.drawLine(
      [{ text: `Total runtime: ${body.totalFormatted}`, bold: true } as WrapRun],
      ctx.leftPt,
      y,
    );
    ctx.setY(y + CELL_PAD_PT);
  }
}

/** Collect the cell nodes for each row of an `avBlock`, matched to its rows. */
export function avRowNodes(block: JSONContent): AvRowNodes[] {
  const rows = Array.isArray(block?.content) ? block.content.filter(n => n?.type === 'avRow') : [];
  return rows.map(row => {
    const cells = Array.isArray(row.content) ? row.content : [];
    return {
      video: cells.find(c => c?.type === 'avCell' && (c.attrs as { side?: string })?.side !== 'audio') || null,
      audio: cells.find(c => c?.type === 'avCell' && (c.attrs as { side?: string })?.side === 'audio') || null,
      image: cells.find(c => c?.type === 'avImage') || null,
    };
  });
}
