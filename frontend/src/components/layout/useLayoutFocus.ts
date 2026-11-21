import { useLayoutEffect, useRef, type FocusEvent } from 'react';

function available(root: HTMLElement | null, element: HTMLElement): boolean {
  return !!root?.contains(element) && !element.matches(':disabled')
    && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0
    && getComputedStyle(element).visibility !== 'hidden';
}

/** One dialog owner repairs focus after a control disappears or is disabled.
 * Observe child edits too: local name forms need not re-render the dialog. */
export function useLayoutFocus(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<{ element: HTMLElement; key?: string } | null>(null);
  const onFocusCapture = (event: FocusEvent<HTMLElement>) => {
    last.current = {
      element: event.target,
      key: event.target.closest<HTMLElement>('[data-layout-focus]')?.dataset.layoutFocus,
    };
  };
  const onBlurCapture = (event: FocusEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && ref.current?.contains(event.relatedTarget)) return;
    // An intentional blur of a surviving control is not a lost focus target.
    if (available(ref.current, event.target)) last.current = null;
  };
  useLayoutEffect(() => {
    const root = ref.current;
    if (!enabled || !root) return;
    const restore = () => {
      const previous = last.current;
      if (!previous) return;
      const active = document.activeElement;
      if (active !== document.body && active !== previous.element) return;
      if (available(root, previous.element)) return;
      let target: HTMLElement | null = null;
      if (previous.key) {
        const scope = Array.from(root.querySelectorAll<HTMLElement>('[data-layout-focus]'))
          .find(element => element.dataset.layoutFocus === previous.key);
        const candidate = scope?.matches('button, input, select') ? scope
          : (scope?.querySelector<HTMLElement>('.bars-row-main, .layout-group-name')
            ?? scope?.querySelector<HTMLElement>('button:not(:disabled), input, select'));
        if (candidate && available(root, candidate)) target = candidate;
      }
      target ??= root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?? root.querySelector<HTMLElement>('button:not(:disabled)');
      target?.focus();
    };
    const observer = new MutationObserver(restore);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    return () => observer.disconnect();
  }, [enabled]);
  return { ref, onFocusCapture, onBlurCapture };
}
