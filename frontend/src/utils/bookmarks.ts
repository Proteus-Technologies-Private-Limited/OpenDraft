/**
 * Script bookmarks — named places in the script a writer can jump back to.
 *
 * A bookmark is a `bookmark` attribute on the element it marks (see
 * editor/extensions/Bookmark.ts), not a separate list beside the document. So
 * it is saved with the script, shared with collaborators through Yjs, moves
 * with its element when text is added above it, and goes when its element is
 * deleted — nothing to keep in step.
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { singleLine } from './nodeText';

/** Element types that can carry a bookmark: every text element but the title page. */
export const BOOKMARKABLE_TYPES = [
  'sceneHeading', 'action', 'character', 'dialogue', 'parenthetical',
  'transition', 'general', 'shot', 'newAct', 'endOfAct', 'lyrics',
  'showEpisode', 'castList', 'section', 'note', 'customElement',
  'avPara', 'avShot', 'avDirection', 'avGraphic',
] as const;

const BOOKMARKABLE = new Set<string>(BOOKMARKABLE_TYPES);

/** Longest name a bookmark is given. */
export const MAX_BOOKMARK_NAME = 80;

export interface ScriptBookmark {
  name: string;
  /** Position of the bookmarked element (before its opening token). */
  pos: number;
  /** Node type of the element, e.g. `sceneHeading`. */
  blockType: string;
  /** The element's text on one line. */
  text: string;
}

export function isBookmarkable(node: PMNode): boolean {
  return BOOKMARKABLE.has(node.type.name);
}

/** A name as stored: one line, trimmed, capped. Empty means no bookmark. */
export function cleanBookmarkName(name: string): string {
  return singleLine(name).replace(/\s+/g, ' ').slice(0, MAX_BOOKMARK_NAME).trim();
}

/** Every bookmark in the script, in script order. */
export function listBookmarks(doc: PMNode): ScriptBookmark[] {
  const out: ScriptBookmark[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      const name = node.attrs.bookmark;
      if (typeof name === 'string' && name && isBookmarkable(node)) {
        out.push({ name, pos, blockType: node.type.name, text: singleLine(node.textContent) });
      }
      return false;
    }
    return true;
  });
  return out;
}

/**
 * The bookmarkable element holding `pos` — the innermost text element, so a
 * line of dual dialogue or an AV cell is marked rather than its container.
 */
export function bookmarkTargetAt(doc: PMNode, pos: number): { pos: number; node: PMNode } | null {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.isTextblock) return isBookmarkable(node) ? { pos: $pos.before(d), node } : null;
  }
  return null;
}

/** `base`, or `base 2`, `base 3`… — whichever is not already a bookmark. */
export function uniqueBookmarkName(doc: PMNode, base: string, except?: number): string {
  const taken = new Set(listBookmarks(doc).filter((b) => b.pos !== except).map((b) => b.name.toLowerCase()));
  const clean = cleanBookmarkName(base) || 'Bookmark';
  if (!taken.has(clean.toLowerCase())) return clean;
  for (let n = 2; ; n++) {
    const candidate = `${clean.slice(0, MAX_BOOKMARK_NAME - String(n).length - 1)} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** What a new bookmark on `node` is called until the writer names it. */
export function suggestBookmarkName(doc: PMNode, node: PMNode): string {
  const text = singleLine(node.textContent);
  let base = text.split(' ').slice(0, 8).join(' ');
  if (base.length > 40) base = base.slice(0, 40).trim();
  if (base.length < text.length) base += '…';
  return uniqueBookmarkName(doc, base || 'Bookmark');
}

/**
 * Sets (a non-empty name) or clears (`null` or empty) the bookmark on the
 * element at `pos`. Returns false when there is no bookmarkable element there.
 */
export function setBookmark(tr: Transaction, pos: number, name: string | null): boolean {
  const node = tr.doc.nodeAt(pos);
  if (!node || !node.isTextblock || !isBookmarkable(node)) return false;
  const value = name ? cleanBookmarkName(name) || null : null;
  if ((node.attrs.bookmark ?? null) === value) return true;
  tr.setNodeAttribute(pos, 'bookmark', value);
  return true;
}
