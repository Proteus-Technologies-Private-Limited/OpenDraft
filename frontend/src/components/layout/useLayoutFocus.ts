import { useLayoutEffect, useRef, type FocusEvent } from 'react';

/** Restore only focus lost by a layout edit; never override another focus owner. */
export function useLayoutFocus() {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<{ element: HTMLElement; key?: string } | null>(null);
  const onFocusCapture = (event: FocusEvent<HTMLElement>) => {
    last.current = {
      element: event.target,
      key: event.target.closest<HTMLElement>('[data-layout-focus]')?.dataset.layoutFocus,
    };
  };
  useLayoutEffect(() => {
    const root = ref.current, previous = last.current;
    if (!root || !previous) return;
    const active = document.activeElement;
    if (active !== document.body && active !== previous.element) return;
    const available = (element: HTMLElement) => root.contains(element)
      && !element.matches(':disabled') && element.getClientRects().length > 0;
    if (active === previous.element && available(previous.element)) return;
    let target = available(previous.element) ? previous.element : null;
    if (!target && previous.key) {
      const scope = Array.from(root.querySelectorAll<HTMLElement>('[data-layout-focus]'))
        .find(element => element.dataset.layoutFocus === previous.key);
      const candidate = scope?.matches('button, input, select') ? scope
        : (scope?.querySelector<HTMLElement>('.bars-row-main, .layout-group-name')
          ?? scope?.querySelector<HTMLElement>('button:not(:disabled), input, select'));
      if (candidate && available(candidate)) target = candidate;
    }
    target ??= root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?? root.querySelector<HTMLElement>('button:not(:disabled)');
    target?.focus();
  });
  return { ref, onFocusCapture };
}
