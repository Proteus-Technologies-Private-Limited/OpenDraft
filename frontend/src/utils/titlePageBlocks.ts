/**
 * The laid-out title page, as document nodes.
 *
 * A title page is not one node. It is a *run* of `titlePage` nodes — blank
 * spacers positioning the title about a third down the page, the title, the
 * credit, then a gap wide enough to push the draft/contact/copyright/notes
 * block onto the last few lines. Every consumer measures that run: the
 * paginator counts its lines to place the page break, and both exporters draw
 * it in document order.
 *
 * The importers did not build it. `parseFountain`, `parseFDXFull` and
 * `parseOSF` each produced a *single* `titlePage` node carrying the fields as
 * attributes with no laid-out run behind them, and nothing expanded it on load.
 * The result was an imported title page that exported as one nearly-blank page
 * and lost every field but the title, until the writer happened to open
 * Format ▸ Title Page and press Apply (issue #52).
 *
 * They call this instead, so an imported title page is the same shape as one
 * the dialog builds and `findTitlePageRegion` reports it as a real region.
 *
 * NOTE: `buildTitlePageBlocks` in `components/TitlePageEditor.tsx` still holds
 * its own ProseMirror-node copy of this layout, including the image handling
 * that only the dialog needs. The two are meant to converge on this one — the
 * dialog's becoming a thin wrapper — which is a separate change to a file
 * another session is currently holding. Keep the arithmetic here identical to
 * that copy until they are merged.
 */
import { DEFAULT_PAGE_LAYOUT, type PageLayout } from '../stores/editorStore';
import { getPageMetrics } from '../editor/pagination';

/** Structurally the `TipTapNode` each parser declares for itself. */
export interface TitlePageBlock {
  type: string;
  content?: { type: string; text?: string }[];
  attrs?: Record<string, unknown>;
}

/** The fields the Title Page dialog reads and writes. */
export interface TitlePageFields {
  tpTitle?: string;
  tpWrittenBy?: string;
  tpBasedOn?: string;
  tpDraft?: string;
  tpDraftDate?: string;
  tpContact?: string;
  tpCopyright?: string;
  tpWgaRegistration?: string;
  tpNotes?: string;
  [key: string]: unknown;
}

/**
 * The rendered credit lines, derived from the raw fields.
 *
 * Mirrors `deriveFields` in TitlePageEditor.tsx: the source is on the file,
 * "Written by" is a label the writer never types, and the WGA registration
 * shares the copyright block rather than getting a line of its own.
 */
export function deriveTitlePageLines(data: TitlePageFields): {
  byLine: string;
  draftLine: string;
  copyrightLine: string;
} {
  const writtenBy = str(data.tpWrittenBy);
  const basedOn = str(data.tpBasedOn);
  const byLine = writtenBy
    ? (basedOn ? `Written by ${writtenBy}\n${basedOn}` : `Written by ${writtenBy}`)
    : '';
  const draftLine = [str(data.tpDraft), str(data.tpDraftDate)].filter(Boolean).join(' - ');
  const copyrightLine = [str(data.tpCopyright), str(data.tpWgaRegistration)]
    .filter(Boolean)
    .join('\n');
  return { byLine, draftLine, copyrightLine };
}

/** Whether any field carries something worth putting on a page. */
export function hasTitlePageContent(data: TitlePageFields): boolean {
  const { byLine, draftLine, copyrightLine } = deriveTitlePageLines(data);
  return Boolean(
    str(data.tpTitle) || byLine || draftLine || copyrightLine || str(data.tpContact) || str(data.tpNotes),
  );
}

/**
 * Lay the fields out as a run of `titlePage` nodes.
 *
 * `layout` decides how tall the page is: the line counts are derived from it
 * rather than fixed, because the constants they replaced assumed 54-line US
 * Letter while the default layout is A4 at 58, which left the bottom block four
 * lines short on every A4 script and would have overflowed a shorter page.
 *
 * Pass the layout the file itself carries. Reading it from the editor store
 * would be wrong here — during an import the store still holds the layout of
 * the document being replaced.
 *
 * Returns `[]` when there is nothing to show, so a file with an empty title
 * page imports as a screenplay with no title page rather than a blank sheet.
 */
export function buildTitlePageBlocks(
  data: TitlePageFields,
  layout: PageLayout = DEFAULT_PAGE_LAYOUT,
): TitlePageBlock[] {
  if (!hasTitlePageContent(data)) return [];

  const { byLine, draftLine, copyrightLine } = deriveTitlePageLines(data);
  const { linesPerPage } = getPageMetrics(layout);
  const TITLE_LINE = Math.max(3, Math.round(linesPerPage / 3.6)); // title sits ~⅓ down
  const PAGE_LINES = Math.max(TITLE_LINE + 4, linesPerPage - 4);  // bottom content ends here

  const blocks: TitlePageBlock[] = [];

  // The title node carries the structured fields, which is where the dialog
  // reads them back from and what `titlePageAttrsCarryData` keys off.
  const titleAttrs: Record<string, unknown> = { ...data, field: 'title' };

  const topSpacers = Math.max(2, TITLE_LINE - 1);
  for (let i = 0; i < topSpacers; i++) blocks.push(blank());
  blocks.push(node(titleAttrs, str(data.tpTitle)));
  let used = topSpacers + 1;

  if (byLine) {
    blocks.push(blank(), blank(), node({ field: 'author' }, byLine));
    used += 3;
  }

  const bottom: [string, string][] = [];
  if (draftLine) bottom.push(['draft', draftLine]);
  if (str(data.tpContact)) bottom.push(['contact', str(data.tpContact)]);
  if (copyrightLine) bottom.push(['copyright', copyrightLine]);
  if (str(data.tpNotes)) bottom.push(['date', str(data.tpNotes)]);

  if (bottom.length) {
    const bottomLines = bottom.reduce((sum, [, text]) => sum + text.split('\n').length, 0);
    const gap = Math.max(2, PAGE_LINES - used - bottomLines);
    for (let i = 0; i < gap; i++) blocks.push(blank());
    for (const [field, text] of bottom) blocks.push(node({ field }, text));
  }

  return blocks;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function blank(): TitlePageBlock {
  return { type: 'titlePage', attrs: { field: 'blank' }, content: [] };
}

function node(attrs: Record<string, unknown>, text: string): TitlePageBlock {
  return {
    type: 'titlePage',
    attrs,
    content: text ? [{ type: 'text', text }] : [],
  };
}
