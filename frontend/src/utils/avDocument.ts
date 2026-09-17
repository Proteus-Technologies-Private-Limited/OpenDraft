/**
 * Reading an AV body out of a document, for export.
 *
 * Every AV exporter — XLSX, CSV, PDF, DOCX — needs the same thing: the columns
 * that are switched on, their headers, and one flat record per row with the cue
 * values resolved. Doing that once here is what keeps the spreadsheet and the
 * PDF from disagreeing about what row 7 says.
 *
 * Why a spreadsheet is the primary interchange format at all: the industry has
 * no structured AV/shot-list format. Screenplay formats (FDX, Fountain, OSF) are
 * built around screenplay elements and cannot represent arbitrary row-and-column
 * AV documents; what production tooling actually exchanges is XLSX and CSV —
 * Movie Magic Scheduling and StudioBinder both import CSV, and shot-list tools
 * export xlsx. So that is what this feeds.
 *
 * Kept free of framework and Tauri imports so it unit-tests in the node
 * environment, matching the convention in `nodeText.ts` and `docText.ts`.
 */
import type { JSONContent } from '@tiptap/react';
import { jsonBlockText } from './nodeText';
import { computeRowTimings, totalRuntimeSeconds, formatTimecode } from '../editor/avTiming';

/** Which columns an AV body shows, mirrored from the schema's stored attrs. */
export interface AvExportColumns {
  cue: boolean;
  image: boolean;
}

/** Header labels for the columns, with the defaults the UI shows. */
export interface AvExportHeaders {
  cue: string;
  video: string;
  audio: string;
  image: string;
}

export const AV_DEFAULT_HEADERS: AvExportHeaders = {
  cue: 'Shot / Time',
  video: 'Video',
  audio: 'Audio',
  image: 'Storyboard',
};

/** One AV row, flattened for export. */
export interface AvExportRow {
  /** Sequential or manually overridden shot number, as displayed. */
  shot: string;
  /** Running start timestamp, as displayed. */
  start: string;
  /** This row's duration, as displayed (empty when unset). */
  duration: string;
  /** Duration in whole seconds — for a spreadsheet that wants a number. */
  durationSeconds: number;
  /** Video cell text; paragraphs joined by newlines. */
  video: string;
  /** Audio cell text; paragraphs joined by newlines. */
  audio: string;
  /**
   * Storyboard frame reference, or null when the row has none.
   *
   * The whole reference, not just the asset id: `avFrameKey` keys the exporters'
   * preloaded frames off it, and it has to agree with the key built from the raw
   * node attrs during the preload pass or every frame draws as an empty slot.
   */
  image: {
    src: string | null;
    alt: string | null;
    assetId: string | null;
    projectId: string | null;
    scratchId: string | null;
    filename: string | null;
    aspect: string;
  } | null;
}

/** One AV body in a document, ready to write out. */
export interface AvExportBody {
  columns: AvExportColumns;
  headers: AvExportHeaders;
  rows: AvExportRow[];
  /** Total runtime in seconds — the sum of the row durations. */
  totalSeconds: number;
  /** Total runtime formatted, for a footer or a summary cell. */
  totalFormatted: string;
}

/** Text of one AV cell: its paragraphs joined by newlines, hard breaks intact. */
function cellText(cell: JSONContent | undefined): string {
  if (!cell || !Array.isArray(cell.content)) return '';
  const parts: string[] = [];
  for (const para of cell.content) {
    // jsonBlockText handles hardBreak; anything without inline content is ''.
    parts.push(jsonBlockText(para));
  }
  // Trailing blank paragraphs are noise in a spreadsheet cell.
  while (parts.length && parts[parts.length - 1].trim() === '') parts.pop();
  return parts.join('\n');
}

/** Read a body's column config defensively — older documents have no attrs. */
function readColumns(attrs: unknown): AvExportColumns {
  const a = (attrs || {}) as { columns?: { cue?: unknown; image?: unknown } };
  const c = a.columns || {};
  return {
    cue: typeof c.cue === 'boolean' ? c.cue : true,
    image: typeof c.image === 'boolean' ? c.image : false,
  };
}

function readHeaders(attrs: unknown): AvExportHeaders {
  const a = (attrs || {}) as { headers?: Partial<AvExportHeaders> };
  const h = a.headers || {};
  const pick = (v: unknown, fallback: string) =>
    typeof v === 'string' && v.trim() !== '' ? v.trim() : fallback;
  return {
    cue: pick(h.cue, AV_DEFAULT_HEADERS.cue),
    video: pick(h.video, AV_DEFAULT_HEADERS.video),
    audio: pick(h.audio, AV_DEFAULT_HEADERS.audio),
    image: pick(h.image, AV_DEFAULT_HEADERS.image),
  };
}

/** The full asset reference an `avImage` node carries, with every field
 *  defaulted so callers never have to test for `undefined`. */
function readFrameAttrs(node: JSONContent): NonNullable<AvExportRow['image']> {
  const a = (node.attrs || {}) as {
    src?: string | null;
    alt?: string | null;
    assetId?: string | null;
    projectId?: string | null;
    scratchId?: string | null;
    filename?: string | null;
    aspect?: string;
  };
  return {
    src: a.src ?? null,
    alt: a.alt ?? null,
    assetId: a.assetId ?? null,
    projectId: a.projectId ?? null,
    scratchId: a.scratchId ?? null,
    filename: a.filename ?? null,
    aspect: a.aspect || '16:9',
  };
}

/** Turn one `avBlock` JSON node into an export-ready body. */
export function readAvBlock(block: JSONContent): AvExportBody {
  const columns = readColumns(block?.attrs);
  const headers = readHeaders(block?.attrs);
  const rowNodes = Array.isArray(block?.content)
    ? block.content.filter(n => n && n.type === 'avRow')
    : [];

  // Resolve the cue column exactly as the editor does, so a spreadsheet and the
  // on-screen document agree on shot numbers and start times.
  const timings = computeRowTimings(
    rowNodes.map(r => ({
      duration: (r.attrs as { duration?: string | null } | undefined)?.duration ?? null,
      shot: (r.attrs as { shot?: string | null } | undefined)?.shot ?? null,
      start: (r.attrs as { start?: string | null } | undefined)?.start ?? null,
    })),
  );

  const rows: AvExportRow[] = rowNodes.map((row, i) => {
    const cells = Array.isArray(row.content) ? row.content : [];
    const video = cells.find(c => c?.type === 'avCell' && (c.attrs as { side?: string })?.side !== 'audio');
    const audio = cells.find(c => c?.type === 'avCell' && (c.attrs as { side?: string })?.side === 'audio');
    const imageNode = cells.find(c => c?.type === 'avImage');
    const t = timings[i];

    return {
      shot: t?.shot ?? `${i + 1}.`,
      start: t?.start ?? '',
      duration: t?.duration ?? '',
      durationSeconds: t?.durationSeconds ?? 0,
      video: cellText(video),
      audio: cellText(audio),
      image: imageNode ? readFrameAttrs(imageNode) : null,
    };
  });

  const totalSeconds = totalRuntimeSeconds(
    rowNodes.map(r => ({ duration: (r.attrs as { duration?: string | null } | undefined)?.duration ?? null })),
  );

  return {
    columns,
    headers,
    rows,
    totalSeconds,
    totalFormatted: formatTimecode(totalSeconds),
  };
}

/**
 * Every AV body in a document, in order.
 *
 * A document can hold more than one `avBlock` (an intro paragraph between two
 * AV sections is legal), so exporters get a list rather than one body.
 */
export function extractAvBodies(doc: JSONContent | null | undefined): AvExportBody[] {
  const out: AvExportBody[] = [];
  if (!doc) return out;

  const walk = (node: JSONContent | null | undefined) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'avBlock') {
      try {
        out.push(readAvBlock(node));
      } catch (err) {
        // One malformed body must not take the whole export down.
        console.warn('[av] could not read an AV body for export', err);
      }
      return; // AV bodies do not nest
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };

  walk(doc);
  return out;
}

/** True when a document contains any AV body — the gate for offering the
 *  AV-specific export formats in the menu. */
export function hasAvContent(doc: JSONContent | null | undefined): boolean {
  return extractAvBodies(doc).length > 0;
}

/**
 * A body as a rectangular grid: one header row, then one row per cue.
 *
 * Shared by the XLSX and CSV writers, and by the PDF and DOCX table builders,
 * so all four emit the same columns in the same order.
 */
export function avBodyToGrid(body: AvExportBody, opts?: { includeImage?: boolean }): string[][] {
  const includeImage = opts?.includeImage !== false && body.columns.image;
  const header: string[] = [];
  if (body.columns.cue) header.push(body.headers.cue, 'Duration');
  header.push(body.headers.video, body.headers.audio);
  if (includeImage) header.push(body.headers.image);

  const rows = body.rows.map(r => {
    const cells: string[] = [];
    if (body.columns.cue) {
      // Shot number and start read as one cell, matching the on-screen gutter.
      cells.push(r.start ? `${r.shot} ${r.start}` : r.shot, r.duration);
    }
    cells.push(r.video, r.audio);
    if (includeImage) {
      // A spreadsheet cannot hold the frame itself; name it so the row still
      // says which storyboard it refers to.
      cells.push(r.image ? (r.image.alt || r.image.filename || r.image.assetId || r.image.scratchId || r.image.src || 'frame') : '');
    }
    return cells;
  });

  return [header, ...rows];
}
