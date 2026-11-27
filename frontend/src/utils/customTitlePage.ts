import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
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
