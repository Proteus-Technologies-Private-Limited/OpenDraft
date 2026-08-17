/**
 * Test helpers for the title-page region.
 *
 * A title page is a *run* of `titlePage` nodes, not one node, so tests must not
 * assume it sits at `content[0]` or that it is a single element. They used to,
 * which made them pass only for the collapsed attrs-only node the importers
 * produced before issue #52 — precisely the shape that exported as a blank page.
 *
 * Asserting through `findTitlePageRegion` keeps the tests pinned to the contract
 * the app actually uses rather than to a node count, so they survive changes to
 * the layout arithmetic and to the stray-line tolerance.
 */
import type { JSONContent } from '@tiptap/react';
import {
  findTitlePageRegion,
  titlePageAttrsCarryData,
  type TitlePageRegion,
} from '../utils/titlePageRegion';

const plainText = (node: JSONContent): string =>
  (node.content ?? []).map((child) => child.text ?? '').join('');

/** Resolve a parsed document's title-page region the way the app does. */
export function titleRegionOf(parsed: JSONContent): TitlePageRegion {
  return findTitlePageRegion(
    (parsed.content ?? []).map((node) => ({
      type: node.type as string,
      hasText: plainText(node).trim().length > 0,
      hasTitleData: titlePageAttrsCarryData(node.attrs as Record<string, unknown> | undefined),
    })),
  );
}

/** The one node in the run that carries the structured fields. */
export function titleNodeOf(parsed: JSONContent): JSONContent | undefined {
  return (parsed.content ?? []).find(
    (node) =>
      node.type === 'titlePage' &&
      titlePageAttrsCarryData(node.attrs as Record<string, unknown> | undefined),
  );
}

/** Element types of everything after the title page, in order. */
export function bodyTypesOf(parsed: JSONContent): string[] {
  const { length } = titleRegionOf(parsed);
  return (parsed.content ?? []).slice(length).map((node) => node.type as string);
}
