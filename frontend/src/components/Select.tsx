import { ChoiceLineBack, ChoiceLineClose } from './toolbar/ChoiceLineControls';
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { modalPortalContainer } from '../utils/modalAccessibility';
import { createPortal } from 'react-dom';
import { toolbarChoiceLine, useChoiceLineLifecycle, useChoiceLinePosition, restoreChoiceFocus } from './toolbar/choiceLine';

/**
 * A drop-in for <select> whose list the app draws itself (issue #138).
 *
 * A native select's popup is not part of the page. macOS draws it as a system
 * menu and Windows as a system popup, both in the OS's own light or dark — so
 * with the app in Dark and the OS in Light every pulldown opened white, and no
 * CSS can reach it. The font pulldown never had the problem because FontPicker
 * draws its own list; this does the same for every other pulldown.
 *
 * It takes the props and children a <select> does — `value`, `onChange`,
 * `disabled`, `title`, `className`, and <option>/<optgroup> children, including
 * arrays, fragments and conditionals — so a call site changes only its tag.
 * `onChange` receives an object shaped like the change event the handlers
 * already read: `e.target.value` is the chosen option's value, as a string.
 *
 * The list is portalled to <body> (issue #152). Drawn next to its trigger it
 * stacked inside whatever stacking context the trigger sat in — the toolbar's
 * is z-index 1 — so its own z-index meant nothing outside it, and the Scenes
 * search bar (sticky, z-index 2) drew over the Element pulldown. A native list
 * sits above the whole page; this one has to as well.
 */

export interface SelectChangeEvent {
  target: { value: string; name?: string };
  currentTarget: { value: string; name?: string };
}

type SelectProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'defaultValue'> & {
  value?: string | number;
  defaultValue?: string | number;
  name?: string;
  /** Closed-trigger type-ahead opens and highlights instead of selecting. */
  manual?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children?: React.ReactNode;
};

interface OptionItem {
  kind: 'option';
  value: string;
  label: React.ReactNode;
  /** Plain text of the label, for type-ahead. */
  text: string;
  /** Shortcut shown right-aligned, from the option's `data-shortcut`. */
  shortcut?: string;
  disabled: boolean;
  hidden: boolean;
  title?: string;
}

interface GroupItem {
  kind: 'group';
  label: string;
}

type Item = OptionItem | GroupItem;

/** The plain text inside an option, which is what <option> itself would show. */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children);
  return '';
}

/** Flatten <option>/<optgroup> children the way the browser reads them. */
function collectItems(children: React.ReactNode, out: Item[] = [], groupDisabled = false): Item[] {
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as Record<string, unknown> & { children?: React.ReactNode };
    if (child.type === React.Fragment) {
      collectItems(props.children, out, groupDisabled);
    } else if (child.type === 'optgroup') {
      out.push({ kind: 'group', label: String(props.label ?? '') });
      collectItems(props.children, out, groupDisabled || !!props.disabled);
    } else if (child.type === 'option') {
      const text = textOf(props.children);
      out.push({
        kind: 'option',
        // An <option> with no value attribute submits its text.
        value: props.value === undefined || props.value === null ? text : String(props.value),
        label: props.children ?? text,
        text,
        shortcut: typeof props['data-shortcut'] === 'string' && props['data-shortcut']
          ? props['data-shortcut']
          : undefined,
        disabled: groupDisabled || !!props.disabled,
        hidden: !!props.hidden,
        title: typeof props.title === 'string' ? props.title : undefined,
      });
    } else {
      console.warn('[Select] ignoring a child that is not an <option> or <optgroup>', child.type);
    }
  });
  return out;
}

/** Where the popup sits, in viewport coordinates. */
interface Anchor {
  left: number;
  minWidth: number;
  maxWidth: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  /** Set for the choice line: the popup is laid out as one row of this size. */
  line?: { width: number; height: number };
  /** The trigger's document: a popped-out panel's popup opens in its window. */
  doc?: Document;
}

const EDGE_GAP = 8;
const MIN_ROOM_BELOW = 180;

/**
 * Fit the popup to the trigger and the visual viewport — on an iPad the soft
 * keyboard covers the window without changing innerHeight.
 */
function anchorTo(trigger: HTMLElement): Anchor {
  const line = choiceLineFor(trigger);
  if (line) return line;
  const rect = trigger.getBoundingClientRect();
  // A panel popped out into its own window measures against that window.
  const view = trigger.ownerDocument.defaultView ?? window;
  const vw = view.visualViewport?.width ?? view.innerWidth;
  const vh = view.visualViewport?.height ?? view.innerHeight;
  const maxWidth = Math.max(160, vw - EDGE_GAP * 2);
  const minWidth = Math.min(rect.width, maxWidth);
  const left = Math.max(EDGE_GAP, Math.min(rect.left, vw - minWidth - EDGE_GAP));
  const roomBelow = vh - rect.bottom - EDGE_GAP;
  const roomAbove = rect.top - EDGE_GAP;
  if (roomBelow >= MIN_ROOM_BELOW || roomBelow >= roomAbove) {
    return { left, minWidth, maxWidth: vw - left - EDGE_GAP, top: rect.bottom + 2, maxHeight: Math.max(120, roomBelow), doc: trigger.ownerDocument };
  }
  return { left, minWidth, maxWidth: vw - left - EDGE_GAP, bottom: vh - rect.top + 2, maxHeight: Math.max(120, roomAbove), doc: trigger.ownerDocument };
}

/**
 * Book and laptop toolbars put pulldowns in their second row. Other selects
 * keep their ordinary popup geometry, including those in dialogs and footers.
 */
export function choiceLineFor(trigger: HTMLElement): Anchor | null {
  if (typeof document === 'undefined') return null;
  const line = toolbarChoiceLine(trigger);
  return line ? { left: line.left, top: line.top, minWidth: line.width,
    maxWidth: line.width, maxHeight: line.height, line: { width: line.width, height: line.height } } : null;
}

const TYPEAHEAD_RESET_MS = 700;

const Select: React.FC<SelectProps> = ({
  value, defaultValue, name, manual = false, onChange, children, className, disabled, style, id, title,
  onKeyDown: onKeyDownProp, onBlur, ...rest
}) => {
  const items = useMemo(() => collectItems(children), [children]);
  const options = useMemo(
    () => items.map((it, i) => (it.kind === 'option' ? i : -1)).filter((i) => i >= 0),
    [items],
  );

  const controlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = useState<string>(
    defaultValue !== undefined ? String(defaultValue) : '',
  );
  const current = controlled ? String(value) : uncontrolledValue;

  // What a native select shows: the matching option, else the first one that
  // can be chosen.
  const selectedIndex = useMemo(() => {
    const match = items.findIndex((it) => it.kind === 'option' && it.value === current);
    if (match >= 0) return match;
    const firstEnabled = items.findIndex((it) => it.kind === 'option' && !it.disabled);
    return firstEnabled >= 0 ? firstEnabled : (options[0] ?? -1);
  }, [items, current, options]);
  const selected = selectedIndex >= 0 ? (items[selectedIndex] as OptionItem) : undefined;

  const [openState, setOpen] = useState(false);
  // A pulldown disabled while it is open closes, as a native one does.
  const open = openState && !disabled;
  const [activeIndex, setActiveIndex] = useState(-1);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', at: 0 });
  const listId = useId();

  const choosable = useCallback(
    (i: number) => {
      const it = items[i];
      return !!it && it.kind === 'option' && !it.disabled && !it.hidden;
    },
    [items],
  );

  const openedByKeyboard = useRef(false);
  const openList = useCallback((keyboard: boolean) => {
    openedByKeyboard.current = keyboard;
    if (disabled || !buttonRef.current) return;
    setAnchor(anchorTo(buttonRef.current));
    setActiveIndex(choosable(selectedIndex) ? selectedIndex : options.find(choosable) ?? -1);
    setOpen(true);
  }, [disabled, selectedIndex, options, choosable]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

  useChoiceLineLifecycle(open && !!anchor?.line, buttonRef, listRef, useCallback(() => setOpen(false), []));
  useChoiceLinePosition(open && !!anchor?.line, buttonRef, useCallback(() => { if (buttonRef.current) setAnchor(anchorTo(buttonRef.current)); }, []));

  const commit = useCallback((index: number) => {
    const it = items[index];
    if (!it || it.kind !== 'option' || it.disabled) return;
    close(!anchor?.line || openedByKeyboard.current);
    // Like a native select, a change event only when the value actually changes.
    if (it.value === current) return;
    if (!controlled) setUncontrolledValue(it.value);
    if (!onChange) return;
    const target = { value: it.value, name };
    try {
      onChange({ target, currentTarget: target } as unknown as React.ChangeEvent<HTMLSelectElement>);
    } catch (err) {
      console.error('[Select] onChange handler failed', err);
    }
    if (anchor?.line && openedByKeyboard.current) restoreChoiceFocus(buttonRef);
  }, [items, current, controlled, onChange, name, close, anchor]);


  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('.od-select-option.is-active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: Event) => {
      const target = e.target as Node;
      if (listRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Follow the trigger rather than close: a soft keyboard appearing is a
    // resize, and a dialog settling is a scroll.
    const reposition = (e?: Event) => {
      // nodeType, not instanceof Node: a popped-out panel's nodes are another window's.
      if (e && listRef.current && typeof (e.target as Node | null)?.nodeType === 'number' && listRef.current.contains(e.target as Node)) return;
      if (buttonRef.current) setAnchor(anchorTo(buttonRef.current));
    };
    const doc = buttonRef.current?.ownerDocument ?? document;
    const view = doc.defaultView ?? window;
    doc.addEventListener('mousedown', onPointerDown);
    doc.addEventListener('touchstart', onPointerDown as EventListener);
    view.addEventListener('resize', reposition);
    view.addEventListener('scroll', reposition, true);
    view.visualViewport?.addEventListener('resize', reposition);
    view.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      doc.removeEventListener('mousedown', onPointerDown);
      doc.removeEventListener('touchstart', onPointerDown as EventListener);
      view.removeEventListener('resize', reposition);
      view.removeEventListener('scroll', reposition, true);
      view.visualViewport?.removeEventListener('resize', reposition);
      view.visualViewport?.removeEventListener('scroll', reposition);
    };
  }, [open]);

  // Out of the trigger's DOM, a press in the list reads as "outside" to every
  // document-level click-away handler — the toolbar's overflow menu, which
  // holds the font-size pulldown, would close and unmount the list before the
  // click landed. A native list's presses never reach the page at all, so
  // these stop here. Native listeners, on the list itself, so they run before
  // anything on <body> or the document.
  useEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const keepPress = (e: Event) => {
      e.stopPropagation();
      // Keep focus on the trigger, so the keyboard keeps driving the list.
      if (e.type === 'mousedown') e.preventDefault();
    };
    list.addEventListener('mousedown', keepPress);
    list.addEventListener('touchstart', keepPress, { passive: true });
    return () => {
      list.removeEventListener('mousedown', keepPress);
      list.removeEventListener('touchstart', keepPress);
    };
  }, [open]);

  const step = (from: number, delta: number): number => {
    const choosableIdx = options.filter(choosable);
    if (choosableIdx.length === 0) return from;
    const pos = choosableIdx.indexOf(from);
    if (pos < 0) return delta > 0 ? choosableIdx[0] : choosableIdx[choosableIdx.length - 1];
    return choosableIdx[Math.min(choosableIdx.length - 1, Math.max(0, pos + delta))];
  };

  /** Jump to the next option starting with what has been typed. */
  const findTyped = (key: string, from: number): number => {
    const now = Date.now();
    const t = typeahead.current;
    t.text = now - t.at > TYPEAHEAD_RESET_MS ? key : t.text + key;
    t.at = now;
    const q = t.text.toLowerCase();
    const choosableIdx = options.filter(choosable);
    const start = Math.max(0, choosableIdx.indexOf(from) + (t.text.length === 1 ? 1 : 0));
    const ordered = [...choosableIdx.slice(start), ...choosableIdx.slice(0, start)];
    return ordered.find((i) => (items[i] as OptionItem).text.trim().toLowerCase().startsWith(q)) ?? -1;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    onKeyDownProp?.(e);
    if (e.defaultPrevented || e.nativeEvent.isComposing || disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList(true);
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const hit = findTyped(e.key, selectedIndex);
        if (hit < 0) return;
        if (manual) {
          e.preventDefault();
          openList(true);
          setActiveIndex(hit);
        } else {
          // Match a native select's closed-trigger type-ahead by default.
          commit(hit);
        }
      }
      return;
    }
    // The choice line runs across: Left and Right move along it, in reading order.
    const forward = anchor?.line && getComputedStyle(buttonRef.current ?? document.body).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
    if (e.key === 'ArrowDown' || (anchor?.line && e.key === forward)) { e.preventDefault(); setActiveIndex((i) => step(i, 1)); }
    else if (e.key === 'ArrowUp' || (anchor?.line && e.key === backward)) { e.preventDefault(); setActiveIndex((i) => step(i, -1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActiveIndex(options.find(choosable) ?? -1); }
    else if (e.key === 'End') { e.preventDefault(); setActiveIndex([...options].reverse().find(choosable) ?? -1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); commit(activeIndex); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') { setOpen(false); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const hit = findTyped(e.key, activeIndex);
      if (hit >= 0) setActiveIndex(hit);
    }
  };

  return (
    <>
      <button
        {...rest}
        ref={buttonRef}
        type="button"
        id={id}
        title={title ?? selected?.title}
        className={['od-select', className].filter(Boolean).join(' ')}
        style={style}
        disabled={disabled}
        aria-label={rest['aria-label'] ?? (rest['aria-labelledby'] || id ? undefined : title)}
        role="combobox"
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={event => (open ? close(false) : openList(event.detail === 0))}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        {/* Every label sits in the same grid cell, all but the current one
            invisible, so the trigger is as wide as its longest option — the
            width a native select has — and does not jump as the value changes. */}
        <span className="od-select-sizer">
          {items.map((it, i) => (it.kind === 'option' && !it.hidden && i !== selectedIndex
            ? <span key={i} className="od-select-ghost" aria-hidden>{it.label}</span>
            : null))}
          <span className="od-select-label">{selected?.label ?? ' '}</span>
        </span>
        <span className="od-select-caret" aria-hidden>▾</span>
      </button>

      {open && anchor && createPortal(
        <div
          ref={listRef}
          id={anchor.line ? undefined : listId}
          className={anchor.line ? 'od-select-popup od-select-popup--line' : 'od-select-popup'}
          role={anchor.line ? undefined : "listbox"}
          aria-label={anchor.line ? undefined : (rest['aria-label'] ?? title ?? selected?.text)}
          style={anchor.line ? {
            left: anchor.left,
            top: anchor.top,
            width: anchor.line.width,
            height: anchor.line.height,
          } : {
            left: anchor.left,
            top: anchor.top,
            bottom: anchor.bottom,
            minWidth: anchor.minWidth,
            maxWidth: anchor.maxWidth,
            maxHeight: anchor.maxHeight,
          }}
        >
          {anchor.line && <ChoiceLineBack label={title ?? rest['aria-label'] ?? selected?.text ?? ''} onClose={() => close(true)} />}
          <div className={anchor.line ? 'toolbar-choice-options' : undefined}
            id={anchor.line ? listId : undefined} role={anchor.line ? 'listbox' : undefined}
            aria-orientation={anchor.line ? 'horizontal' : undefined}
            aria-label={anchor.line ? (rest['aria-label'] ?? title ?? selected?.text) : undefined}>
          {items.map((it, i) => {
            if (it.kind === 'group') {
              return <div key={`g-${i}`} className="od-select-group" role="presentation">{it.label}</div>;
            }
            if (it.hidden) return null;
            const isSelected = i === selectedIndex;
            return (
              <div
                key={`o-${i}`}
                role="option"
                id={`${listId}-option-${i}`}
                aria-selected={anchor.line ? isSelected : i === activeIndex}
                aria-disabled={it.disabled || undefined}
                title={it.title}
                className={[
                  'od-select-option',
                  i === activeIndex ? 'is-active' : '',
                  isSelected ? 'is-selected' : '',
                  it.disabled ? 'is-disabled' : '',
                ].filter(Boolean).join(' ')}
                onMouseEnter={() => { if (!it.disabled) setActiveIndex(i); }}
                onClick={() => commit(i)}
              >
                <span className="od-select-check" aria-hidden>{isSelected ? '✓' : ''}</span>
                <span className="od-select-option-label">{it.label}</span>
                {it.shortcut && <span className="od-select-shortcut">{it.shortcut}</span>}
              </div>
            );
          })}
          </div>
          {anchor.line && <ChoiceLineClose onClose={() => close(true)} />}
        </div>,
        modalPortalContainer(anchor.doc),
      )}
    </>
  );
};

export default Select;
