import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  FONT_CATEGORIES, loadFont, getFontsByCategory, findFont, fontStack, subscribeFonts,
  getFontsVersion,
} from '../utils/fonts';
import type { FontEntry } from '../utils/fonts';
import { isFontInstalled } from '../utils/deviceFonts';

interface FontPickerProps {
  value: string;
  onChange: (fontName: string) => void;
  extraFonts?: string[];
  /** Overrides the trigger's class, for the panels that style their own inputs. */
  className?: string;
  /** What an empty value means here — "Default" in the template editor. */
  emptyLabel?: string;
  title?: string;
  /** Offered above the list, for opening the font manager. */
  onManageFonts?: () => void;
}

interface Row {
  kind: 'header' | 'font';
  label: string;
  entry?: FontEntry;
  /** Set for the row that clears the value back to the document/template default. */
  isEmpty?: boolean;
}

const DOCUMENT_GROUP = 'From This Document';

/** Where the popup sits, in viewport coordinates. */
interface Anchor {
  left: number;
  width: number;
  /** Set when the list hangs below the trigger. */
  top?: number;
  /** Set instead when it had to flip above — distance from the viewport bottom. */
  bottom?: number;
  maxHeight: number;
}

/** Enough room for a search field and a few rows; below this, flip above. */
const MIN_ROOM_BELOW = 220;
const EDGE_GAP = 8;

/**
 * Fit the popup to the trigger and the viewport.
 *
 * `visualViewport` rather than `innerHeight`: on an iPad the soft keyboard
 * covers the bottom of the window without changing `innerHeight`, so a list
 * measured against the window would open underneath the keyboard.
 */
function anchorTo(trigger: HTMLElement): Anchor {
  const rect = trigger.getBoundingClientRect();
  const vw = window.visualViewport?.width ?? window.innerWidth;
  const vh = window.visualViewport?.height ?? window.innerHeight;

  const width = Math.min(Math.max(rect.width, 260), vw - EDGE_GAP * 2);
  const left = Math.max(EDGE_GAP, Math.min(rect.left, vw - width - EDGE_GAP));

  const roomBelow = vh - rect.bottom - EDGE_GAP;
  const roomAbove = rect.top - EDGE_GAP;
  if (roomBelow >= MIN_ROOM_BELOW || roomBelow >= roomAbove) {
    return { left, width, top: rect.bottom + 2, maxHeight: Math.max(140, roomBelow) };
  }
  return { left, width, bottom: vh - rect.top + 2, maxHeight: Math.max(140, roomAbove) };
}

/** Whether this is a touch screen, where a soft keyboard is a real cost. */
function isCoarsePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** A font's rows are searched by name and by the group they sit in. */
function matches(query: string, name: string, group: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return name.toLowerCase().includes(q) || group.toLowerCase().includes(q);
}

const FontPicker: React.FC<FontPickerProps> = ({
  value, onChange, extraFonts = [], className = 'font-selector', emptyLabel, title = 'Font Family',
  onManageFonts,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Custom and device fonts arrive after startup, so the list has to re-read.
  const fontsVersion = useSyncExternalStore(subscribeFonts, getFontsVersion, () => 0);

  const buildRows = useCallback((search: string): Row[] => {
    // fontsVersion is only read so this is rebuilt when custom or device fonts
    // arrive; getFontsByCategory() is what actually supplies them.
    void fontsVersion;
    const byCategory = getFontsByCategory();
    const out: Row[] = [];

    if (emptyLabel && matches(search, emptyLabel, '')) {
      out.push({ kind: 'font', label: emptyLabel, isEmpty: true });
    }

    // Fonts the document names that we know nothing about — kept at the top so
    // an imported script's own faces are the first thing the writer sees.
    const unknown = extraFonts.filter((name) => name && !findFont(name));
    const documentRows = unknown.filter((name) => matches(search, name, DOCUMENT_GROUP));
    if (documentRows.length > 0) {
      out.push({ kind: 'header', label: DOCUMENT_GROUP });
      for (const name of documentRows) out.push({ kind: 'font', label: name });
    }

    for (const category of FONT_CATEGORIES) {
      const fonts = (byCategory[category] || []).filter((f) => matches(search, f.name, category));
      if (fonts.length === 0) continue;
      out.push({ kind: 'header', label: category });
      for (const font of fonts) out.push({ kind: 'font', label: font.name, entry: font });
    }
    return out;
  }, [extraFonts, emptyLabel, fontsVersion]);

  const rows = useMemo(() => buildRows(query), [buildRows, query]);

  const selectableIndexes = useMemo(
    () => rows.map((r, i) => (r.kind === 'font' ? i : -1)).filter((i) => i >= 0),
    [rows],
  );

  const openList = useCallback(() => {
    // Fixed positioning: the picker sits inside toolbars and dialogs that clip
    // their own overflow, and a dropdown that gets cut off is unusable.
    if (buttonRef.current) setAnchor(anchorTo(buttonRef.current));
    // Open on the current font, so the list starts where the writer is rather
    // than at the top of a hundred and eighty families.
    const fresh = buildRows('');
    const current = fresh.findIndex((r) => r.kind === 'font' && !r.isEmpty && r.label === value);
    const firstSelectable = fresh.findIndex((r) => r.kind === 'font');
    setActiveIndex(current >= 0 ? current : Math.max(0, firstSelectable));
    setQuery('');
    setOpen(true);
  }, [buildRows, value]);

  const commit = useCallback((row: Row) => {
    if (row.entry) loadFont(row.entry);
    onChange(row.isEmpty ? '' : row.label);
    setOpen(false);
    buttonRef.current?.focus();
  }, [onChange]);

  // Typing filters the list, so on a keyboard the search field takes focus as
  // it appears. Never on a touch screen: focusing it raises the soft keyboard,
  // which covers most of the list — and on an iPad the resize that came with it
  // used to close the popup outright, so a tap appeared to do nothing at all.
  useEffect(() => {
    if (!open) return;
    if (!isCoarsePointer()) searchRef.current?.focus();
    listRef.current?.querySelector<HTMLElement>('.font-picker-option.is-active')
      ?.scrollIntoView({ block: 'center' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: Event) => {
      const target = e.target as Node;
      // The whole popup, not just the list: "Add or manage fonts…" sits below
      // it, and closing on mousedown unmounted the button before its click
      // could land — so the item did nothing at all.
      if (popupRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    // The popup is measured against the trigger, so anything that moves the
    // trigger has to move the popup. Following it beats closing: a soft keyboard
    // appearing is a resize, and a dialog settling after a tap is a scroll —
    // treating either as "the writer looked away" is why this never opened on an
    // iPad.
    const reposition = (e?: Event) => {
      if (e && listRef.current && e.target instanceof Node && listRef.current.contains(e.target)) return;
      if (buttonRef.current) setAnchor(anchorTo(buttonRef.current));
    };
    document.addEventListener('mousedown', onPointerDown);
    // Touch screens deliver touchstart well before the synthesised mousedown.
    document.addEventListener('touchstart', onPointerDown as EventListener);
    window.addEventListener('resize', reposition);
    // Capture phase: the editor scrolls its own container, not the window.
    window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('scroll', reposition);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown as EventListener);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('scroll', reposition);
    };
  }, [open]);

  // Load the webfonts for rows actually on screen, so a list of 180 families
  // costs one stylesheet per font the writer scrolls past — not 180 at once.
  useEffect(() => {
    if (!open || !listRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const name = (entry.target as HTMLElement).dataset.font;
        const found = name ? findFont(name) : undefined;
        if (found) loadFont(found);
        observer.unobserve(entry.target);
      }
    }, { root: listRef.current, rootMargin: '160px' });
    for (const el of listRef.current.querySelectorAll<HTMLElement>('[data-font]')) observer.observe(el);
    return () => observer.disconnect();
  }, [open, rows]);

  const move = (delta: number) => {
    const position = selectableIndexes.indexOf(activeIndex);
    const next = position < 0
      ? selectableIndexes[0]
      : selectableIndexes[Math.min(selectableIndexes.length - 1, Math.max(0, position + delta))];
    if (next === undefined) return;
    setActiveIndex(next);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActiveIndex(selectableIndexes[0] ?? 0); }
    else if (e.key === 'End') { e.preventDefault(); setActiveIndex(selectableIndexes[selectableIndexes.length - 1] ?? 0); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[activeIndex];
      if (row?.kind === 'font') commit(row);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  // A selection spanning several fonts has no single value; show nothing rather
  // than claim one.
  const triggerLabel = value === '' ? (emptyLabel || '—') : value;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${className} font-picker-trigger`}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        style={value ? { fontFamily: fontStack(value) } : undefined}
      >
        <span className="font-picker-trigger-label">{triggerLabel}</span>
        <span className="font-picker-caret" aria-hidden>▾</span>
      </button>

      {open && anchor && (
        <div
          ref={popupRef}
          className="font-picker-popup"
          style={{
            left: anchor.left,
            top: anchor.top,
            bottom: anchor.bottom,
            width: anchor.width,
            maxHeight: anchor.maxHeight,
          }}
          role="dialog"
        >
          <div className="font-picker-search-row">
            <input
              ref={searchRef}
              className="font-picker-search"
              type="text"
              placeholder="Search fonts…"
              value={query}
              onChange={(e) => {
                // Move the highlight onto the first match as the writer types,
                // so Enter selects what they are looking at rather than a row
                // that the filter has just scrolled away.
                const search = e.target.value;
                const next = buildRows(search);
                const first = next.findIndex((r) => r.kind === 'font');
                setActiveIndex(Math.max(0, first));
                setQuery(search);
              }}
              onKeyDown={onKeyDown}
              aria-label="Search fonts"
            />
          </div>
          <div className="font-picker-list" ref={listRef} role="listbox" tabIndex={-1}>
            {rows.length === 0 && <div className="font-picker-empty">No font matches “{query}”.</div>}
            {rows.map((row, index) => {
              if (row.kind === 'header') {
                return <div key={`h-${row.label}`} className="font-picker-group">{row.label}</div>;
              }
              const entry = row.entry;
              // Only faces meant to come from the machine can be reported
              // missing; a webfont is fetched on demand and a bundled one is
              // always there.
              const missing = !!entry && (entry.source === 'system' || entry.source === 'device')
                && !isFontInstalled(entry.name);
              const selected = row.isEmpty ? value === '' : row.label === value;
              return (
                <div
                  key={`f-${row.label}-${index}`}
                  data-index={index}
                  data-font={row.isEmpty ? undefined : row.label}
                  role="option"
                  aria-selected={selected}
                  className={[
                    'font-picker-option',
                    index === activeIndex ? 'is-active' : '',
                    selected ? 'is-selected' : '',
                    missing ? 'is-missing' : '',
                  ].filter(Boolean).join(' ')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(row)}
                  style={row.isEmpty ? undefined : { fontFamily: fontStack(row.label) }}
                  title={missing ? `${row.label} is not installed on this device — a similar font is shown instead` : row.label}
                >
                  <span className="font-picker-option-name">{row.label}</span>
                  {missing && <span className="font-picker-missing-tag">not installed</span>}
                </div>
              );
            })}
          </div>
          {onManageFonts && (
            <button
              type="button"
              className="font-picker-manage"
              onClick={() => { setOpen(false); onManageFonts(); }}
            >
              Add or manage fonts…
            </button>
          )}
        </div>
      )}
    </>
  );
};

export default FontPicker;
