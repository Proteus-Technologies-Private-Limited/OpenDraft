/**
 * Flat-text view of the document for find & replace, plus the position map
 * that takes a match back to ProseMirror coordinates.
 *
 * Extracted from SearchReplace.tsx so it can be unit-tested — the vitest setup
 * only collects `*.test.ts` and runs without a DOM.
 *
 * Hard breaks matter here in a way `leafText` does not solve: this walker never
 * calls `textContent`, it visits nodes directly. Without an explicit arm, a
 * `hardBreak` contributes nothing to the haystack, so `NIGHT<br>FALL` reads as
 * `NIGHTFALL` and matches a search for "nightfall" that the writer never typed.
 */
import type { Node as PMNode } from '@tiptap/pm/model';

export interface MatchResult {
  from: number;
  to: number;
}

/**
 * Walk the doc and build a flat text string plus `map[flatIndex] → PM position`.
 *
 * Invariant: `map.length === text.length`. Every character appended to `text`
 * pushes exactly one entry, so a match's start and end indices always resolve.
 * A `-1` entry marks a boundary a match must not span.
 */
export function buildTextMap(doc: PMNode): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText) {
      const t = node.text!;
      for (let i = 0; i < t.length; i++) map.push(pos + i);
      text += t;
    } else if (node.isLeaf && !node.isText) {
      // Inline leaves — hardBreak today, any future inline atom. Tested BEFORE
      // the isBlock arm, and keyed on isLeaf rather than isInline, so a new
      // atom is covered automatically instead of silently gluing words.
      map.push(-1);
      text += '\n';
    } else if (node.isBlock && text.length > 0) {
      // Insert a sentinel so searches don't span across blocks
      map.push(-1);
      text += '\n';
    }
  });

  return { text, map };
}

export function findAllMatches(
  doc: PMNode,
  searchTerm: string,
  matchCase: boolean,
  wholeWord: boolean,
): MatchResult[] {
  if (!searchTerm) return [];

  const { text, map } = buildTextMap(doc);
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? searchTerm : searchTerm.toLowerCase();
  const results: MatchResult[] = [];

  /**
   * Resolve a flat-index span to a PM range. Returns null when the span
   * touches a sentinel — i.e. the match would cross a block boundary or a
   * hard break, which is never a real match.
   */
  const resolve = (start: number, length: number): MatchResult | null => {
    for (let i = start; i < start + length; i++) {
      if (map[i] < 0) return null;
    }
    const from = map[start];
    const to = map[start + length - 1] + 1;
    if (from < 0 || to <= from) return null;
    return { from, to };
  };

  if (wholeWord) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, matchCase ? 'g' : 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(haystack)) !== null) {
      const hit = resolve(m.index, needle.length);
      if (hit) results.push(hit);
    }
  } else {
    let idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
      const hit = resolve(idx, needle.length);
      if (hit) results.push(hit);
      idx += 1;
    }
  }

  return results;
}
