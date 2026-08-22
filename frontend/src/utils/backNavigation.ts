/**
 * Where a "back" control should go, worked out without touching the router.
 *
 * Two screens that each reach the other by *pushing* form a trap: the history
 * stack grows a fresh entry every time, so neither screen's back control ever
 * unwinds anything. That is how Projects and a project's files ended up in a
 * loop with force-quitting the app the only way out (issue #66), and it is the
 * same shape as the dead-end back button in issue #65.
 *
 * Kept pure so both cases can be tested without a DOM.
 */

/** What the caller should ask the router to do. */
export type BackAction =
  | { kind: 'pop' }
  | { kind: 'replace'; to: string };

/**
 * @param idx      React Router's index into the history stack
 *                 (`history.state.idx`), or undefined when another party wrote
 *                 the entry and the depth is unknowable.
 * @param fallback Route to land on when there is nothing to pop.
 */
export function plainBack(idx: number | undefined, fallback: string): BackAction {
  // Popping the first entry in the stack does nothing at all, and in a WebView
  // there is no browser chrome to escape with — so go somewhere real instead.
  if (typeof idx === 'number' && idx > 0) return { kind: 'pop' };
  return { kind: 'replace', to: fallback };
}

/**
 * @param from   The route this screen was opened from, as recorded in the
 *               history entry's state, or undefined if it was not recorded.
 * @param parent The route this screen belongs under.
 * @param idx    As above.
 */
export function backToParent(
  from: string | undefined,
  parent: string,
  idx: number | undefined,
): BackAction {
  // Only pop when the entry behind us really is the parent; otherwise we would
  // unwind to whatever unrelated screen happens to be there.
  if (from === parent && typeof idx === 'number' && idx > 0) return { kind: 'pop' };
  // Replace, never push: the screen being left must not stay on the stack, or
  // the parent's own back control walks straight back into it.
  return { kind: 'replace', to: parent };
}
