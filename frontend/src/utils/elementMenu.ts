/**
 * Asking for the element menu from outside the editor.
 *
 * Enter on a blank line is the menu's usual route, but that route is gone for
 * anyone who has switched it off, and it never existed on a line with text on
 * it. A window event lets the Format menu, the right-click menu and the
 * configurable shortcut all reach the same menu without any of them needing a
 * handle on the editor (issue #100).
 */
export const ELEMENT_MENU_EVENT = 'opendraft:element-menu';

export function requestElementMenu(): void {
  window.dispatchEvent(new CustomEvent(ELEMENT_MENU_EVENT));
}

/** Shipped default: free on every platform, and Enter-shaped like the menu it opens. */
export const DEFAULT_ELEMENT_MENU_SHORTCUT = 'Alt-Enter';
