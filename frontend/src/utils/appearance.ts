/**
 * The app's appearance: Light, Dark, or Dark Pages (dark interface AND dark
 * script pages).
 *
 * Two attributes on <html> carry it, and this module is the only writer:
 *  - `data-theme` is `light` or `dark` — every existing `[data-theme=…]` rule
 *    keys off it, so Dark Pages deliberately reports `dark` here;
 *  - `data-dark-pages` is `on` only for Dark Pages, and switches the page
 *    tokens (`--page-paper`, `--page-ink`, …) in screenplay.css.
 *
 * The choice is remembered in localStorage under the same key the light/dark
 * toggle always used, so a saved `light` or `dark` from an older version loads
 * unchanged.
 */

export type Appearance = 'light' | 'dark' | 'dark-pages';

export const APPEARANCE_STORAGE_KEY = 'opendraft:theme';

const VALID: readonly Appearance[] = ['light', 'dark', 'dark-pages'];

export function isAppearance(v: unknown): v is Appearance {
  return typeof v === 'string' && (VALID as readonly string[]).includes(v);
}

/** The `data-theme` value for an appearance. */
export function themeOf(a: Appearance): 'light' | 'dark' {
  return a === 'light' ? 'light' : 'dark';
}

/** The remembered appearance, or `dark` (the app's default) if none/unknown. */
export function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearance(saved) ? saved : 'dark';
  } catch (err) {
    console.warn('[appearance] could not read the saved appearance', err);
    return 'dark';
  }
}

/** Remember the choice. A storage failure is logged; the switch still happens. */
export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, a);
  } catch (err) {
    console.warn('[appearance] could not save the appearance', err);
  }
}

/** Put the appearance on <html>. */
export function applyAppearance(a: Appearance, root: Pick<Element, 'setAttribute'> = document.documentElement): void {
  root.setAttribute('data-theme', themeOf(a));
  root.setAttribute('data-dark-pages', a === 'dark-pages' ? 'on' : 'off');
}
