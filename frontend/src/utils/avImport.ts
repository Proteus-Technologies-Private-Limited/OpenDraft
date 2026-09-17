/**
 * Importing an AV document from a spreadsheet.
 *
 * The counterpart to `avSpreadsheet.ts`. Since the industry exchanges AV and
 * shot-list data as CSV and xlsx rather than through any structured standard,
 * those are what can usefully be read back in — from OpenDraft's own export, or
 * from a sheet someone else built.
 *
 * Which is why the column mapping is fuzzy. A sheet from another production
 * will not have OpenDraft's header names: its video column may be called
 * "Visual", "Picture" or "VIDEO / ACTION", and its audio one "Sound", "VO" or
 * "Narration". Requiring an exact match would reject nearly every real file, so
 * headers are matched on normalised keywords and the caller can override the
 * result before committing.
 *
 * Nothing here throws on odd input: an unreadable row is skipped, an unmatched
 * column is reported as unmapped, and the caller decides what to do.
 */
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { parseTimecode, formatTimecode, MAX_TIMECODE_SECONDS } from '../editor/avTiming';

// ── CSV ────────────────────────────────────────────────────────────────────

/**
 * Parse CSV into a grid, per RFC 4180.
 *
 * Hand-rolled rather than regex-based because AV cells routinely contain
 * newlines inside quotes — a line of narration wrapped over two lines is one
 * cell, and splitting on "\n" first would tear it in half.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  if (typeof text !== 'string' || text === '') return rows;

  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { endField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }

  // A file that does not end in a newline still has a final row.
  if (field !== '' || row.length > 0) endRow();

  // Drop wholly empty trailing rows, which a trailing newline always produces.
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === '')) rows.pop();
  return rows;
}

// ── XLSX ───────────────────────────────────────────────────────────────────

/** Strip XML tags and decode the handful of entities a sheet can carry. */
function xmlText(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    // Ampersand last, or "&amp;lt;" would decode twice.
    .replace(/&amp;/g, '&');
}

/** Spreadsheet column name to a 0-based index: A→0, AA→26. */
export function columnIndex(ref: string): number {
  const letters = String(ref || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  if (!letters) return 0;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

/** Turn one worksheet's XML into a rectangular grid. */
function sheetToGrid(sheetXml: string, shared: readonly string[]): string[][] {
  const grid: string[][] = [];
  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g)) {
      const attrs = cellMatch[1] ?? cellMatch[3] ?? '';
      const inner = cellMatch[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] || '';
      const type = /t="([^"]+)"/.exec(attrs)?.[1] || '';
      const at = ref ? columnIndex(ref) : cells.length;

      let value = '';
      if (type === 's') {
        const idx = Number(xmlText(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] || ''));
        value = Number.isFinite(idx) ? (shared[idx] ?? '') : '';
      } else if (type === 'inlineStr') {
        const parts = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => xmlText(x[1]));
        value = parts.join('');
      } else {
        value = xmlText(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] || '');
      }

      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    grid.push(cells);
  }

  // Rectangularise: a blank trailing cell is real content in an AV sheet.
  const width = grid.reduce((w, r) => Math.max(w, r.length), 0);
  for (const r of grid) while (r.length < width) r.push('');

  while (grid.length && grid[grid.length - 1].every(c => c.trim() === '')) grid.pop();
  return grid;
}

/**
 * Read every worksheet of an `.xlsx`, one grid each.
 *
 * A document with more than one AV body exports as one sheet per body (see
 * `avDocumentToXlsx`), so reading only the first silently dropped every body
 * after it.
 *
 * Handles both ways a cell can carry text: an inline string (what our own
 * export writes) and a shared-string index (what Excel and most other writers
 * produce). Missing cells are filled so every row is rectangular — a blank cell
 * in an AV sheet is meaningful, it is a shot with no audio.
 */
export async function readXlsxGrids(bytes: ArrayBuffer | Uint8Array): Promise<string[][][]> {
  const zip = await JSZip.loadAsync(bytes);

  // Shared strings, when the writer used them.
  const shared: string[] = [];
  const sharedFile = zip.file('xl/sharedStrings.xml');
  if (sharedFile) {
    const xml = await sharedFile.async('string');
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      // A shared string may be split across several <t> runs.
      const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => xmlText(x[1]));
      shared.push(parts.join(''));
    }
  }

  // Sheet order by file name, compared as NUMBERS: sorted as text, sheet10
  // lands between sheet1 and sheet2 and the bodies come back shuffled. The
  // workbook's r:id mapping is overkill here — every writer we care about
  // numbers its sheet parts in order.
  const names = Object.keys(zip.files)
    .filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));

  const grids: string[][][] = [];
  for (const name of names) {
    const xml = await zip.file(name)!.async('string');
    const grid = sheetToGrid(xml, shared);
    if (grid.length) grids.push(grid);
  }
  return grids;
}

/** The first worksheet of an `.xlsx` as a grid. */
export async function readXlsxGrid(bytes: ArrayBuffer | Uint8Array): Promise<string[][]> {
  return (await readXlsxGrids(bytes))[0] ?? [];
}

// ── Column mapping ─────────────────────────────────────────────────────────

/** What an imported column becomes. `ignore` drops it. */
export type AvColumnRole = 'shot' | 'start' | 'duration' | 'video' | 'audio' | 'image' | 'ignore';

/** Keyword sets for guessing a role from a header label. Order matters: the
 *  first set whose keyword appears in the normalised header wins. */
const ROLE_KEYWORDS: Array<{ role: AvColumnRole; words: string[] }> = [
  // Duration before time/shot: "shot duration" and "run time" are durations.
  { role: 'duration', words: ['duration', 'length', 'runtime', 'run time', 'secs', 'seconds', 'dur'] },
  { role: 'image', words: ['storyboard', 'board', 'frame', 'image', 'thumbnail', 'still', 'visual ref'] },
  { role: 'video', words: ['video', 'visual', 'picture', 'vision', 'action', 'shot description', 'camera'] },
  { role: 'audio', words: ['audio', 'sound', 'narration', 'voice', 'vo', 'dialogue', 'dialog', 'script', 'copy'] },
  // Shot before start: our own "Shot / Time" header contains "time", and a
  // generic time keyword checked first would claim it as a start timestamp,
  // so OpenDraft's own export would not round-trip its cue column. The shot
  // keywords are the more specific ones, so they get first refusal; a header
  // like "Start Time" matches none of them and still lands on `start`.
  { role: 'shot', words: ['shot', 'cue', 'scene', 'number', 'no.', '#', 'slate'] },
  { role: 'start', words: ['start', 'timecode', 'tc', 'in point', 'time'] },
];

/** Normalise a header for matching: lowercase, collapse punctuation/space. */
function normaliseHeader(label: string): string {
  return String(label || '').toLowerCase().replace(/[_\-/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Guess what each column of a sheet is.
 *
 * Returns one role per column, in column order. A column whose header matches
 * nothing becomes `ignore` — better to drop it and let the writer reassign it
 * than to guess wrong and bury someone's notes in the audio column.
 *
 * Video and audio are each assigned once: the first match wins, so a sheet with
 * "Video" and "Video Notes" does not produce two video columns.
 */
/**
 * Roles from the header keywords alone, with no fallback.
 *
 * Kept separate because the two callers want different things from it:
 * `guessColumnRoles` wants a usable mapping even from a sheet that names
 * nothing, while `looksLikeHeader` is asking whether this row names anything at
 * all. Counting the fallback's guesses as "recognised names" made any two-column
 * row without a timecode look like a header, and importing a headerless sheet
 * therefore ate its first shot.
 */
function matchColumnRoles(header: readonly string[]): AvColumnRole[] {
  const used = new Set<AvColumnRole>();
  const roles: AvColumnRole[] = [];

  for (const raw of header) {
    const label = normaliseHeader(raw);
    let found: AvColumnRole = 'ignore';
    if (label) {
      for (const { role, words } of ROLE_KEYWORDS) {
        if (used.has(role)) continue;
        if (words.some(w => label.includes(w))) { found = role; break; }
      }
    }
    if (found !== 'ignore') used.add(found);
    roles.push(found);
  }

  return roles;
}

export function guessColumnRoles(header: readonly string[]): AvColumnRole[] {
  const roles = matchColumnRoles(header);
  const used = new Set<AvColumnRole>(roles.filter(r => r !== 'ignore'));

  // A sheet with no recognisable headers is very likely two columns of video
  // and audio — the classic AV layout — so fall back to that rather than
  // importing a document with no content at all.
  if (!used.has('video') && !used.has('audio') && header.length >= 2) {
    const firstFree = roles.findIndex(r => r === 'ignore');
    if (firstFree >= 0) {
      roles[firstFree] = 'video';
      const second = roles.findIndex((r, i) => i > firstFree && r === 'ignore');
      if (second >= 0) roles[second] = 'audio';
    }
  }

  return roles;
}

/** True when a row looks like a header rather than content. */
export function looksLikeHeader(row: readonly string[]): boolean {
  if (!row || !row.length) return false;
  // Keyword matches only — see `matchColumnRoles`. A row that named nothing
  // is content, however many columns it has.
  const named = matchColumnRoles(row).filter(r => r !== 'ignore').length;
  // At least two columns had recognisable names, and nothing looks like a
  // duration value (a header says "Duration", a row says "0:05").
  const anyTimes = row.some(c => parseTimecode(c) !== null && /[:.\d]/.test(c) && c.trim() !== '');
  return named >= 2 && !anyTimes;
}

/**
 * Split a cue cell that holds a shot number and a start time together.
 *
 * OpenDraft's own CSV/XLSX writes the two as one cell — "1. 0:00" — because
 * that is how the on-screen gutter reads. Taken back in whole, that string
 * became a manual shot override: renumbering stopped dead, and the gutter drew
 * "1. 0:00" beside a second, freshly derived timestamp.
 *
 * Only a TRAILING timecode splits off, so "SHOT 2" and "1a" stay intact.
 */
export function splitCueCell(raw: string): { shot: string; start: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { shot: '', start: '' };
  const m = /^(.*?)[\s]+(\d{1,2}(?::\d{2}){1,2})$/.exec(text);
  if (!m) return { shot: text, start: '' };
  return { shot: m[1].trim(), start: m[2] };
}

/** True when an imported shot label says no more than the sequential number
 *  OpenDraft would derive anyway. "1" and "1." both match a derived "1.". */
function isDerivedShot(label: string, derived: string): boolean {
  const strip = (v: string) => v.trim().replace(/\.$/, '');
  return strip(label) === strip(derived);
}

// ── Building the document ──────────────────────────────────────────────────

/** One AV cell of paragraphs, splitting the source text on newlines. */
function buildCell(side: 'video' | 'audio', text: string): JSONContent {
  const lines = String(text ?? '').split(/\r?\n/);
  const content = lines.map(line =>
    line ? { type: 'avPara', content: [{ type: 'text', text: line }] } : { type: 'avPara' },
  );
  return { type: 'avCell', attrs: { side }, content: content.length ? content : [{ type: 'avPara' }] };
}

export interface AvImportOptions {
  /** Roles per column. Defaults to `guessColumnRoles` on the first row. */
  roles?: AvColumnRole[];
  /** Whether the first row is a header. Defaults to `looksLikeHeader`. */
  hasHeader?: boolean;
}

export interface AvImportResult {
  /** The `avBlock` node, ready to place in a document. */
  block: JSONContent;
  /** Roles actually used, so the UI can show and let the user correct them. */
  roles: AvColumnRole[];
  /** Header labels, when the sheet had a header row. */
  header: string[] | null;
  /** How many content rows were turned into AV rows. */
  rowCount: number;
}

/** A whole file's worth of AV bodies. */
export interface AvImportFileResult {
  /** One `avBlock` per body found, in order. */
  blocks: JSONContent[];
  /** Roles of the FIRST body — what the import toast reports. */
  roles: AvColumnRole[];
  /** Header labels of the first body, when it had a header row. */
  header: string[] | null;
  /** Content rows turned into AV rows, across every body. */
  rowCount: number;
}

/**
 * Turn a grid into an `avBlock`.
 *
 * A row with nothing in any mapped column is dropped — trailing blank rows are
 * an artefact of nearly every spreadsheet and importing them would leave a tail
 * of empty shots.
 */
export function gridToAvBlock(grid: readonly (readonly string[])[], opts?: AvImportOptions): AvImportResult {
  const rows = Array.isArray(grid) ? grid.filter(r => Array.isArray(r)) : [];
  if (!rows.length) {
    return { block: { type: 'avBlock', content: [] }, roles: [], header: null, rowCount: 0 };
  }

  const hasHeader = opts?.hasHeader ?? looksLikeHeader(rows[0]);
  const header = hasHeader ? rows[0].map(c => String(c ?? '')) : null;
  const roles = opts?.roles ?? guessColumnRoles(header ?? rows[0].map(() => ''));
  const bodyRows = hasHeader ? rows.slice(1) : rows;

  const at = (role: AvColumnRole) => roles.indexOf(role);
  const iShot = at('shot');
  const iStart = at('start');
  const iDur = at('duration');
  const iVideo = at('video');
  const iAudio = at('audio');
  const iImage = at('image');

  const content: JSONContent[] = [];
  // Mirrors `computeRowTimings`, which is what makes the de-pinning below exact:
  // a value is stored as a manual override only when it says something the
  // editor would NOT have derived from row order and the durations above.
  let clock = 0;
  let index = 0;

  for (const raw of bodyRows) {
    const get = (i: number) => (i >= 0 && i < raw.length ? String(raw[i] ?? '').trim() : '');
    const video = get(iVideo);
    const audio = get(iAudio);
    // Our own export bundles the start into the shot cell; a sheet with its own
    // start column keeps the two apart and that column wins.
    const cue = splitCueCell(get(iShot));
    const shot = cue.shot;
    const start = iStart >= 0 ? get(iStart) : cue.start;
    const durationRaw = get(iDur);
    const image = get(iImage);

    if (!video && !audio && !shot && !start && !durationRaw && !image) continue;

    // Normalise a duration so "5", "0:05" and "00:05" all store the same way.
    const durSecs = parseTimecode(durationRaw);
    const duration = durSecs !== null ? formatTimecode(durSecs) : (durationRaw || null);

    // Compared in seconds rather than as text, so "0:05" and "00:05" agree.
    const startSecs = parseTimecode(start);
    const manualStart = startSecs !== null && startSecs !== clock ? start : null;
    if (startSecs !== null) clock = startSecs;

    const manualShot = shot && !isDerivedShot(shot, `${index + 1}.`) ? shot : null;

    const row: JSONContent = {
      type: 'avRow',
      attrs: {
        // Left null when it only restates the sequential position or the
        // running total, so inserting a row later still renumbers and re-times
        // everything below it.
        shot: manualShot,
        start: manualStart,
        duration,
      },
      content: [
        buildCell('video', video),
        buildCell('audio', audio),
        ...(image ? [{ type: 'avImage', attrs: { src: null, alt: image, assetId: null, aspect: '16:9' } }] : []),
      ],
    };
    content.push(row);
    clock = Math.min(clock + (durSecs ?? 0), MAX_TIMECODE_SECONDS);
    index++;
  }

  const block: JSONContent = {
    type: 'avBlock',
    attrs: {
      columns: {
        cue: iShot >= 0 || iDur >= 0 || iStart >= 0,
        image: iImage >= 0,
        widths: { cue: 0.5, video: 2, audio: 2, image: 1.5 },
      },
      ...(header
        ? {
            headers: {
              cue: (iShot >= 0 ? header[iShot] : '') || 'Shot / Time',
              video: (iVideo >= 0 ? header[iVideo] : '') || 'Video',
              audio: (iAudio >= 0 ? header[iAudio] : '') || 'Audio',
              image: (iImage >= 0 ? header[iImage] : '') || 'Storyboard',
            },
          }
        : {}),
      repeatHeaders: true,
    },
    content,
  };

  return { block, roles, header, rowCount: content.length };
}

/**
 * Split a CSV grid into one section per AV body.
 *
 * `avDocumentToCsv` separates bodies with a blank line and gives each one its
 * own header row, so read back as a single grid the second body's header
 * imported as a shot — a row reading "Video / Audio" sitting in the middle of
 * the document.
 *
 * A break is only taken when a blank row is FOLLOWED by something that looks
 * like a header. A stray blank line is far more common in someone else's sheet
 * than a second body is, and splitting on one would cut a single shot list in
 * two, losing the column mapping for everything below the cut.
 */
export function splitGridSections(grid: readonly (readonly string[])[]): string[][][] {
  const rows = (Array.isArray(grid) ? grid : [])
    .filter(r => Array.isArray(r))
    .map(r => r.map(c => String(c ?? '')));
  const isBlank = (r: readonly string[]) => r.every(c => c.trim() === '');

  const sections: string[][][] = [];
  let current: string[][] = [];

  for (let i = 0; i < rows.length; i++) {
    if (!isBlank(rows[i])) { current.push(rows[i]); continue; }
    // Skip any run of blank rows and look at what follows.
    let next = i + 1;
    while (next < rows.length && isBlank(rows[next])) next++;
    if (current.length && next < rows.length && looksLikeHeader(rows[next])) {
      sections.push(current);
      current = [];
      i = next - 1;
    }
    // Otherwise the blank row is simply dropped, which is what gridToAvBlock
    // would have done with it anyway.
  }

  if (current.length) sections.push(current);
  return sections;
}

/**
 * Turn every section of a file into its own `avBlock`.
 *
 * Each section guesses its own columns: two bodies in one document are separate
 * sections with their own headers, and forcing the first body's mapping onto a
 * second one shaped differently would scramble it.
 */
export function gridsToAvBlocks(
  grids: readonly (readonly (readonly string[])[])[],
  opts?: AvImportOptions,
): AvImportFileResult {
  const results = (Array.isArray(grids) ? grids : [])
    .map(g => gridToAvBlock(g, opts))
    .filter(r => r.rowCount > 0);

  if (!results.length) return { blocks: [], roles: [], header: null, rowCount: 0 };

  return {
    blocks: results.map(r => r.block),
    roles: results[0].roles,
    header: results[0].header,
    rowCount: results.reduce((n, r) => n + r.rowCount, 0),
  };
}

/** Import a CSV string as an AV body. */
export function importAvCsv(text: string, opts?: AvImportOptions): AvImportFileResult {
  return gridsToAvBlocks(splitGridSections(parseCsv(text)), opts);
}

/** Import an xlsx as an AV document — one body per worksheet. */
export async function importAvXlsx(
  bytes: ArrayBuffer | Uint8Array,
  opts?: AvImportOptions,
): Promise<AvImportFileResult> {
  return gridsToAvBlocks(await readXlsxGrids(bytes), opts);
}
