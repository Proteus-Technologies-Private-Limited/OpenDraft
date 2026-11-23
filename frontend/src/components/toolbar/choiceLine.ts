import { useEffect } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { FOLD_CHANGE_EVENT } from '../../utils/foldPosture';

export interface ChoiceLineAnchor {
  left: number; top: number; width: number; height: number;
}

/** The same second row for every built-in toolbar popup, including overflow. */
export function toolbarChoiceLine(trigger: HTMLElement): ChoiceLineAnchor | null {
  try {
    const toolbar = trigger.closest<HTMLElement>('.toolbar');
    if (!toolbar || !(toolbar.classList.contains('toolbar--laptop')
      || document.documentElement.classList.contains('fold-book'))) return null;
    const box = toolbar.getBoundingClientRect();
    const style = getComputedStyle(toolbar);
    const left = parseFloat(style.paddingLeft) || 0;
    const right = parseFloat(style.paddingRight) || 0;
    const width = box.width - left - right;
    if (width <= 0) return null;
    return { left: box.left + left, top: box.top + (parseFloat(style.paddingTop) || 0) + 44 + (parseFloat(style.rowGap) || 0), width, height: 44 };
  } catch (error) {
    console.warn("[toolbar] Could not measure the choice row", error);
    return null;
  }
}

/** Follow native geometry too. Close on a posture change, preserving focus
 * only when it still belongs to this popup. Do not steal a dialog's focus. */
export function useChoiceLineLifecycle(
  open: boolean, trigger: RefObject<HTMLElement | null>, popup: RefObject<HTMLElement | null>, close: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      const owned = popup.current?.contains(document.activeElement) || trigger.current === document.activeElement;
      close();
      if (owned) trigger.current?.focus();
    };
    const focus = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.closest('.toolbar-choice-line, .od-select-popup--line')) return;
      if (e.target instanceof Node && !popup.current?.contains(e.target) && e.target !== trigger.current) close();
    };
    window.addEventListener(FOLD_CHANGE_EVENT, dismiss);
    document.addEventListener('focusin', focus);
    return () => {
      window.removeEventListener(FOLD_CHANGE_EVENT, dismiss);
      document.removeEventListener('focusin', focus);
    };
  }, [open, trigger, popup, close]);
}

/** Horizontal mixed command rows use native button/radio/checkbox semantics. */
export function moveChoiceFocus(e: KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement;
  if (target.matches('input:not([type=checkbox]):not([type=radio]), textarea')) return;
  const controls = [...e.currentTarget.querySelectorAll<HTMLElement>('.toolbar-choice-options button:not(:disabled), .toolbar-choice-options input:not(:disabled)')]
    .filter(el => el.getBoundingClientRect().width > 0);
  const i = controls.indexOf(target);
  if (i < 0) return;
  const forward = getComputedStyle(e.currentTarget).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  let next = i;
  if (e.key === forward) next = Math.min(i + 1, controls.length - 1);
  else if (e.key === (forward === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft')) next = Math.max(i - 1, 0);
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = controls.length - 1;
  else if (e.key === 'Enter' && target.matches('input')) { e.preventDefault(); target.click(); return; }
  else return;
  e.preventDefault();
  controls[next]?.focus();
  controls[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Reposition after React applies keyboard/viewport geometry to the toolbar. */
export function useChoiceLinePosition(open: boolean, trigger: RefObject<HTMLElement | null>, refresh: () => void) {
  useEffect(() => {
    const toolbar = trigger.current?.closest('.toolbar');
    if (!open || !toolbar) return;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); };
    const resize = new ResizeObserver(update);
    const mutation = new MutationObserver(update);
    resize.observe(toolbar);
    mutation.observe(toolbar, { attributes: true, attributeFilter: ['style', 'class'] });
    window.addEventListener('opendraft:keyboardchange', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      resize.disconnect(); mutation.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('opendraft:keyboardchange', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [open, trigger, refresh]);
}

/** Editor formatting schedules caret focus on a frame. Restore the dropdown
 * afterwards, without stealing focus from a newly opened dialog or control. */
export function restoreChoiceFocus(trigger: RefObject<HTMLElement | null>) {
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (!trigger.current?.isConnected || document.querySelector('[aria-modal="true"]')) return;
    if (active === document.body || active === trigger.current) trigger.current.focus();
  });
}
