/**
 * AV spreadsheet export — XLSX and CSV.
 *
 * This is the interchange format for AV documents. There is no structured
 * AV/shot-list standard in the industry: screenplay formats (FDX, Fountain,
 * OSF) are built around screenplay elements and cannot carry arbitrary
 * row-and-column AV data, so what production tooling actually exchanges is
 * spreadsheets — Movie Magic Scheduling and StudioBinder both import CSV, and
 * shot-list tools export xlsx. Writing those means an AV document opens in
 * something the rest of a production already uses.
 *
 * The XLSX is written by hand on top of `jszip`, which the project already
 * depends on for `.odraft` packaging. An xlsx is a zip of XML parts, and the
 * subset needed for "a sheet of text cells with a header row" is small and
 * stable — small enough that it is not worth pulling a spreadsheet library and
 * its transitive tree into the bundle for it.
 */
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { extractAvBodies, avBodyToGrid, type AvExportBody } from './avDocument';

// ── CSV ────────────────────────────────────────────────────────────────────

/**
 * Quote one CSV field per RFC 4180.
 *
 * AV cells routinely contain commas, quotes and newlines — a line of narration
 * is exactly the kind of text that breaks a naive join — so every field that
 * contains any of them is quoted and its quotes doubled.
 */
function csvField(value: string): string {
  const s = value ?? '';
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Render a grid as CSV text. */
export function gridToCsv(grid: readonly (readonly string[])[]): string {
  return grid.map(row => row.map(c => csvField(String(c ?? ''))).join(',')).join('\r\n');
}

/**
 * CSV for a whole document.
 *
 * Multiple AV bodies are separated by a blank line rather than merged: they are
 * distinct sections with their own headers, and gluing them together would
 * silently imply a continuous shot list.
 */
export function avDocumentToCsv(doc: JSONContent | null | undefined): string {
  const bodies = extractAvBodies(doc);
  if (!bodies.length) return '';
  return bodies.map(b => gridToCsv(avBodyToGrid(b))).join('\r\n\r\n');
}

// ── XLSX ───────────────────────────────────────────────────────────────────

/** Escape text for XML content. */
function xmlEscape(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Excel rejects most control characters outright; strip all but tab/CR/LF.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

/** Column index (0-based) to a spreadsheet column name: 0→A, 26→AA. */
export function columnName(index: number): string {
  let n = Math.max(0, Math.floor(index)) + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** One `<row>` of inline-string cells. */
function sheetRow(cells: readonly string[], rowIndex: number, headerStyle: boolean): string {
  const r = rowIndex + 1;
  const parts = cells.map((cell, c) => {
    const ref = `${columnName(c)}${r}`;
    const style = headerStyle ? ' s="1"' : ' s="2"';
    // Inline strings keep this to one part — no sharedStrings table to keep in
    // sync, which is the usual source of a corrupt hand-written xlsx.
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(cell)}</t></is></c>`;
  });
  return `<row r="${r}">${parts.join('')}</row>`;
}

/** Widths tuned for AV content: cue narrow, video/audio wide enough to read. */
function columnWidths(grid: readonly (readonly string[])[]): string {
  const count = grid[0]?.length ?? 0;
  if (!count) return '';
  const cols: string[] = [];
  for (let i = 0; i < count; i++) {
    // Narrow for short columns (cue, duration, storyboard ref), wide for prose.
    const sample = grid.slice(1).map(r => (r[i] || '').length);
    const longest = sample.length ? Math.max(...sample) : 0;
    const width = Math.min(Math.max(longest + 2, 12), 60);
    cols.push(`<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`);
  }
  return `<cols>${cols.join('')}</cols>`;
}

function sheetXml(grid: readonly (readonly string[])[]): string {
  const rows = grid.map((cells, i) => sheetRow(cells, i, i === 0)).join('');
  // freezePane on the header row: an AV sheet is read by scrolling, and losing
  // the column headers three rows in makes it unusable.
  const freeze =
    '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '</sheetView></sheetViews>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    freeze +
    columnWidths(grid) +
    `<sheetData>${rows}</sheetData>` +
    '</worksheet>'
  );
}

/** Minimal styles: bold header (s=1) and wrapped body text (s=2). Wrapping is
 *  the difference between a readable AV sheet and one long unreadable line. */
const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
  '</cellXfs>' +
  // Excel wants a named default style present; without <cellStyles> readers
  // warn that the workbook has no default style and substitute their own.
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/** Sheet names may not exceed 31 chars or contain : \ / ? * [ ] */
export function safeSheetName(name: string, fallback: string): string {
  const cleaned = String(name || '').replace(/[:\\/?*[\]]/g, ' ').trim();
  return (cleaned || fallback).slice(0, 31);
}

/**
 * Build an `.xlsx` for every AV body in the document, one sheet each.
 *
 * Returns null when the document has no AV content, so a caller can decline to
 * offer the format rather than writing an empty workbook.
 */
export async function avDocumentToXlsx(
  doc: JSONContent | null | undefined,
  opts?: { sheetName?: string },
): Promise<Blob | null> {
  const bodies = extractAvBodies(doc);
  if (!bodies.length) return null;

  const zip = new JSZip();
  const names: string[] = [];

  bodies.forEach((body, i) => {
    const base = bodies.length === 1 ? (opts?.sheetName || 'AV Script') : `AV ${i + 1}`;
    let name = safeSheetName(base, `AV ${i + 1}`);
    // Excel refuses a workbook with duplicate sheet names.
    let n = 2;
    while (names.includes(name)) name = safeSheetName(`${base} ${n++}`, `AV ${i + 1}`);
    names.push(name);
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(avBodyToGrid(body)));
  });

  const sheetEntries = names
    .map((n, i) => `<sheet name="${xmlEscape(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');
  const sheetRels = names
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('');
  const overrides = names
    .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('');

  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      overrides +
      '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>',
  );
  zip.file(
    'xl/workbook.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      `<sheets>${sheetEntries}</sheets></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheetRels +
      `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>',
  );
  zip.file('xl/styles.xml', STYLES_XML);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    compression: 'DEFLATE',
  });
}

// ── Plain text ─────────────────────────────────────────────────────────────

/**
 * A flattened plain-text AV script.
 *
 * Deliberately not a table: monospace column art breaks the moment a line of
 * narration is longer than the guess, and it cannot be re-imported anyway. A
 * labelled block per shot stays readable everywhere.
 */
export function avDocumentToText(doc: JSONContent | null | undefined): string {
  const bodies = extractAvBodies(doc);
  if (!bodies.length) return '';
  const out: string[] = [];

  bodies.forEach((body: AvExportBody, bi) => {
    if (bodies.length > 1) out.push(`--- AV ${bi + 1} ---`, '');
    for (const row of body.rows) {
      const head = body.columns.cue
        ? `${row.shot}${row.start ? `  ${row.start}` : ''}${row.duration ? `  (${row.duration})` : ''}`
        : row.shot;
      out.push(head.trim());
      if (row.video.trim()) out.push(`  ${body.headers.video.toUpperCase()}: ${row.video.replace(/\n/g, '\n    ')}`);
      if (row.audio.trim()) out.push(`  ${body.headers.audio.toUpperCase()}: ${row.audio.replace(/\n/g, '\n    ')}`);
      if (row.image) out.push(`  ${body.headers.image.toUpperCase()}: ${row.image.alt || row.image.assetId || row.image.src || 'frame'}`);
      out.push('');
    }
    if (body.totalSeconds > 0) out.push(`Total runtime: ${body.totalFormatted}`, '');
  });

  return out.join('\n').trimEnd() + '\n';
}

// ── Save helpers ───────────────────────────────────────────────────────────

/**
 * Save the document's AV bodies as a spreadsheet.
 *
 * Throws when the document holds no AV content so the caller can tell the
 * writer why nothing happened, rather than handing them an empty workbook.
 */
export async function downloadAvXlsx(doc: JSONContent | null | undefined, title = 'Untitled'): Promise<void> {
  const blob = await avDocumentToXlsx(doc, { sheetName: title });
  if (!blob) throw new Error('This document has no AV content to export.');
  const { sanitizeExportFilename } = await import('./exportFilename');
  const { saveFile } = await import('./fileOps');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  await saveFile(bytes, `${sanitizeExportFilename(title)}.xlsx`, [
    { name: 'Excel Workbook', extensions: ['xlsx'] },
  ]);
}

/** Save the document's AV bodies as CSV. */
export async function downloadAvCsv(doc: JSONContent | null | undefined, title = 'Untitled'): Promise<void> {
  const text = avDocumentToCsv(doc);
  if (!text) throw new Error('This document has no AV content to export.');
  const { sanitizeExportFilename } = await import('./exportFilename');
  const { saveFile } = await import('./fileOps');
  await saveFile(text, `${sanitizeExportFilename(title)}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
}

/** Save the document's AV bodies as flattened plain text. */
export async function downloadAvText(doc: JSONContent | null | undefined, title = 'Untitled'): Promise<void> {
  const text = avDocumentToText(doc);
  if (!text.trim()) throw new Error('This document has no AV content to export.');
  const { sanitizeExportFilename } = await import('./exportFilename');
  const { saveFile } = await import('./fileOps');
  await saveFile(text, `${sanitizeExportFilename(title)}.txt`, [{ name: 'Plain Text', extensions: ['txt'] }]);
}
