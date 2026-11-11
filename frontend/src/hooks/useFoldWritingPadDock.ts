import { useCallback, useSyncExternalStore } from 'react';

function subscribe(notify: () => void) {
  window.addEventListener('resize', notify);
  window.visualViewport?.addEventListener('resize', notify);
  window.visualViewport?.addEventListener('scroll', notify);
  return () => {
    window.removeEventListener('resize', notify);
    window.visualViewport?.removeEventListener('resize', notify);
    window.visualViewport?.removeEventListener('scroll', notify);
  };
}

/** Float the existing pad when the visible viewport shrinks substantially or
 * the lower slot cannot hold it. This guards browser geometry; it does not
 * infer a native keyboard or replace WP10's keyboard-aware toolbar layout. */
export function useFoldWritingPadDock(enabled: boolean, lowerTop: number | null): boolean {
  const snapshot = useCallback(() => {
    if (!enabled || typeof window === 'undefined') return true;
    const viewport = window.visualViewport;
    if (viewport && window.innerHeight - viewport.height > 120) return false;
    const bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
    return lowerTop === null || bottom - lowerTop >= 240;
  }, [enabled, lowerTop]);
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
