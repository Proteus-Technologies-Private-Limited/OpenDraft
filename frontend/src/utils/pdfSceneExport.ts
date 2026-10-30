/**
 * The document a PDF export of chosen scenes is drawn from.
 *
 * A selection keeps the title page, then only the scenes asked for, in script
 * order; the page count starts again at 1 because the file no longer holds the
 * pages before it. "One scene per page" is applied here as the same
 * `startsNewPage` attribute the writer can set by hand, so the PDF lays the
 * selection out exactly as the editor's pagination would.
 */
import type { JSONContent } from '@tiptap/react';
import { findTitlePageRegion, titlePageAttrsCarryData } from './titlePageRegion';
import { jsonBlockText } from './nodeText';

export interface SceneExportRange {
  /** 0-based index of the first scene, in document order. */
  from: number;
  /** 0-based index of the last scene, inclusive. */
  to: number;
  /** Break before every scene heading, so each scene opens its own page. */
  oneScenePerPage: boolean;
}

export interface SceneExportSelection {
  /** 0-based scene indices, in any order; duplicates and strays are ignored. */
  scenes: number[];
  /** Break before every scene heading, so each scene opens its own page. */
  oneScenePerPage: boolean;
}

function headingIndices(content: JSONContent[]): number[] {
  const headings: number[] = [];
  content.forEach((node, index) => {
    if (node.type === 'sceneHeading') headings.push(index);
  });
  return headings;
}

/**
 * Keep the title-page region and the picked scenes. Picked scenes are written
 * in script order, so a hand-picked set reads as the script does rather than
 * in the order the boxes were ticked.
 */
function selectedScenesDocument(
  doc: JSONContent,
  picked: ReadonlySet<number>,
  oneScenePerPage: boolean,
): JSONContent {
  const content = doc.content ?? [];
  const headings = headingIndices(content);
  if (headings.length === 0) return doc;

  const ordered = headings
    .map((_, index) => index)
    .filter((index) => picked.has(index));
  // Nothing picked is a caller error; the dialog never sends it. Exporting the
  // whole script is the least surprising fallback.
  if (ordered.length === 0) return doc;

  const fullScript = ordered.length === headings.length;
  if (fullScript && !oneScenePerPage) return doc;

  const region = findTitlePageRegion(content.map((node) => ({
    type: node.type || 'general',
    hasText: jsonBlockText(node).trim().length > 0,
    hasTitleData: titlePageAttrsCarryData(node.attrs as Record<string, unknown> | undefined),
  })));
  const titleNodes = region.length > 0 ? content.slice(0, region.length) : [];

  const body: JSONContent[] = [];
  for (const index of ordered) {
    const start = headings[index];
    const end = index + 1 < headings.length ? headings[index + 1] : content.length;
    for (let i = start; i < end; i++) body.push(content[i]);
  }

  return {
    ...doc,
    content: [
      ...titleNodes,
      ...body.map((node) => (
        oneScenePerPage && node.type === 'sceneHeading'
          ? { ...node, attrs: { ...(node.attrs ?? {}), startsNewPage: true } }
          : node
      )),
    ],
  };
}

export function sceneRangeDocument(doc: JSONContent, range: SceneExportRange): JSONContent {
  const headings = headingIndices(doc.content ?? []);
  if (headings.length === 0) return doc;
  const first = Math.max(0, Math.min(range.from, headings.length - 1));
  const last = Math.max(first, Math.min(range.to, headings.length - 1));
  const picked = new Set<number>();
  for (let index = first; index <= last; index++) picked.add(index);
  return selectedScenesDocument(doc, picked, range.oneScenePerPage);
}

export function sceneSelectionDocument(doc: JSONContent, selection: SceneExportSelection): JSONContent {
  return selectedScenesDocument(doc, new Set(selection.scenes), selection.oneScenePerPage);
}
