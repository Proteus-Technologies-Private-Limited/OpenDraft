/**
 * The document a PDF export of chosen scenes is drawn from.
 *
 * A selection keeps the title page, then only the scenes asked for, in script
 * order; the page count starts again at 1 because the file no longer holds the
 * pages before it. "One scene per page" is applied here as the same
 * `startsNewPage` attribute the writer can set by hand, so the PDF lays the
 * selection out exactly as the editor's pagination would.
 *
 * Two things around scene boundaries are easy to get wrong, and both are
 * handled here:
 *
 * - the opening matter before the first heading ("FADE IN:", a first action)
 *   belongs to the script, so it is kept when the export starts at scene 1;
 * - an act break written just before a heading belongs to that scene, not to
 *   the scene before it.
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

/** The headings of a document, in order, for anything that numbers scenes. */
export function sceneHeadings(doc: JSONContent): string[] {
  return (doc.content ?? [])
    .filter((node) => node.type === 'sceneHeading')
    .map((node) => jsonBlockText(node).trim());
}

/**
 * Where each scene really starts, for slicing. An act break written directly
 * before a heading is part of that scene: it opens the act the scene belongs to,
 * so a slice that starts at the heading would leave it behind in the previous
 * scene.
 */
function sceneStarts(content: JSONContent[], headings: number[]): number[] {
  return headings.map((heading, index) => {
    if (index === 0) return heading;
    let start = heading;
    while (start > 0 && content[start - 1]?.type === 'newAct') start -= 1;
    return start;
  });
}

/** Mark a block so the exported page opens there. */
function withPageBreak(node: JSONContent): JSONContent {
  return { ...node, attrs: { ...(node.attrs ?? {}), startsNewPage: true } };
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

  const region = findTitlePageRegion(content.map((node) => ({
    type: node.type || 'general',
    hasText: jsonBlockText(node).trim().length > 0,
    hasTitleData: titlePageAttrsCarryData(node.attrs as Record<string, unknown> | undefined),
  })));
  const titleNodes = region.length > 0 ? content.slice(0, region.length) : [];

  const valid = [...new Set(picked)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < headings.length)
    .sort((a, b) => a - b);
  // Nothing picked, or indices that belong to another document: export the
  // title page only. Falling back to the whole script would send scenes the
  // writer did not choose.
  if (valid.length === 0) return { ...doc, content: titleNodes };

  const fullScript = valid.length === headings.length;
  if (fullScript && !oneScenePerPage) return doc;

  const starts = sceneStarts(content, headings);
  const body: JSONContent[] = [];
  // The matter before the first heading belongs to the opening of the script,
  // not to scene 1; keep it only when the export really starts there.
  if (valid[0] === 0) {
    body.push(...content.slice(titleNodes.length, starts[0]));
  }
  for (const index of valid) {
    const start = starts[index];
    // Each scene ends where the next one begins, act break included, so no
    // block is copied into two slices.
    const end = index + 1 < starts.length ? starts[index + 1] : content.length;
    for (let i = start; i < end; i++) {
      // The break goes on the block the scene opens with: a heading, or the
      // act break written before it.
      body.push(oneScenePerPage && i === start ? withPageBreak(content[i]) : content[i]);
    }
  }

  return {
    ...doc,
    content: [...titleNodes, ...body],
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
