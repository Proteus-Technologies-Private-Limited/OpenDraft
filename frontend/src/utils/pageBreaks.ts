/**
 * Forced page breaks — shared by the PDF and DOCX exporters so both agree with
 * the editor's pagination plugin (editor/pagination.ts).
 *
 * An element opens a new page when either:
 *   - the writer flagged it manually (`startsNewPage` attribute, Format →
 *     Start On New Page), or
 *   - the active formatting template lists its element id in `forceBreakBefore`
 *     (e.g. TV formats break before every New Act).
 */

import type { JSONContent } from '@tiptap/react';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';

/** Minimal node shape both exporters can satisfy. */
export interface BreakableNode {
  type?: string;
  attrs?: Record<string, unknown> | null;
}

/** Effective element id — custom elements are keyed by their template rule id. */
export function elementIdOf(node: BreakableNode): string {
  const typeName = node.type || 'general';
  if (typeName === 'customElement') {
    const id = node.attrs?.customTypeId;
    if (typeof id === 'string' && id) return id;
  }
  return typeName;
}

/**
 * Element ids the active formatting template requires to start a new page.
 * Read lazily and defensively: exporters must still produce a document when the
 * template store has not been hydrated (tests, headless export).
 */
export function getForceBreakIds(): Set<string> {
  try {
    const tpl = useFormattingTemplateStore.getState().getActiveTemplate();
    return new Set(tpl.forceBreakBefore ?? []);
  } catch (err) {
    console.warn('[pageBreaks] could not read template page-break rules', err);
    return new Set();
  }
}

/** True when this node must open its own page. */
export function startsOwnPage(node: BreakableNode, forceBreakIds: Set<string>): boolean {
  if (node.attrs?.startsNewPage === true) return true;
  return forceBreakIds.has(elementIdOf(node));
}

/** Convenience wrapper for callers holding Tiptap JSON. */
export function jsonStartsOwnPage(node: JSONContent, forceBreakIds: Set<string>): boolean {
  return startsOwnPage(node as BreakableNode, forceBreakIds);
}
