/**
 * The element shortcuts: Mod-1 through Mod-8 set the element type of the line
 * the caret is on.
 *
 * One list, shared by the editor's keymap, the toolbar's element dropdown and
 * the element menu, so the shortcut and the name printed beside it cannot drift
 * apart. The order is the order the shortcuts have always had.
 */

/** Elements set by Mod-1 … Mod-8, in that order. */
export const ELEMENT_SHORTCUT_TYPES = [
  'sceneHeading', 'action', 'character', 'dialogue',
  'parenthetical', 'transition', 'general', 'shot',
] as const;

export type ElementShortcutType = typeof ELEMENT_SHORTCUT_TYPES[number];

/** The shortcut spec for an element id, or null when it has none. */
export function elementShortcutSpec(id: string): string | null {
  const index = ELEMENT_SHORTCUT_TYPES.indexOf(id as ElementShortcutType);
  return index < 0 ? null : `Mod-${index + 1}`;
}
