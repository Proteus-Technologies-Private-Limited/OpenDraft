import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { Dispatch, FocusEvent, KeyboardEvent as ReactKeyboardEvent, RefObject, SetStateAction } from 'react';
import { menuSearchKey, menuSearchText } from '../utils/menuKeyboard';

type Setter<T> = Dispatch<SetStateAction<T>>;
interface Options {
  activeMenu: string | null;
  hidden: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  triggers: RefObject<Record<string, HTMLDivElement | null>>;
  fabRef: RefObject<HTMLDivElement | null>;
  setActiveMenu: Setter<string | null>;
  setOpenSubmenu: Setter<string | null>;
  setFloatingMenuOpen: Setter<boolean>;
}

const itemSelector = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';
const visible = (element: HTMLElement) => element.getClientRects().length > 0 && !element.closest('[hidden], [inert]');
const rows = (menu: HTMLElement) => Array.from(menu.children)
  .flatMap(child => child.getAttribute('role') === 'group' ? Array.from(child.children) : [child])
  .filter((child): child is HTMLElement => child instanceof HTMLElement && child.matches(itemSelector) && visible(child));
const focus = (element: HTMLElement | null | undefined) => {
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};
const modal = () => document.querySelector<HTMLElement>('dialog[open], [aria-modal="true"], .dialog-overlay');
const tabbables = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>(
  'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]',
)).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && visible(element));

/** DOM focus is separate from the editor's text selection; pointer focus stays unchanged. */
export function useMenuKeyboard({ activeMenu, hidden, menuRef, dropdownRef, triggers, fabRef,
  setActiveMenu, setOpenSubmenu, setFloatingMenuOpen }: Options) {
  const [tabStop, setTabStop] = useState('File');
  // Commit even when a hover already opened the requested level.
  const [, requestCommit] = useReducer((value: number) => value + 1, 0);
  const pendingFocus = useRef<{ id: string; edge?: 'first' | 'last' } | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const typeahead = useRef({ text: '', at: 0, menu: null as HTMLElement | null });
  const pendingAction = useRef<{ trigger: HTMLElement | null; origin: HTMLElement | null; at: number } | null>(null);
  const modalReturn = useRef<{ modal: HTMLElement; trigger: HTMLElement | null } | null>(null);

  const trigger = () => (activeMenu ? triggers.current[activeMenu] : triggers.current[tabStop]);
  const fallback = () => hidden ? fabRef.current : triggers.current[tabStop] ?? triggers.current.File;
  const request = (id: string, edge?: 'first' | 'last') => {
    pendingFocus.current = { id, edge };
    requestCommit();
  };
  const close = (floating = false) => {
    setActiveMenu(null);
    setOpenSubmenu(null);
    if (floating) setFloatingMenuOpen(false);
  };
  const topItems = () => Object.values(triggers.current).filter((element): element is HTMLDivElement =>
    !!element && element.isConnected && visible(element));
  const openTop = (element: HTMLElement, edge?: 'first' | 'last') => {
    const id = element.dataset.menuTop;
    if (!id) return;
    setTabStop(id);
    setOpenSubmenu(null);
    setActiveMenu(id);
    if (edge) request(element.getAttribute('aria-controls') || element.dataset.menuPopup!, edge);
    else focus(element);
  };
  const switchTop = (delta: number, popup: boolean) => {
    const items = topItems();
    if (!items.length) return;
    const index = items.findIndex((element) => element.dataset.menuTop === (activeMenu ?? tabStop));
    const next = items[(index + delta + items.length) % items.length];
    if (popup || activeMenu) openTop(next, popup ? 'first' : undefined);
    else focus(next);
  };
  const openChild = (row: HTMLElement) => {
    const child = row.querySelector<HTMLElement>(':scope > [role="menu"]');
    if (!child) return;
    setOpenSubmenu(row.dataset.menuPath ?? null);
    request(child.id, 'first');
  };
  const returnTrigger = () => {
    const element = trigger();
    focus(element?.isConnected ? element : fallback());
  };
  const prepareAction = () => {
    returnTrigger();
    pendingAction.current = { trigger: document.activeElement as HTMLElement | null, origin: origin.current, at: Date.now() };
  };
  const leaveWithTab = (backwards: boolean) => {
    const anchor = hidden ? fabRef.current : trigger();
    const all = tabbables(document);
    const index = anchor ? all.indexOf(anchor) : -1;
    let next: HTMLElement | undefined;
    for (let step = 1; step <= all.length; step++) {
      const candidate = all[((index + (backwards ? -step : step)) % all.length + all.length) % all.length];
      if (!menuRef.current?.contains(candidate) && !dropdownRef.current?.contains(candidate)
        && candidate !== fabRef.current) { next = candidate; break; }
    }
    pendingAction.current = null;
    close(true);
    if (next) focus(next);
  };
  const search = (event: ReactKeyboardEvent, menu: HTMLElement, choices: HTMLElement[]) => {
    if (!menuSearchKey(event.key) || event.ctrlKey || event.metaKey || event.altKey) return false;
    const normalize = menuSearchText;
    const old = typeahead.current;
    const char = normalize(event.key);
    const continuing = old.menu === menu && Date.now() - old.at < 700;
    const extending = continuing && old.text !== char;
    const text = extending ? normalize(old.text + char) : char;
    const current = choices.indexOf(document.activeElement as HTMLElement);
    const find = (prefix: string, fromCurrent = false) => {
      for (let offset = fromCurrent ? 0 : 1; offset <= choices.length; offset++) {
        const candidate = choices[(Math.max(current, 0) + offset) % choices.length];
        if (candidate && normalize(candidate.getAttribute('aria-label') || candidate.textContent || '').startsWith(prefix)) return candidate;
      }
    };
    const fullMatch = find(text, extending);
    const match = fullMatch ?? find(char);
    typeahead.current = { text: fullMatch ? text : char, at: Date.now(), menu };
    if (match) focus(match);
    return true;
  };

  // Process focus only after React has made the requested level visible. Also
  // recover from a translated/removed row or a toolbar-layout change.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (pending) {
      pendingFocus.current = null;
      const element = (pending.id ? document.getElementById(pending.id) : topItems()[0]);
      const choices = element && pending.edge ? rows(element) : [];
      focus(pending.edge ? (pending.edge === 'last' ? choices.at(-1) : choices[0]) : element);
    }
    const action = pendingAction.current;
    if (action && Date.now() - action.at < 2000) {
      const dialog = modal();
      if (dialog) {
        modalReturn.current = { modal: dialog, trigger: action.trigger };
        if (document.activeElement === action.trigger || document.activeElement === action.origin || document.activeElement === document.body) focus(tabbables(dialog)[0]);
        pendingAction.current = null;
      } else if (!activeMenu && (document.activeElement === action.trigger || document.activeElement === document.body)) {
        // A panel/theme/layout command leaves text selection intact. Return to
        // its originating control without scrolling the whole script into view.
        const target = action.origin?.isConnected && action.origin !== document.body && visible(action.origin)
          ? action.origin : fallback();
        target?.focus({ preventScroll: true });
        // Retain the short observation window for asynchronously opened dialogs.
      } else if (document.activeElement !== action.trigger && document.activeElement !== action.origin
        && document.activeElement !== document.body) pendingAction.current = null;
    } else pendingAction.current = null;
    const returning = modalReturn.current;
    if (returning && !returning.modal.isConnected) {
      modalReturn.current = null;
      if (document.activeElement === document.body) focus(returning.trigger?.isConnected ? returning.trigger : fallback());
    }
    const previous = lastFocus.current;
    if (previous && (!previous.isConnected || !visible(previous))
      && (document.activeElement === previous || document.activeElement === document.body) && !modal()) {
      let owner = previous.closest<HTMLElement>('[role="menu"]')?.dataset.menuOwner;
      let parent = owner ? document.getElementById(owner) : null;
      while (parent && !visible(parent)) {
        owner = parent.closest<HTMLElement>('[role="menu"]')?.dataset.menuOwner;
        parent = owner ? document.getElementById(owner) : null;
      }
      lastFocus.current = null;
      focus(parent ?? (dropdownRef.current ? rows(dropdownRef.current)[0] : fallback()));
    }
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'F10' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented || modal()) return;
      event.preventDefault();
      const inside = menuRef.current?.contains(document.activeElement) || dropdownRef.current?.contains(document.activeElement);
      if (inside) {
        setActiveMenu(null); setOpenSubmenu(null); setFloatingMenuOpen(false);
        focus(origin.current?.isConnected ? origin.current : fabRef.current);
      } else {
        origin.current = document.activeElement as HTMLElement | null;
        if (hidden) setFloatingMenuOpen(true);
        pendingFocus.current = { id: Object.values(triggers.current).find((element) => element?.isConnected)?.id ?? '' };
        // In hidden mode the trigger does not exist until this render commits.
        requestCommit();
      }
    };
    // Pointer users keep the existing editor-selection behavior and do not
    // inherit focus recovery from an earlier keyboard interaction.
    const pointer = () => { lastFocus.current = null; pendingAction.current = null; modalReturn.current = null; };
    window.addEventListener('keydown', handler);
    document.addEventListener('pointerdown', pointer, true);
    return () => {
      window.removeEventListener('keydown', handler);
      document.removeEventListener('pointerdown', pointer, true);
    };
  }, [hidden, menuRef, dropdownRef, triggers, fabRef, setActiveMenu, setOpenSubmenu, setFloatingMenuOpen]);

  const onTopFocus = (id: string, event: FocusEvent<HTMLElement>) => {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !menuRef.current?.contains(from) && !dropdownRef.current?.contains(from)) origin.current = from;
    setTabStop(id);
    lastFocus.current = event.currentTarget;
  };
  const onTopKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const key = event.key;
    const items = topItems();
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') openTop(event.currentTarget, key === 'ArrowUp' ? 'last' : 'first');
    else if (key === 'ArrowRight' || key === 'ArrowLeft') switchTop((key === 'ArrowRight') !== rtl ? 1 : -1, false);
    else if (key === 'Home' || key === 'End') {
      const next = key === 'Home' ? items[0] : items.at(-1);
      if (next) { if (activeMenu) openTop(next); else focus(next); }
    } else if (key === 'Escape') {
      close(true);
      focus(hidden ? fabRef.current : origin.current?.isConnected ? origin.current : event.currentTarget);
    } else if (key === 'Tab') { if (!activeMenu && !hidden) return; leaveWithTab(event.shiftKey); }
    else if (!search(event, event.currentTarget.parentElement!, items)) return;
    event.preventDefault(); event.stopPropagation();
  };
  const onItemKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const row = event.currentTarget;
    const menu = row.closest<HTMLElement>('[role="menu"]')!;
    const choices = rows(menu);
    const index = choices.indexOf(row);
    const rtl = getComputedStyle(row).direction === 'rtl';
    const forward = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight');
    const backward = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft');
    const child = row.querySelector<HTMLElement>(':scope > [role="menu"]');
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') focus(choices[(index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length]);
    else if (event.key === 'Home' || event.key === 'End') focus(event.key === 'Home' ? choices[0] : choices.at(-1));
    else if (event.key === 'Enter' || event.key === ' ') {
      if (row.getAttribute('aria-disabled') !== 'true') {
        if (child) openChild(row);
        else { prepareAction(); row.click(); }
      }
    } else if (forward) { if (child) openChild(row); else switchTop(1, true); }
    else if (event.key === 'Escape' || backward) {
      const owner = menu.dataset.menuOwner ? document.getElementById(menu.dataset.menuOwner) : null;
      if (child && row.getAttribute('aria-expanded') === 'true' && event.key === 'Escape') setOpenSubmenu(row.dataset.menuParent || null);
      else if (owner) { setOpenSubmenu(owner.dataset.menuParent || null); focus(owner); }
      else if (backward) switchTop(-1, true);
      else { close(); returnTrigger(); }
    } else if (event.key === 'Tab') leaveWithTab(event.shiftKey);
    else if (!search(event, menu, choices)) return;
    event.preventDefault(); event.stopPropagation();
  };
  const onFabKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
      origin.current = event.currentTarget;
      setFloatingMenuOpen(true);
      pendingFocus.current = { id: '' };
      requestCommit();
    } else if (event.key === 'Escape') close(true);
    else return;
    event.preventDefault(); event.stopPropagation();
  };
  return { tabStop, onTopFocus, onTopKeyDown, onItemKeyDown, onFabKeyDown,
    onItemFocus: (event: FocusEvent<HTMLElement>) => { lastFocus.current = event.target as HTMLElement; },
  };
}
