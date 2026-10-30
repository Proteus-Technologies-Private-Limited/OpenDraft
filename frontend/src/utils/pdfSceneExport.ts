/**
 * The document a PDF export of a scene range is drawn from.
 *
 * A range export keeps the title page, then only the scenes asked for; the
 * page count starts again at 1 because the file no longer holds the pages
 * before it. "One scene per page" is applied here as the same `startsNewPage`
 * attribute the writer can set by hand, so the PDF lays the range out exactly
 * as the editor's pagination would.
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

export function sceneRangeDocument(doc: JSONContent, range: SceneExportRange): JSONContent {
  const content = doc.content ?? [];
  const headings: number[] = [];
  content.forEach((node, index) => {
    if (node.type === 'sceneHeading') headings.push(index);
  });
  if (headings.length === 0) return doc;

  const first = Math.max(0, Math.min(range.from, headings.length - 1));
  const last = Math.max(first, Math.min(range.to, headings.length - 1));
  const fullScript = first === 0 && last === headings.length - 1;

  if (fullScript) {
    if (!range.oneScenePerPage) return doc;
    return {
      ...doc,
      content: content.map((node) => (
        node.type === 'sceneHeading'
          ? { ...node, attrs: { ...(node.attrs ?? {}), startsNewPage: true } }
          : node
      )),
    };
  }

  const start = headings[first];
  const end = last + 1 < headings.length ? headings[last + 1] : content.length;

  // The leading title-page run stays: a range still opens with its title page
  // when the writer asked for one.
  const region = findTitlePageRegion(content.map((node) => ({
    type: node.type || 'general',
    hasText: jsonBlockText(node).trim().length > 0,
    hasTitleData: titlePageAttrsCarryData(node.attrs as Record<string, unknown> | undefined),
  })));
  const titleNodes = region.length > 0 ? content.slice(0, Math.min(region.length, start)) : [];

  const body = content.slice(start, end).map((node) => (
    range.oneScenePerPage && node.type === 'sceneHeading'
      ? { ...node, attrs: { ...(node.attrs ?? {}), startsNewPage: true } }
      : node
  ));

  return { ...doc, content: [...titleNodes, ...body] };
}
