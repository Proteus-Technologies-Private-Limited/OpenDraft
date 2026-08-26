/**
 * Where the title page ends and the screenplay begins.
 *
 * Four places had to answer this and each answered it differently: the
 * paginator, the PDF exporter, the DOCX exporter, and the Title Page dialog.
 * All four agreed on the happy path and disagreed the moment anything sat above
 * the title page — which is one keystroke away, because pressing Enter with the
 * caret at the start of the title inserts a blank Action above it
 * (`ScreenplayEditor` handles `atBlockStart` by putting a blank line on top).
 *
 * The exporters treated the region as the *leading* run of `titlePage` /
 * `screenplayImage` nodes and stopped at the first node that was neither. One
 * blank line above the title and the whole title page was reclassified as body
 * content, so the PDF opened with the title, the credit, the draft, the contact
 * and the copyright stacked at the top of screenplay page 1 with the first scene
 * heading directly underneath — issue #52, reported against the editor, real in
 * the export.
 *
 * Two rules, applied here once for everyone:
 *
 *   - Blank nodes of any type are absorbed into the region. A blank line above
 *     or between title-page elements is a typo, not the start of the script.
 *   - Up to `MAX_STRAY_LINES` nodes with text are absorbed as well, so a stray
 *     word typed above the title does not cost the writer their title page. Past
 *     that, the writer is taken at their word: the document opens with body
 *     content and there is no title page.
 *
 * "Is there a title page at all" is a separate question, and it used to be
 * answered with `attrs.tpTitle` alone. A title page carrying only a credit line
 * — or a legacy one holding its text as node content rather than attributes,
 * which the Title Page dialog still reads — failed that test, and the exporters
 * then dropped every one of its lines on the floor rather than putting them on
 * a page. Any text or any structured field now counts.
 */

/** Node types that belong to the title page rather than the script. */
export const TITLE_REGION_TYPES: ReadonlySet<string> = new Set([
  'titlePage',
  'screenplayImage',
]);

/**
 * How many nodes with actual text may sit above the title page before the
 * document is read as a screenplay that simply happens to contain title-page
 * nodes. Two covers a slip of the keyboard; a real script has far more.
 */
const MAX_STRAY_LINES = 2;

/** The structured fields the Title Page dialog writes onto the `title` node. */
const TITLE_ATTR_KEYS = [
  'tpTitle',
  'tpCredit',
  'tpWrittenBy',
  'tpBasedOn',
  'tpDraft',
  'tpDraftDate',
  'tpContact',
  'tpCopyright',
  'tpWgaRegistration',
  'tpNotes',
] as const;

export interface TitleNodeInfo {
  /** ProseMirror node type name. */
  type: string;
  /** Whether the node renders any visible text. */
  hasText: boolean;
  /** Whether the node carries structured title-page data in its attributes. */
  hasTitleData: boolean;
}

export interface TitlePageRegion {
  /** Node count belonging to the title page; the body starts at this index. */
  length: number;
  /**
   * Whether the region is worth a page of its own. False for a region that is
   * only blank spacers or only images — there is nothing to show.
   */
  isReal: boolean;
}

/** Whether a `titlePage` node's attributes carry anything the writer entered. */
export function titlePageAttrsCarryData(
  attrs: Record<string, unknown> | null | undefined,
): boolean {
  if (!attrs) return false;
  return TITLE_ATTR_KEYS.some((key) => {
    const value = attrs[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

/**
 * Split a document's top-level nodes into title page and body.
 *
 * Returns `length: 0` when there is no title page, which leaves every existing
 * document without one behaving exactly as before.
 */
export function findTitlePageRegion(nodes: readonly TitleNodeInfo[]): TitlePageRegion {
  let lastTitleIndex = -1;
  let strayLines = 0;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (TITLE_REGION_TYPES.has(node.type)) {
      lastTitleIndex = i;
      continue;
    }
    if (!node.hasText) continue; // blank line: absorbed either way
    if (++strayLines > MAX_STRAY_LINES) break;
  }

  if (lastTitleIndex < 0) return { length: 0, isReal: false };

  // End the region at the last title node, so blank lines trailing after it
  // stay with the body where the writer put them.
  const length = lastTitleIndex + 1;
  const isReal = nodes
    .slice(0, length)
    .some((n) => n.type === 'titlePage' && (n.hasText || n.hasTitleData));

  return { length, isReal };
}
