/**
 * "Back" that always goes somewhere.
 *
 * `navigate(-1)` pops the history stack, which does nothing at all when the
 * current screen *is* the first entry — reached by a deep link, an OS file
 * association, or a cold launch straight into the route.  On desktop and web
 * that is survivable because the browser and the window still offer a way out.
 * In the iOS/Android WebView there is no such escape hatch: the back button
 * appears to be broken and the only way back to the screenplay is to force-quit
 * the app, which loses unsaved work (issue #65).
 *
 * So: pop when there is something to pop, otherwise navigate to a real route.
 */
import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * @param fallback Route to go to when there is no history entry to return to.
 *                 Defaults to the editor.
 */
export function useGoBack(fallback = '/'): () => void {
  const navigate = useNavigate();

  return useCallback(() => {
    // history.state.idx is React Router's own index into the history stack.
    // It is absent when another party wrote the history entry, in which case
    // the stack depth is unknowable — prefer the fallback over a no-op.
    const idx = (window.history.state as { idx?: number } | null)?.idx;

    if (typeof idx === 'number' && idx > 0) {
      navigate(-1);
      return;
    }
    navigate(fallback, { replace: true });
  }, [navigate, fallback]);
}
