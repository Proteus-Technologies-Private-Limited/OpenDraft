/**
 * Whether Layout › Panels takes effect on this screen.
 *
 * The panel docks only exist on a wide window. At 1100px and below the
 * Navigator and the right-hand panels are overlays that slide in and out
 * (screenplay.css), and a foldable that is open or wide keeps its own
 * column of tabs (useFoldWritingPadDock). There the panel layouts change
 * nothing on screen, so the places that offer them hide them instead.
 */
import { useSyncExternalStore } from 'react';
import { useFoldState } from './useFoldState';

export const DOCK_LAYOUT_MAX_COMPACT = '(max-width: 1100px)';

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      try {
        const list = window.matchMedia?.(query);
        if (!list) return () => {};
        if (typeof list.addEventListener === 'function') {
          list.addEventListener('change', notify);
          return () => list.removeEventListener('change', notify);
        }
        list.addListener?.(notify);
        return () => list.removeListener?.(notify);
      } catch (error) {
        console.error('[layout] could not watch the media query', query, error);
        return () => {};
      }
    },
    () => {
      try {
        return window.matchMedia?.(query).matches ?? false;
      } catch {
        return false;
      }
    },
    () => false,
  );
}

/** True below the width where the panel docks give way to overlays. */
export function useCompactViewport(): boolean {
  return useMediaQuery(DOCK_LAYOUT_MAX_COMPACT);
}

/** True when Layout › Panels changes what is on screen. */
export function useWorkspaceDocksAvailable(): boolean {
  const compact = useCompactViewport();
  const fold = useFoldState();
  const foldDock = fold.foldable && (fold.size === 'wide' || fold.fold !== 'flat');
  return !compact && !foldDock;
}

