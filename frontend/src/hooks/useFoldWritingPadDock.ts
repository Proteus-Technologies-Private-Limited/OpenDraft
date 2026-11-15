import { useCallback, useSyncExternalStore } from 'react';

import { subscribeWritingViewport, writingViewport } from '../utils/writingViewport';

/** Float the existing pad when the visible viewport shrinks substantially or
 * the lower slot cannot hold it. Native insets also cover edge-to-edge WebViews whose viewport does not resize. */
export function useFoldWritingPadDock(enabled: boolean, lowerTop: number | null): boolean {
  const snapshot = useCallback(() => {
    if (!enabled || typeof window === 'undefined') return true;
    const view = writingViewport();
    if (view.keyboard) return false;
    const viewport = window.visualViewport;
    if (viewport && window.innerHeight - viewport.height > 120) return false;
    const bottom = view.top + view.height;
    return lowerTop === null || bottom - lowerTop >= 240;
  }, [enabled, lowerTop]);
  const subscribe = useCallback((notify: () => void) => enabled
    ? subscribeWritingViewport(notify) : () => {}, [enabled]);
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
