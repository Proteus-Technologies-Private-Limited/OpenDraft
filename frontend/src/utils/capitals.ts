/**
 * The elements the page prints in capitals, and the pass that puts a whole
 * script in capitals.
 *
 * FDX styles — scene heading, character, transition, shot, new act, end of act,
 * cast list — capitalise their text. OpenDraft's stylesheet did too, so the
 * page looked right while the stored text kept whatever case the writer typed:
 * the scene navigator and the Word and Final Draft exports showed the lower
 * case. New lines are normalised as they are left (editor/extensions/
 * AutoUppercase); this module is the one-time pass for scripts written before
 * that, run on every save and export.
 *
 * Pure and dependency-free, so it can be tested without an editor.
 */
import type { JSONContent } from '@tiptap/react';

/** The element types whose text is printed in capitals. */
export const UPPERCASE_ELEMENT_TYPES: ReadonlySet<string> = new Set([
  'sceneHeading', 'character', 'transition', 'shot', 'newAct', 'endOfAct', 'castList',
]);

export function isUppercaseElement(type: string): boolean {
  return UPPERCASE_ELEMENT_TYPES.has(type);
}

/**
 * A copy of `doc` with the text of every capitals element in capitals.
 *
 * Marks, attributes and every other element are left exactly as they were, and
 * the original object is returned when there is nothing to change — so a save
 * of an already-normalised script does no work and no test snapshots move.
 */
export function normalizeCapitalsJSON(doc: JSONContent): JSONContent {
  let changed = false;

  const walk = (node: JSONContent): JSONContent => {
    if (!node.content) return node;
    const capital = node.type ? isUppercaseElement(node.type) : false;
    const content = node.content.map((child) => {
      if (capital && child.type === 'text' && typeof child.text === 'string') {
        const upper = child.text.toUpperCase();
        if (upper !== child.text) {
          changed = true;
          return { ...child, text: upper };
        }
        return child;
      }
      return walk(child);
    });
    return content.some((child, i) => child !== node.content?.[i])
      ? { ...node, content }
      : node;
  };

  const result = walk(doc);
  return changed ? result : doc;
}
