/**
 * The Title Page dialog's layout builder.
 *
 * A second copy of `buildTitlePageBlocks` in `titlePageBlocks.ts`. The two lay
 * the page out with identical arithmetic; this one additionally places the
 * title-page images and carries the writer's own character formatting across a
 * rebuild, which only the dialog needs. They are meant to converge on the
 * shared one, with this becoming a thin wrapper — until then, keep the
 * arithmetic in the two identical.
 *
 * It lives here rather than in `components/TitlePageEditor.tsx`, where it grew,
 * so it is reachable from tests without standing up an editor.
 */
import type { Node as PMNode, Mark, Schema } from '@tiptap/pm/model';
import type { TitlePageAttrs } from '../editor/extensions/TitlePage';
import { DEFAULT_TITLE_PAGE_CREDIT, hasTitlePageContent } from './titlePageBlocks';
import { CUSTOM_TITLE_FIELDS, customTitleBlockLines, replaceBlockText } from './customTitlePage';

export type TpData = Omit<TitlePageAttrs, 'field'>;

/**
 * All `buildTitlePageBlocks` needs from the editor: the schema to build nodes
 * with, and the document to carry the writer's own marks across. Declared
 * structurally rather than as `Editor` so the builder is reachable from tests
 * without standing up a whole editor.
 */
export interface TitlePageBuildSource {
  state: { schema: Schema; doc: PMNode };
}

/** Derive the rendered credit lines from the dialog fields.
 *  Keep in step with `deriveTitlePageLines` in utils/titlePageBlocks.ts. */
export function deriveFields(data: TpData) {
  const credit = data.tpCredit.trim() || DEFAULT_TITLE_PAGE_CREDIT;
  const byLine = data.tpWrittenBy
    ? [credit, data.tpWrittenBy, data.tpBasedOn].filter(Boolean).join('\n')
    : '';
  const draftLine = (data.tpDraft || data.tpDraftDate) ? [data.tpDraft, data.tpDraftDate].filter(Boolean).join(' - ') : '';
  const copyrightLine = (data.tpCopyright || data.tpWgaRegistration) ? [data.tpCopyright, data.tpWgaRegistration].filter(Boolean).join('\n') : '';
  return { byLine, draftLine, copyrightLine };
}

/**
 * Build the title-page nodes with the classic layout: optional images at the
 * top, the title ~⅓ down, the credit line below it, the draft/contact/copyright/
 * notes block pushed to the bottom (via blank spacer lines), then optional
 * images at the very bottom. Rendered identically by the flow exporters.
 *
 * `linesPerPage` is a parameter rather than a store read: the layout that
 * matters is the one belonging to the document being laid out. That is the
 * store's for the dialog, but an importer building a title page holds the
 * incoming document's layout while the store still has the previous document's.
 */
export function buildTitlePageBlocks(
  editor: TitlePageBuildSource,
  data: TpData,
  imagesAbove: Record<string, unknown>[],
  imagesBelow: Record<string, unknown>[],
  linesPerPage: number,
): PMNode[] {
  // Nothing to lay out: no fields, no images. Returning an empty run rather
  // than the usual spacers is what makes "clear every field, Apply" actually
  // remove the title page. The spacers carry no text and no attributes, so
  // `findTitlePageRegion` reports the region as not real, the paginator gives
  // it zero length, and the whole run lands at the top of page 1 as a block of
  // blank lines — the title page gone but its whitespace left behind.
  // Matches `buildTitlePageBlocks` in utils/titlePageBlocks.ts, which has
  // always returned [] here.
  if (!hasTitlePageContent(data) && !imagesAbove.length && !imagesBelow.length) return [];

  const schema = editor.state.schema;
  const titlePageType = schema.nodes.titlePage;
  const imageType = schema.nodes.screenplayImage;
  const { byLine, draftLine, copyrightLine } = deriveFields(data);
  const blank = () => titlePageType.create({ field: 'blank' });

  // Whatever the writer set on each field by hand, so applying the dialog does
  // not throw it away.
  //
  // Every apply rebuilds the title page from the field values, and the text
  // nodes were built bare — so a title set in a display face reverted to the
  // template's font the moment anything else on the page was edited. The marks
  // are the writer's own formatting: they win over the template, and they are
  // what has to survive.
  const keptMarks = new Map<string, readonly Mark[]>();
  editor.state.doc.forEach((node) => {
    if (node.type.name !== 'titlePage') return;
    const field = node.attrs?.field as string | undefined;
    if (!field || field === 'blank' || keptMarks.has(field)) return;
    const first = node.firstChild;
    if (first?.isText && first.marks.length > 0) keptMarks.set(field, first.marks);
  });

  const text = (field: string, t: string): PMNode =>
    titlePageType.create(
      field === 'title' ? { field: 'title', ...data } : { field },
      t ? schema.text(t, keptMarks.get(field) as Mark[] | undefined) : undefined,
    );
  const imgLines = (a: Record<string, unknown>) => Math.max(1, Number(a.heightLines) || 8);

  // Sized from the document's own page, not a hardcoded 54-line US Letter. A4 —
  // the default — holds 58 lines, so the old constants left the bottom block
  // four lines short of the foot of the page on every A4 script, and would have
  // overflowed a shorter page outright.
  const TITLE_LINE = Math.max(3, Math.round(linesPerPage / 3.6)); // title sits ~⅓ down
  const PAGE_LINES = Math.max(TITLE_LINE + 4, linesPerPage - 4);  // bottom content ends here
  const aboveLines = imagesAbove.reduce((s, a) => s + imgLines(a), 0);
  const belowLines = imagesBelow.reduce((s, a) => s + imgLines(a), 0);

  const blocks: PMNode[] = [];
  // Top images fill the space ABOVE the title; they only push the title down when
  // they're taller than that space (then the title shifts by just the overflow).
  for (const a of imagesAbove) blocks.push(imageType.create(a));
  const topSpacers = Math.max(2, TITLE_LINE - 1 - aboveLines);
  for (let i = 0; i < topSpacers; i++) blocks.push(blank());
  blocks.push(text('title', data.tpTitle || ''));
  let used = aboveLines + topSpacers + 1;
  if (byLine) { blocks.push(blank(), blank(), text('author', byLine)); used += 3; }

  const bottom: [string, string][] = [];
  if (draftLine) bottom.push(['draft', draftLine]);
  if (data.tpContact) bottom.push(['contact', data.tpContact]);
  if (copyrightLine) bottom.push(['copyright', copyrightLine]);
  if (data.tpNotes) bottom.push(['date', data.tpNotes]);
  const bottomLines = bottom.reduce((s, [, t]) => s + t.split('\n').length, 0);
  if (bottom.length || imagesBelow.length) {
    // Gap pushes the bottom block + bottom images to the bottom of the page.
    const gap = Math.max(2, PAGE_LINES - used - bottomLines - belowLines);
    for (let i = 0; i < gap; i++) blocks.push(blank());
    for (const [f, t] of bottom) blocks.push(text(f, t));
    for (const a of imagesBelow) blocks.push(imageType.create(a));
  }
  return blocks;
}

/** Carry the visible standard page into the custom editor, separating the fields
 * that the standard layout combines. Hand-edited blocks keep their actual text. */
export function customizeTitlePageBlocks(
  nodes: readonly PMNode[],
  schema: Schema,
  data: TpData,
): PMNode[] {
  const titlePage = schema.nodes.titlePage;
  const custom: PMNode[] = [];
  const groups: Record<string, [string, string][]> = {
    author: [
      ['credit', data.tpCredit.trim() || (data.tpWrittenBy ? DEFAULT_TITLE_PAGE_CREDIT : '')],
      ['author', data.tpWrittenBy],
      ['basedOn', data.tpBasedOn],
    ],
    draft: [['draft', data.tpDraft], ['draftDate', data.tpDraftDate]],
    copyright: [['copyright', data.tpCopyright], ['wga', data.tpWgaRegistration]],
  };

  for (const node of nodes) {
    if (node.attrs.tpCustom) {
      custom.push(node);
      continue;
    }
    if (node.type.name === 'screenplayImage') {
      custom.push(node.type.create({ ...node.attrs, tpCustom: true }));
      continue;
    }
    const field = node.type === titlePage ? String(node.attrs.field) : 'blank';
    const fields = groups[field]?.filter(([, value]) => value) ?? [];
    const separator = field === 'draft' ? ' - ' : '\n';
    if (fields.length && node.textContent === fields.map(([, value]) => value).join(separator)) {
      let offset = 0;
      // The draft and date become separate blocks. Use the preceding blank
      // line so the rest of the page can keep its position.
      if (field === 'draft' && fields.length > 1 && custom.at(-1)?.attrs.field === 'blank'
          && !custom.at(-1)?.textContent) custom.pop();
      for (const [part, value] of fields) {
        const end = offset + value.length;
        custom.push(titlePage.create({ field: part, tpCustom: true }, node.content.cut(offset, end)));
        offset = end + separator.length;
      }
      continue;
    }
    custom.push(titlePage.create(
      { field, tpCustom: true, tpTitleFontSize: node.attrs.tpTitleFontSize ?? 12 },
      node.content,
    ));
  }
  return custom;
}

/** Save only the occupied portion of the custom page. Leading and internal
 * blank blocks are its vertical spacing. */
export function trimCustomTitlePage(nodes: readonly PMNode[]): PMNode[] {
  let length = nodes.length;
  while (length > 0) {
    const node = nodes[length - 1];
    if (node.type.name === 'screenplayImage' || node.textContent.trim()) break;
    length--;
  }
  return nodes.slice(0, length);
}

export function padCustomTitlePage(nodes: readonly PMNode[], schema: Schema, linesPerPage: number, widthIn: number): PMNode[] {
  const used = nodes.reduce((total, node) => total + customTitleBlockLines(node, widthIn), 0);
  const blanks = Array.from({ length: Math.max(0, Math.floor(linesPerPage - used)) }, () =>
    schema.nodes.titlePage.create({ field: 'blank', tpCustom: true }));
  return [...nodes, ...blanks];
}

/** What the Standard form showed: its fields and its images. */
export interface StandardTitlePage {
  data: TpData;
  images: { imagesAbove: Record<string, unknown>[]; imagesBelow: Record<string, unknown>[] };
}

const TEXT_KEYS = [
  'tpTitle', 'tpCredit', 'tpWrittenBy', 'tpBasedOn', 'tpDraft', 'tpDraftDate',
  'tpContact', 'tpCopyright', 'tpWgaRegistration', 'tpNotes',
] as const satisfies readonly (keyof TpData)[];

/** The custom blocks that hold a Standard field's text. Notes are read back
 * from the Notes field and from any free text line (see readCustomTitleFields). */
function blocksForKey(nodes: readonly PMNode[], key: typeof TEXT_KEYS[number]): number[] {
  const found: number[] = [];
  nodes.forEach((node, index) => {
    if (node.type.name !== 'titlePage') return;
    const field = String(node.attrs.field);
    if (key === 'tpNotes') {
      if (field === 'date' || (field === 'blank' && node.textContent.trim())) found.push(index);
      else if (!Object.hasOwn(CUSTOM_TITLE_FIELDS, field) && node.textContent.trim()) found.push(index);
    } else if (Object.hasOwn(CUSTOM_TITLE_FIELDS, field)
        && CUSTOM_TITLE_FIELDS[field as keyof typeof CUSTOM_TITLE_FIELDS] === key) {
      found.push(index);
    }
  });
  return found;
}

/**
 * Carry edits made in the Standard form into the custom draft the writer left.
 *
 * `before` is what the Standard form showed on arrival from the custom page
 * (that is, what the draft reads as), `after` what it shows now. Every changed
 * field is written into the one custom block holding it, keeping the custom
 * arrangement and the block's own formatting. Nothing changed: the draft comes
 * back as it is. Returns null when an edit has no single block to go into — a
 * field the custom page does not show, notes spread over several lines, or an
 * image added, removed or moved — and the caller has to rebuild the custom page
 * from the Standard fields instead.
 */
export function applyStandardEdits(
  draft: readonly PMNode[],
  schema: Schema,
  before: StandardTitlePage,
  after: StandardTitlePage,
): PMNode[] | null {
  if (JSON.stringify(before.images) !== JSON.stringify(after.images)) return null;
  const updated = [...draft];
  for (const key of TEXT_KEYS) {
    const was = before.data[key] ?? '';
    const now = after.data[key] ?? '';
    if (was === now) continue;
    const blocks = blocksForKey(updated, key);
    if (blocks.length !== 1) return null;
    updated[blocks[0]] = replaceBlockText(updated[blocks[0]], now, schema);
  }
  const size = Number(after.data.tpTitleFontSize) || 12;
  if ((Number(before.data.tpTitleFontSize) || 12) !== size) {
    const titles = blocksForKey(updated, 'tpTitle');
    if (titles.length !== 1) return null;
    const title = updated[titles[0]];
    updated[titles[0]] = title.type.create({ ...title.attrs, tpTitleFontSize: size }, title.content, title.marks);
  }
  return updated;
}
