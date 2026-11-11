/** Decide docking before measuring the editor, so fitting cannot oscillate
 * between an overlay and a docked Navigator on ResizeObserver callbacks. */
export const FOLD_NAV_WIDTH = 240;
export function foldLayout(width: number, pageWidth: number, navigatorOpen: boolean, rightColumn: boolean) {
  const free = Math.max(0, width - (rightColumn ? 300 : 0) - 16);
  const dockNavigator = navigatorOpen && (free - FOLD_NAV_WIDTH) / pageWidth >= 0.8;
  return { dockNavigator };
}
