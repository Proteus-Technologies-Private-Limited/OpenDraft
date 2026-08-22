/**
 * "Back" controls that always go somewhere, and never into a loop.
 *
 * The decisions live in ../utils/backNavigation, which explains them and is
 * unit-tested; these hooks only wire them to the router.
 */
import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { backToParent, plainBack, type BackAction } from '../utils/backNavigation';

/** React Router's own index into the history stack; absent if it did not
    write the current entry (a cold launch, a deep link, an OS file open). */
function historyIndex(): number | undefined {
  return (window.history.state as { idx?: number } | null)?.idx;
}

/**
 * "Back" that always goes somewhere.
 *
 * `navigate(-1)` does nothing at all when the current screen *is* the first
 * entry. On desktop and web that is survivable because the browser and the
 * window still offer a way out; in the iOS/Android WebView there is none, and
 * the only way back to the screenplay was to force-quit the app, losing
 * unsaved work (issue #65).
 *
 * @param fallback Route to go to when there is no history entry to return to.
 *                 Defaults to the editor.
 */
export function useGoBack(fallback = '/'): () => void {
  const navigate = useNavigate();

  return useCallback(() => {
    run(navigate, plainBack(historyIndex(), fallback));
  }, [navigate, fallback]);
}

/**
 * "Back" for a screen that sits on top of a known parent route.
 *
 * `navigate(parent)` looks like going back but is a *push*: it leaves the
 * child screen on the history stack, so the parent's own back control walks
 * straight into it again. On the Projects screens that closed a loop with no
 * way out — Projects → a project → "← Projects" → back → the same project,
 * forever (issue #66).
 *
 * The caller marks the relationship when it pushes the child:
 * `navigate(child, { state: { from: parent } })`.
 *
 * @param parent Route this screen was opened from, and lands on when left.
 */
export function useGoBackTo(parent: string): () => void {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  return useCallback(() => {
    run(navigate, backToParent(from, parent, historyIndex()));
  }, [navigate, parent, from]);
}

function run(navigate: ReturnType<typeof useNavigate>, action: BackAction): void {
  if (action.kind === 'pop') navigate(-1);
  else navigate(action.to, { replace: true });
}
