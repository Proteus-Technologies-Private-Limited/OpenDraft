/**
 * Writing an AV body into the DOCX as a real Word table.
 *
 * Word already knows how to do the two things an AV body needs across a page
 * boundary, so this asks it rather than reimplementing them:
 *
 *   - `tableHeader` on the first row makes Word repeat the column headers on
 *     every page the table spills onto — issue #118's repeating headers, done
 *     by the word processor that owns the pagination.
 *   - `cantSplit` on each body row keeps one shot whole. A cue whose video and
 *     audio land on different pages is unreadable on set.
 *
 * That is deliberate and consistent with how the rest of this exporter works:
 * the DOCX carries Word's own pagination, not ours, so a reader who changes the
 * margins or the font still gets a correct document.
 */
import {
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ImageRun,
  VerticalAlign,
} from 'docx';
import type { JSONContent } from '@tiptap/react';
import { jsonBlockRuns } from './nodeText';
import type { AvExportBody } from './avDocument';
import { avRowNodes, avFrameKey, type AvRowNodes } from './avPdfTable';

/** A loaded storyboard frame, keyed by `avFrameKey`. */
export interface AvDocxImage {
  data: Uint8Array;
  width: number;
  height: number;
  /** Image type as the docx library names it. */
  type: 'png' | 'jpg' | 'gif' | 'bmp';
}

/** Turn one AV cell's paragraphs into Word paragraphs, formatting preserved. */
function cellParagraphs(
  cellNode: JSONContent | null | undefined,
  font: string,
  sizeHalfPt: number,
): Paragraph[] {
  const out: Paragraph[] = [];
  const paras = Array.isArray(cellNode?.content) ? cellNode!.content : [];
  for (const para of paras) {
    const runs = jsonBlockRuns(para);
    // An AV shot line reads uppercase in the editor and in the PDF; keep it.
    const upper = para.type === 'avShot';
    const children = runs
      .filter(r => r.text !== '' || r.isBreak)
      .map(r =>
        new TextRun({
          text: upper ? r.text.toUpperCase() : r.text,
          font,
          size: sizeHalfPt,
          bold: r.bold || para.type === 'avShot',
          italics: r.italic || para.type === 'avDirection',
          // On-screen text reads as small caps in the editor; keep it distinct
          // on the page too, or a super is indistinguishable from narration.
          smallCaps: para.type === 'avGraphic',
          underline: r.underline ? {} : undefined,
          break: r.isBreak ? 1 : undefined,
        }),
      );
    out.push(new Paragraph({ children: children.length ? children : [new TextRun({ text: '', font, size: sizeHalfPt })] }));
  }
  if (out.length === 0) out.push(new Paragraph({ children: [new TextRun({ text: '', font, size: sizeHalfPt })] }));
  return out;
}

/** Frame height in points for a column width and aspect ratio. */
function frameSize(widthPt: number, aspect: string | null | undefined): { w: number; h: number } {
  const [aw, ah] = String(aspect || '16:9').split(':');
  const nw = Number(aw);
  const nh = Number(ah);
  const ratio = Number.isFinite(nw) && Number.isFinite(nh) && nw > 0 && nh > 0 ? nh / nw : 0.5625;
  return { w: Math.round(widthPt), h: Math.round(widthPt * ratio) };
}

/** No visible grid: an AV script is read as columns of text, not a spreadsheet.
 *  A single rule under the header is enough to separate labels from content. */
const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const HEADER_RULE = { style: BorderStyle.SINGLE, size: 6, color: '999999' } as const;

const cellBorders = (header: boolean) => ({
  top: NO_BORDER,
  bottom: header ? HEADER_RULE : NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
});

/**
 * Build the Word table for one AV body.
 *
 * `contentWidthTw` is the printable width in twips; column widths are the
 * relative units stored on the block, normalised across the columns that are
 * actually switched on.
 */
export function buildAvTable(
  body: AvExportBody,
  block: JSONContent,
  opts: {
    widths: { cue: number; video: number; audio: number; image: number };
    repeatHeaders: boolean;
    contentWidthTw: number;
    font: string;
    sizeHalfPt: number;
    images?: Map<string, AvDocxImage>;
  },
): Table {
  const keys: ('cue' | 'video' | 'audio' | 'image')[] = [];
  if (body.columns.cue) keys.push('cue');
  keys.push('video', 'audio');
  if (body.columns.image) keys.push('image');

  const total = keys.reduce((s, k) => s + (opts.widths[k] || 1), 0) || 1;
  const widthsTw = keys.map(k => Math.round((opts.contentWidthTw * (opts.widths[k] || 1)) / total));

  const headerLabel: Record<string, string> = {
    cue: body.headers.cue,
    video: body.headers.video,
    audio: body.headers.audio,
    image: body.headers.image,
  };

  const headerRow = new TableRow({
    tableHeader: opts.repeatHeaders,
    cantSplit: true,
    children: keys.map((k, i) => new TableCell({
      width: { size: widthsTw[i], type: WidthType.DXA },
      borders: cellBorders(true),
      children: [new Paragraph({
        children: [new TextRun({ text: headerLabel[k], font: opts.font, size: opts.sizeHalfPt, bold: true })],
      })],
    })),
  });

  const nodes: AvRowNodes[] = avRowNodes(block);

  const bodyRows = body.rows.map((row, index) => {
    const rn = nodes[index] || { video: null, audio: null, image: null };
    const cells = keys.map((k, i) => {
      let children: (Paragraph)[] = [];

      if (k === 'cue') {
        const lines = [row.shot, row.start, row.duration ? `(${row.duration})` : ''].filter(Boolean);
        children = lines.map((text, li) => new Paragraph({
          children: [new TextRun({ text, font: opts.font, size: opts.sizeHalfPt, bold: li === 0 })],
        }));
        if (!children.length) children = [new Paragraph({ children: [new TextRun({ text: '', font: opts.font, size: opts.sizeHalfPt })] })];
      } else if (k === 'video') {
        children = cellParagraphs(rn.video, opts.font, opts.sizeHalfPt);
      } else if (k === 'audio') {
        children = cellParagraphs(rn.audio, opts.font, opts.sizeHalfPt);
      } else {
        // Storyboard frame. An unresolved or deliberately blank frame writes an
        // empty cell rather than failing the export — the slot still exists in
        // the table, which is what a blank frame means.
        const loaded = row.image ? opts.images?.get(avFrameKey(row.image)) : undefined;
        if (loaded) {
          const widthPt = widthsTw[i] / 20; // twips → points
          const { w, h } = frameSize(widthPt, row.image?.aspect);
          try {
            children = [new Paragraph({
              children: [new ImageRun({ type: loaded.type, data: loaded.data, transformation: { width: w, height: h } })],
            })];
          } catch {
            children = [new Paragraph({ children: [new TextRun({ text: '', font: opts.font, size: opts.sizeHalfPt })] })];
          }
        } else {
          const label = row.image ? (row.image.alt || '') : '';
          children = [new Paragraph({
            children: [new TextRun({ text: label, font: opts.font, size: opts.sizeHalfPt, italics: true })],
          })];
        }
      }

      return new TableCell({
        width: { size: widthsTw[i], type: WidthType.DXA },
        borders: cellBorders(false),
        verticalAlign: VerticalAlign.TOP,
        children,
      });
    });

    // cantSplit is the whole point: one shot stays on one page.
    return new TableRow({ cantSplit: true, children: cells });
  });

  return new Table({
    width: { size: opts.contentWidthTw, type: WidthType.DXA },
    columnWidths: widthsTw,
    rows: [headerRow, ...bodyRows],
  });
}

/** The total-runtime line written under an AV table, or null when untimed. */
export function buildAvTotalParagraph(
  body: AvExportBody,
  font: string,
  sizeHalfPt: number,
): Paragraph | null {
  if (body.totalSeconds <= 0) return null;
  return new Paragraph({
    children: [new TextRun({ text: `Total runtime: ${body.totalFormatted}`, font, size: sizeHalfPt, bold: true })],
  });
}
