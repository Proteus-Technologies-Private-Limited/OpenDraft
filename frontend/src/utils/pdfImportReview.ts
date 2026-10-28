/**
 * Looking over a PDF import before it opens.
 *
 * A PDF holds no elements, only text on a page, so utils/pdfImport reads each
 * line's element from its indent and what it says — and a script laid out in
 * an unusual way can come in with a run of dialogue read as action, or a
 * centred title read as a cue. Fixing that after the import is one line at a
 * time; here the writer sees every element the import found and can set the
 * type of one or many at once, before anything reaches the editor.
 *
 * Only the element type changes. The text stays exactly as it was read.
 */
import type { JSONContent } from '@tiptap/react';
import { jsonBlockText, singleLine } from './nodeText';

/** The types a reviewed element can be set to: those a PDF import produces, and their near relations. */
export const REVIEW_TYPES = [
  'sceneHeading', 'action', 'character', 'parenthetical', 'dialogue',
  'transition', 'shot', 'general', 'lyrics',
] as const;

export type ReviewType = (typeof REVIEW_TYPES)[number];

export interface ReviewRow {
  /** Position in the document's top-level content. */
  index: number;
  type: string;
  /** The element's text on one line. */
  text: string;
  /**
   * False for what cannot simply change type — the title page, dual
   * dialogue — which is shown for context and imported as read.
   */
  editable: boolean;
}

const isReviewType = (type: string | undefined): type is ReviewType =>
  !!type && (REVIEW_TYPES as readonly string[]).includes(type);

/** One row per element of the imported document, in order. */
export function reviewRows(doc: JSONContent): ReviewRow[] {
  const rows: ReviewRow[] = [];
  (doc.content ?? []).forEach((node, index) => {
    const type = node.type ?? '';
    if (type === 'titlePage') {
      // A title page is several blocks; one row stands for all of them.
      if (rows[rows.length - 1]?.type !== 'titlePage') rows.push({ index, type, text: 'Title page', editable: false });
      return;
    }
    if (type === 'dualDialogue') {
      const cues = (node.content ?? [])
        .map((col) => (col.content ?? []).find((c) => c.type === 'character'))
        .map((c) => (c ? singleLine(jsonBlockText(c)).trim() : ''))
        .filter(Boolean);
      rows.push({ index, type, text: cues.join(' / '), editable: false });
      return;
    }
    rows.push({ index, type, text: singleLine(jsonBlockText(node)).trim(), editable: isReviewType(type) });
  });
  return rows;
}

/**
 * The document with the chosen elements set to new types. Attributes that
 * only mean something on the old type go: a scene number off a line that is
 * no longer a heading, centring off one that is no longer action.
 */
export function retypeImport(doc: JSONContent, changes: ReadonlyMap<number, ReviewType>): JSONContent {
  if (changes.size === 0) return doc;
  const content = (doc.content ?? []).map((node, index) => {
    const type = changes.get(index);
    if (!type || !isReviewType(node.type) || type === node.type) return node;
    const attrs: Record<string, unknown> = { ...(node.attrs ?? {}) };
    if (type !== 'sceneHeading') delete attrs.sceneNumber;
    if (type !== 'action' && type !== 'general') delete attrs.textAlign;
    const next: JSONContent = { ...node, type };
    if (Object.keys(attrs).length > 0) next.attrs = attrs;
    else delete next.attrs;
    return next;
  });
  return { ...doc, content };
}

/** How many elements of each type, for the summary over the list. */
export function typeCounts(rows: ReviewRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.type, (counts.get(r.type) ?? 0) + 1);
  return counts;
}
