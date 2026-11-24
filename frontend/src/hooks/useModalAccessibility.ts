import { useId, useLayoutEffect, useRef, type RefObject } from 'react';
import { focusableElements, isTopModal, registerModal } from '../utils/modalAccessibility';

/** APG modal behavior without requiring new WebView APIs or changing panel parents. */
export function useModalAccessibility(ref: RefObject<HTMLDivElement | null>, enabled = true, label?: string) {
  const id = useId();
  // Capture during render, before a child's React autoFocus runs at commit.
  const opener = useRef<HTMLElement | null>(typeof document !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    const overlay = ref.current;
    const box = overlay.firstElementChild as HTMLElement | null;
    if (!box) return;
    if (!box.hasAttribute('tabindex')) box.setAttribute('tabindex', '-1');
    // A dialog opened from a panel in its own window lives in that window's document.
    const doc = overlay.ownerDocument;
    const previous = doc.activeElement;
    // React's autoFocus may already be inside; the wrapper records the opener earlier.
    if (!overlay.contains(previous)) opener.current = previous instanceof (doc.defaultView ?? window).HTMLElement ? previous as HTMLElement : null;
    if (!box.hasAttribute('role')) box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const heading = box.querySelector<HTMLElement>('.dialog-header, h1, h2, h3');
    if (label) box.setAttribute('aria-label', label);
    else if (!box.hasAttribute('aria-label') && !box.hasAttribute('aria-labelledby')) {
      if (heading) {
        if (!heading.id) heading.id = `${id}-title`;
        box.setAttribute('aria-labelledby', heading.id);
      }
    }
    const unregister = registerModal(box);
    if (!box.contains(doc.activeElement)) {
      // A static title keeps long content in view and avoids selecting a destructive action.
      const initial = heading ?? focusableElements(box)[0] ?? box;
      if (!initial.hasAttribute('tabindex') && !initial.matches('button, input, select, textarea, a[href]')) initial.setAttribute('tabindex', '-1');
      initial.focus({ preventScroll: true });
    }
    const keydown = (event: KeyboardEvent) => {
      if (!isTopModal(box) || event.defaultPrevented || event.isComposing) return;
      if (event.key === 'Escape') {
        // Reuse the existing outside-click handler, including busy/first-run guards.
        overlay.click();
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableElements(box);
      const index = items.indexOf(doc.activeElement as HTMLElement);
      if (!items.length || index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
        event.preventDefault();
        (event.shiftKey ? items[items.length - 1] ?? box : items[0] ?? box).focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (isTopModal(box) && !box.contains(event.target as Node)) (focusableElements(box)[0] ?? box).focus();
    };
    doc.addEventListener('keydown', keydown);
    doc.addEventListener('focusin', focusin);
    return () => {
      doc.removeEventListener('keydown', keydown);
      doc.removeEventListener('focusin', focusin);
      unregister();
      const target = opener.current;
      queueMicrotask(() => {
        // A command may deliberately focus the editor or open another dialog.
        const current = doc.activeElement;
        if (target?.isConnected && !target.closest('[inert], [hidden], [aria-hidden="true"]') &&
          (!current || current === doc.body || overlay.contains(current))) target.focus({ preventScroll: true });
      });
    };
  }, [enabled, id, label, ref]);
}
