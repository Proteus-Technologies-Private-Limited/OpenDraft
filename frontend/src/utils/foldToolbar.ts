import type { FoldState } from './foldPosture';

export const FOLD_TOOLBAR_HEIGHT = 106;

/** Use measured visible space, not a device/model guess about the keyboard. */
export function laptopToolbarPlacement(
  fold: FoldState & { foldable: boolean },
  viewport: { top: number; height: number },
  menuBottom: number,
): { top: number; side: 'above' | 'below'; scriptBottom: number; panelTop: number } | null {
  const crease = fold.foldRect;
  if (!fold.foldable || fold.fold !== 'laptop' || !crease) return null;
  const bottom = viewport.top + viewport.height;
  const below = crease.top + crease.height;
  if (below + FOLD_TOOLBAR_HEIGHT <= bottom) {
    return { top: below, side: 'below', scriptBottom: crease.top, panelTop: below + FOLD_TOOLBAR_HEIGHT };
  }
  const top = Math.min(crease.top, bottom) - FOLD_TOOLBAR_HEIGHT;
  // Keep a usable script strip; on an impossibly short viewport retain the
  // normal toolbar rather than place controls over the menu or off screen.
  if (top < Math.max(menuBottom, viewport.top) + 80) return null;
  return { top, side: 'above', scriptBottom: top, panelTop: below };
}
