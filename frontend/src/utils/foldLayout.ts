/** Decide docking before measuring the editor, so fitting cannot oscillate
 * between an overlay and a docked Navigator on ResizeObserver callbacks. */
export function foldLayout(width: number, pageWidth: number, navWidth: number, navigatorOpen: boolean, rightColumn: boolean) {
  const free = Math.max(0, width - (rightColumn ? 300 : 0) - 16);
  const dockNavigator = navigatorOpen && (free - navWidth) / pageWidth >= 0.8;
  const available = Math.max(0, free - (dockNavigator ? navWidth : 0));
  return { dockNavigator, zoom: Math.max(70, Math.min(100, Math.floor(available / pageWidth * 100))) };
}
