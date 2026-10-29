/**
 * Shared plumbing for the importers whose files are zip archives written by
 * other screenwriting apps — Highland (.highland), WriterDuet (.wdz) and Celtx
 * (.celtx). Fade In's .fadein predates this and keeps its own copy in
 * osfParser.ts.
 *
 * Each of those formats wraps the script in a zip and then stores it its own
 * way, so all this module does is open the archive with a message that names
 * the format, find an entry wherever the writing app chose to put it, and
 * build the text runs every parser ends up producing.
 */
import JSZip from 'jszip';

/** Structurally the `TipTapNode` each parser declares for itself. */
export interface ImportNode {
  type: string;
  content?: ImportNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

/** What each archive importer returns to importScreenplay. */
export interface ArchiveImportResult {
  doc: ImportNode;
  /** The title the file carries, or '' when it has none. */
  title: string;
  /** Non-fatal notes about what could not be carried across. */
  warnings: string[];
}

/** One run of text and the inline marks (bold, italic, underline) on it. */
export interface TextRun {
  text: string;
  marks: string[];
}

/**
 * Open `data` as a zip, or throw a message that says which format was expected.
 *
 * A file renamed to the wrong extension, or one cut short by a sync client,
 * fails here — and "End of data reached" alone does not tell a writer that the
 * file they picked is the problem.
 */
export async function loadImportArchive(data: ArrayBuffer, formatName: string, ext: string): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(data);
  } catch (err) {
    // The zip library's own wording ("Can't find end of central directory…",
    // with a link to its docs) means nothing to a writer; it goes to the log
    // for diagnosis and the message says what to do instead.
    console.warn(`[import] .${ext} is not a readable zip archive:`, err);
    throw new Error(
      `Could not read the ${formatName} file — it is not a valid .${ext} archive. ` +
        `It may be damaged, incomplete, or saved in a different format; try exporting it from ${formatName} again.`,
    );
  }
}

/** The archive's files, minus the folders and the resource forks macOS adds when zipping. */
export function archiveFileNames(zip: JSZip): string[] {
  return Object.keys(zip.files).filter(
    (name) => !zip.files[name].dir && !/(^|\/)__MACOSX\//.test(name) && !/(^|\/)\._/.test(name),
  );
}

/**
 * The entry matching `pattern` that sits shallowest in the archive.
 *
 * Shallowest, because the same file name can turn up again deeper down — a
 * Highland bundle can carry older copies of its text in a revisions folder —
 * and the one at the top is the document itself.
 */
export function findArchiveEntry(zip: JSZip, pattern: RegExp): JSZip.JSZipObject | null {
  const matches = archiveFileNames(zip)
    .filter((name) => pattern.test(name))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return matches.length > 0 ? zip.file(matches[0]) : null;
}

/** A short "(found: a, b, c)" listing for an error message. */
export function describeArchiveContents(zip: JSZip): string {
  const names = archiveFileNames(zip).slice(0, 5);
  return names.length > 0 ? ` (found: ${names.join(', ')})` : ' (the archive is empty)';
}

/** Read an archive entry as text, without the byte-order mark some apps write. */
export async function readArchiveText(entry: JSZip.JSZipObject): Promise<string> {
  return (await entry.async('string')).replace(/^\uFEFF/, '');
}

/**
 * Turn text runs into a block's inline content.
 *
 * Newlines become `hardBreak` nodes rather than staying in the text: only the
 * former survives the exporters (see fdxParser). Adjacent runs with the same
 * marks are merged so the document is not split at every formatting boundary
 * the source happened to record.
 */
export function runsToContent(runs: TextRun[]): ImportNode[] {
  const out: ImportNode[] = [];
  const sameMarks = (a: ImportNode, marks: string[]) =>
    (a.marks ?? []).map((m) => m.type).join(',') === marks.join(',');

  for (const run of runs) {
    const marks = [...new Set(run.marks)].sort();
    run.text.split('\n').forEach((segment, i) => {
      if (i > 0) out.push({ type: 'hardBreak' });
      if (segment === '') return;
      const last = out[out.length - 1];
      if (last && last.type === 'text' && sameMarks(last, marks)) {
        last.text = `${last.text}${segment}`;
        return;
      }
      const node: ImportNode = { type: 'text', text: segment };
      if (marks.length > 0) node.marks = marks.map((type) => ({ type }));
      out.push(node);
    });
  }
  return out;
}

/** The plain text of a block built by {@link runsToContent}. */
export function plainTextOf(node: ImportNode): string {
  return (node.content ?? []).map((c) => (c.type === 'hardBreak' ? '\n' : c.text ?? '')).join('');
}
