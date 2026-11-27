import type { JSONContent } from '@tiptap/core';
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { jsonBlockText } from './nodeText';
import { findTitlePageRegion, titlePageNodeInfo } from './titlePageRegion';
import { getTextLines } from './wrapText';

export const TITLE_PAGE_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type TitlePageAlignment = (typeof TITLE_PAGE_ALIGNMENTS)[number];

export const CUSTOM_TITLE_FIELDS = {
  title: 'tpTitle', // i18n-ignore: internal field name
  credit: 'tpCredit',
  author: 'tpWrittenBy',
  basedOn: 'tpBasedOn',
  draft: 'tpDraft',
  draftDate: 'tpDraftDate',
  contact: 'tpContact',
  copyright: 'tpCopyright',
  wga: 'tpWgaRegistration',
  date: 'tpNotes',
  blank: 'tpNotes',
} as const;

type TitlePageDataKey = typeof CUSTOM_TITLE_FIELDS[keyof typeof CUSTOM_TITLE_FIELDS];
type CustomTitleFields = Partial<Record<TitlePageDataKey, string>> & { tpTitleFontSize?: number };

/** The extra custom fields use the same typography as their standard blocks. */
export function titlePageStyleField(field: string): string {
  switch (field) {
    case 'credit':
    case 'basedOn': return 'author';
    case 'draftDate': return 'draft';
    case 'wga': return 'copyright';
    default: return field;
  }
}

export function titlePageAlignment(field: string, override?: unknown): TitlePageAlignment {
  if (override === 'left' || override === 'center' || override === 'right') return override;
  const styleField = titlePageStyleField(field);
  if (styleField === 'draft') return 'left';
  if (styleField === 'contact' || styleField === 'copyright') return 'right';
  return 'center';
}

export function isCustomTitlePageNode(node: JSONContent): boolean {
  return node.type === 'titlePage' && node.attrs?.tpCustom === true;
}

/** Get the current visible text for formats that serialize title page fields. */
export function readCustomTitleFields(nodes: readonly JSONContent[]): CustomTitleFields | null {
  if (!nodes.some(isCustomTitlePageNode)) return null;
  const region = findTitlePageRegion(nodes.map(node =>
    titlePageNodeInfo(node.type ?? '', jsonBlockText(node), node.attrs),
  ));
  const fields: CustomTitleFields = {};
  let custom = false;
  for (const node of nodes.slice(0, region.length)) {
    if (!isCustomTitlePageNode(node)) continue;
    custom = true;
    const text = jsonBlockText(node).trim();
    if (!text) continue;
    const field = String(node.attrs?.field);
    const key = Object.hasOwn(CUSTOM_TITLE_FIELDS, field)
      ? CUSTOM_TITLE_FIELDS[field as keyof typeof CUSTOM_TITLE_FIELDS] : 'tpNotes';
    const existing = fields[key];
    fields[key] = existing ? `${existing}\n${text}` : text;
    if (field === 'title' && !existing) fields.tpTitleFontSize = Number(node.attrs?.tpTitleFontSize) || 12;
  }
  return custom ? fields : null;
}

/** Height of a block on the title page's 12-point grid. */
export function titlePageTextSize(field: string, size?: unknown): number {
  return field === 'title' ? (Number(size) || 12) : 12;
}

export function titlePageTextLines(text: string, widthIn: number, size: number): string[] {
  const columns = Math.max(2, Math.floor(widthIn * 120 / size));
  return text.split('\n').flatMap(line => {
    const starts: number[] = [];
    getTextLines(line, columns, offset => starts.push(offset));
    return starts.map((start, i) => line.slice(start, starts[i + 1]).trimEnd());
  });
}

export function customTitleBlockLines(node: PMNode, widthIn: number): number {
  if (node.type.name === 'screenplayImage') return Math.max(1, Number(node.attrs.heightLines) || 8);
  const size = titlePageTextSize(node.attrs.field, node.attrs.tpTitleFontSize);
  const text = node.attrs.field === 'title' ? node.textContent.toUpperCase() : node.textContent;
  return titlePageTextLines(text, widthIn, size).length * size / 12;
}

/** Position inside `content` of the character at text offset `offset`. */
function textOffsetToPos(content: Fragment, offset: number): number {
  let text = 0;
  let pos = 0;
  for (let i = 0; i < content.childCount && text < offset; i++) {
    const child = content.child(i);
    const length = child.textContent.length;
    if (child.isText && text + length > offset) return pos + (offset - text);
    text += length;
    pos += child.nodeSize;
  }
  return pos;
}

/** The marks the character at text offset `offset` carries, or null past the end. */
function marksAtText(content: Fragment, offset: number): PMNode['marks'] | null {
  let text = 0;
  for (let i = 0; i < content.childCount; i++) {
    const child = content.child(i);
    const length = child.textContent.length;
    if (offset < text + length) return child.isText ? child.marks : null;
    text += length;
  }
  return null;
}

/**
 * Replace a block's text with `text` while keeping the formatting of every run
 * the edit did not touch: the common prefix and suffix are kept as they are
 * (marks, hard breaks and all) and only the changed middle is rebuilt, carrying
 * the marks of the character it follows — what typing into the block would do.
 */
export function replaceBlockText(node: PMNode, text: string, schema: Schema): PMNode {
  const old = node.textContent;
  if (old === text) return node;
  if (!text) return node.type.create(node.attrs, null, node.marks);
  const max = Math.min(old.length, text.length);
  let prefix = 0;
  while (prefix < max && old[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && old[old.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;
  const content = node.content;
  const start = textOffsetToPos(content, prefix);
  const end = textOffsetToPos(content, old.length - suffix);
  // A non-text leaf (a hard break) straddling either cut is kept whole rather
  // than split; fall back to rebuilding the text when the cut cannot be made.
  if (end < start) return node.type.create(node.attrs, schema.text(text, content.firstChild?.marks), node.marks);
  const inserted = text.slice(prefix, text.length - suffix);
  const marks = (prefix > 0 ? marksAtText(content, prefix - 1) : null)
    ?? marksAtText(content, prefix)
    ?? content.firstChild?.marks
    ?? [];
  let rebuilt = content.cut(0, start);
  if (inserted) rebuilt = rebuilt.append(Fragment.from(schema.text(inserted, marks)));
  rebuilt = rebuilt.append(content.cut(end));
  return node.type.create(node.attrs, rebuilt, node.marks);
}

/**
 * Move the block at `from` so its first line lands on line `toLine` of the
 * custom title page (1-based, as the Move-to-line list numbers them).
 *
 * When the lines it moves onto are all blank spacer lines, it trades places
 * with them, so nothing else on the page moves. Otherwise it is taken out and
 * re-inserted before the first block that, once it is gone, starts on or below
 * `toLine` — the rows below it have moved up by its height, which a plain
 * remove-and-insert at the old index ignores. Past the last block it goes at
 * the end. Returns the rows and the block's new index.
 */
export function moveCustomTitleBlock(
  rows: readonly PMNode[],
  from: number,
  toLine: number,
  widthIn: number,
  isSpacer: (node: PMNode) => boolean,
): { rows: PMNode[]; index: number } {
  const item = rows[from];
  if (!item) return { rows: [...rows], index: from };
  const lines = rows.map(node => customTitleBlockLines(node, widthIn));
  const starts: number[] = [];
  let next = 1;
  for (const height of lines) { starts.push(Math.ceil(next)); next += height; }
  if (starts[from] === toLine) return { rows: [...rows], index: from };

  const height = lines[from];
  const target = starts.indexOf(toLine);
  if (target >= 0 && Number.isInteger(height)) {
    const span = rows.slice(target, target + height);
    const free = span.length === height
      && (target + height <= from || target > from)
      && span.every(node => isSpacer(node));
    if (free) {
      const updated = [...rows];
      // Replace the far one first so the near index stays valid.
      if (target > from) {
        updated.splice(target, height, item);
        updated.splice(from, 1, ...span);
        // The spacers that took its old place push it down by height - 1 rows.
        return { rows: updated, index: target + height - 1 };
      }
      updated.splice(from, 1, ...span);
      updated.splice(target, height, item);
      return { rows: updated, index: target };
    }
  }

  const rest = rows.filter((_, index) => index !== from);
  let line = 1;
  let index = rest.length;
  for (let i = 0; i < rest.length; i++) {
    if (Math.ceil(line) >= toLine) { index = i; break; }
    line += customTitleBlockLines(rest[i], widthIn);
  }
  rest.splice(index, 0, item);
  return { rows: rest, index };
}
