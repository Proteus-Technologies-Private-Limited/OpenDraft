/**
 * Highland (.highland) import.
 *
 * A .highland file is a zip of a TextBundle (http://textbundle.org): the
 * document's text in `text.fountain` — or `text.markdown` / `text.txt` for a
 * Highland document that is not a screenplay — beside an `info.json`, an
 * `assets/` folder for images, and JSON of Highland's own (sprints, character
 * highlighting, the bin). Highland's developers describe it that way at
 * quoteunquoteapps.com/highland-2/highland-format, and renaming one to .zip and
 * unzipping it gives either the bundle's files or a `Name.textbundle/` folder
 * holding them, so both layouts are accepted.
 *
 * The text is ordinary Fountain, so it goes through the Fountain parser and
 * keeps its title page, scene numbers, dual dialogue, sections and notes. The
 * Highland-only extras — the bin, sprints, gender analysis, highlighting —
 * have nowhere to go and are left behind.
 */
import { parseFountain } from './fountainParser';
import {
  loadImportArchive,
  findArchiveEntry,
  describeArchiveContents,
  readArchiveText,
  archiveFileNames,
  type ArchiveImportResult,
  type ImportNode,
} from './importArchive';

/** Where a TextBundle keeps its text, preferring the screenplay flavour. */
const TEXT_ENTRY_PATTERNS: RegExp[] = [
  /(^|\/)text\.fountain$/i,
  /(^|\/)text\.(markdown|md|txt)$/i,
  // Not what Highland writes, but a bundle zipped by hand can carry its script
  // under its own name, and a lone .fountain inside is unambiguous.
  /\.fountain$/i,
];

export async function parseHighland(data: ArrayBuffer): Promise<ArchiveImportResult> {
  const zip = await loadImportArchive(data, 'Highland', 'highland');

  let entry = null;
  for (const pattern of TEXT_ENTRY_PATTERNS) {
    entry = findArchiveEntry(zip, pattern);
    if (entry) break;
  }
  if (!entry) {
    throw new Error(
      `Not a Highland screenplay: the file has no text.fountain${describeArchiveContents(zip)}.`,
    );
  }

  const warnings: string[] = [];
  if (!/\.fountain$/i.test(entry.name)) {
    warnings.push(
      `This Highland document is stored as ${entry.name.replace(/^.*\//, '')} rather than Fountain, ` +
        'so it was read as Fountain text; check the element types after import.',
    );
  }
  if (archiveFileNames(zip).some((name) => /(^|\/)assets\/[^/]+$/.test(name))) {
    warnings.push('Images stored in the Highland file were not imported.');
  }

  const text = await readArchiveText(entry);
  const doc = parseFountain(text) as ImportNode;
  return { doc, title: fountainTitle(doc), warnings };
}

/** The title the script's own title page gives, so the document is not named after the file. */
function fountainTitle(doc: ImportNode): string {
  for (const node of doc.content ?? []) {
    const title = node.type === 'titlePage' ? node.attrs?.tpTitle : undefined;
    // Fountain titles are often emphasised (`Title: **BIG FISH**`); the
    // document name wants the words, not the markup.
    if (typeof title === 'string' && title.trim()) {
      return title.replace(/[*_]/g, '').replace(/\s*\n\s*/g, ' ').trim();
    }
  }
  return '';
}
