/**
 * The footer: the status lines and controls the writer placed on it
 * (Layout › Toolbar & footer), on its start, centre and end sides.
 *
 * At every width — a desktop window, a phone, a foldable folded or held open
 * like a book — the one-line strip shows what the writer placed, where they
 * placed it, for as long as it fits, in their order (start side, centre, end
 * side). What does not fit opens in a row above the strip from the arrow at
 * its end, in the same order, so nothing is lost or cut off at the edge. On a
 * narrow footer the script's name and save state shorten with an ellipsis into
 * the room that is left, and go up to the row when even a few letters will not
 * fit. The row wraps onto as many lines as it needs, and a footer too full for
 * that pans up and down.
 *
 * Opening it is a tap, not a swipe: a swipe up from the bottom edge is the
 * phone's own gesture to go home.
 */
import type { Editor } from '@tiptap/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaChevronUp } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { useSuggestModeStore } from '../stores/suggestModeStore';
import { isStatusItem, splitBySide, type ToolbarSide } from '../utils/toolbarLayout';
import { FOLD_CHANGE_EVENT } from '../utils/foldPosture';
import { FooterControls } from './Toolbar';
import { StatusItem } from './StatusItems';

/** At this width and below the footer is the narrow strip (the ≤480px phone rules in screenplay.css). */
export const NARROW_FOOTER_MAX_WIDTH = 480;

/**
 * Status lines that, on a narrow footer, shorten to fit rather than claim
 * their full width: the name can be long, and the save state comes and goes
 * with every save, which must not push the page count up to the row and back.
 */
const FLEXIBLE_STATUS = new Set(['status-title', 'status-save']);
/** The least a shortened line is given on the strip ("Untit…"); with less it goes to the row. */
const FLEXIBLE_MIN_WIDTH = 40;

/** One status line or control on the strip, as measured. */
interface StripUnit {
  id: string;
  side: ToolbarSide;
  /** A control's run (its FooterControls box); null for a status line. */
  run: Element | null;
  width: number;
}

interface StripRoom {
  width: number;
  /** Between the start side, the centre and the end side. */
  sideGap: number;
  gap: Record<ToolbarSide, number>;
  /** The gap between the controls of each run. */
  runGap: Map<Element, number>;
  /** Runs that draw nothing (every control in them renders nothing here) but still take a gap. */
  emptyRuns: Array<{ run: Element; side: ToolbarSide }>;
  endMargin: number;
  /** The Suggesting pill and the arrow: always on the strip, at its end. */
  endReserve: number[];
}

/**
 * The width the strip's content takes with only `chosen` on it, laid out as
 * the strip lays it out: each side a flex row with its gap, each run of
 * controls one item with its own gap inside.
 */
function stripWidth(units: StripUnit[], chosen: ReadonlySet<StripUnit>, room: StripRoom, flexible: boolean): number {
  const items: Record<ToolbarSide, number[]> = { start: [], center: [], end: [] };
  let run: Element | null = null;
  let runWidths: number[] = [];
  let runSide: ToolbarSide = 'start';
  const closeRun = () => {
    if (run && runWidths.length > 0) {
      items[runSide].push(runWidths.reduce((a, b) => a + b, 0) + (room.runGap.get(run) ?? 0) * (runWidths.length - 1));
    }
    run = null;
    runWidths = [];
  };
  for (const unit of units) {
    if (unit.run !== run) closeRun();
    if (unit.run) {
      run = unit.run;
      runSide = unit.side;
      if (chosen.has(unit)) runWidths.push(unit.width);
      continue;
    }
    if (!chosen.has(unit) || unit.width <= 0) continue;
    items[unit.side].push(flexible && FLEXIBLE_STATUS.has(unit.id) ? Math.min(unit.width, FLEXIBLE_MIN_WIDTH) : unit.width);
  }
  closeRun();
  for (const empty of room.emptyRuns) items[empty.side].push(0);
  items.end.push(...room.endReserve);
  const side = (widths: number[], gap: number) => (widths.length === 0 ? 0 : widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1));
  return side(items.start, room.gap.start) + side(items.center, room.gap.center) + side(items.end, room.gap.end)
    + room.endMargin + room.sideGap * 2;
}

/**
 * What goes up to the row: the first item, in the writer's order (start side,
 * centre, end side), that does not fit, and everything after it. On a narrow
 * footer the name and save state count at their shortest, and take whatever
 * room is left over.
 */
function stripOverflow(units: StripUnit[], room: StripRoom, flexible: boolean): string[] {
  const chosen = new Set<StripUnit>();
  const out: string[] = [];
  let full = false;
  for (const unit of units) {
    if (!full) {
      chosen.add(unit);
      if (stripWidth(units, chosen, room, flexible) <= room.width + 0.5) continue;
      chosen.delete(unit);
      full = true;
    }
    out.push(unit.id);
  }
  return out;
}

/** An element's width with its margins (a separator's are negative). Shortened text counts at its full width. */
function outerWidth(el: Element): number {
  const style = getComputedStyle(el);
  if (style.display === 'none') return 0;
  const box = el.getBoundingClientRect().width;
  return Math.max(box, el.scrollWidth) + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
}

interface StatusBarProps {
  editor: Editor | null;
  /** The scrolling pane the page sits in, measured for Fit width. */
  editorMain?: HTMLElement | null;
}

/**
 * Whether the footer is the narrow strip: its own width, so a foldable held as
 * a book (whose footer spans only the left half) counts, as does a narrow
 * window, not just a phone.
 */
function useNarrowFooter(ref: React.RefObject<HTMLElement | null>): boolean {
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      try {
        const book = document.documentElement.classList.contains('fold-book');
        const width = el.getBoundingClientRect().width;
        // A footer not laid out yet (width 0) keeps its last answer.
        if (width === 0 && !book) return;
        setNarrow(book || width <= NARROW_FOOTER_MAX_WIDTH);
      } catch (err) {
        console.warn('[StatusBar] could not measure the footer', err);
      }
    };
    measure();
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    } catch (err) {
      console.warn('[StatusBar] ResizeObserver unavailable; measuring on resize only', err);
    }
    window.addEventListener('resize', measure);
    window.addEventListener(FOLD_CHANGE_EVENT, measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener(FOLD_CHANGE_EVENT, measure);
    };
  }, [ref]);
  return narrow;
}

/**
 * Status lines and controls in the writer's order. Status lines draw
 * themselves; each run of controls between them is one FooterControls, which
 * puts its separators between the controls in the run as it always has.
 *
 * On the strip (`hidden` given) each status line sits in a slot the strip
 * measures; a line or control that did not fit stays where it is, unseen and
 * at its full width, so it can be measured again, while the row shows it.
 */
function FooterRun({ ids, editor, editorMain, hidden }: {
  ids: string[];
  editor: Editor | null;
  editorMain: HTMLElement | null;
  hidden?: ReadonlySet<string>;
}) {
  const parts = useMemo(() => {
    const out: Array<{ key: string; status?: string; lead?: boolean; controls?: string[] }> = [];
    let run: string[] = [];
    const flush = () => {
      if (run.length > 0) out.push({ key: `controls:${run.join(',')}`, controls: run });
      run = [];
    };
    ids.forEach((id, index) => {
      if (isStatusItem(id)) {
        flush();
        out.push({ key: id, status: id, lead: index > 0 });
      } else {
        run.push(id);
      }
    });
    flush();
    return out;
  }, [ids]);
  return (
    <>
      {parts.map((part) => {
        if (!part.status) {
          return <FooterControls key={part.key} editor={editor} editorMain={editorMain} items={part.controls!} hidden={hidden} />;
        }
        const item = <StatusItem key={part.key} id={part.status} editor={editor} lead={!!part.lead} />;
        if (!hidden) return item;
        const off = hidden.has(part.status);
        return (
          <span key={part.key} className={`status-slot${off ? ' is-overflow' : ''}`} data-slot={part.status}
            aria-hidden={off || undefined} inert={off || undefined}>
            {item}
          </span>
        );
      })}
    </>
  );
}

const StatusBar: React.FC<StatusBarProps> = ({ editor, editorMain = null }) => {
  const { t } = useTranslation('toolbar');
  const layout = useEditorStore((s) => s.toolbarLayout);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrowFooter(wrapRef);
  const [openChoice, setOpen] = useState(false);
  // What did not fit the strip, which the row shows instead.
  const [overflowKey, setOverflowKey] = useState('');
  const overflow = useMemo(() => new Set(overflowKey ? overflowKey.split(' ') : []), [overflowKey]);

  // The strip holds everything, each on the side the writer chose; the row,
  // in the writer's order, what did not fit.
  const { strip, row } = useMemo(() => {
    const sides = splitBySide(layout.bars.bottom, layout.options);
    return {
      strip: sides,
      row: [...sides.start, ...sides.center, ...sides.end].filter((id) => overflow.has(id)),
    };
  }, [layout, overflow]);
  const hasRow = row.length > 0;

  // Fit the strip: measure what is on it and send what does not fit to the
  // row. Each item keeps the widest it has been (until the layout or the
  // footer's width changes), so one that grows — the current element going
  // from "Action" to "Scene Heading", a save state appearing — moves once
  // rather than back and forth.
  const widest = useRef(new Map<string, number>());
  const lastRoom = useRef({ width: -1, layout: null as unknown, narrow: false });
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const bar = wrap?.querySelector<HTMLElement>(':scope > .status-bar');
    if (!wrap || !bar) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      try {
        const style = getComputedStyle(bar);
        const width = bar.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
        if (width <= 0) return;
        const last = lastRoom.current;
        if (Math.abs(width - last.width) > 1 || last.layout !== layout || last.narrow !== narrow) {
          widest.current.clear();
          lastRoom.current = { width, layout, narrow };
        }
        const containers: Record<ToolbarSide, Element | null> = {
          start: bar.querySelector(':scope > .status-left'),
          center: bar.querySelector(':scope > .status-center'),
          end: bar.querySelector(':scope > .status-right'),
        };
        const sideOf = (el: Element): ToolbarSide =>
          (containers.end?.contains(el) ? 'end' : containers.center?.contains(el) ? 'center' : 'start');
        const gapOf = (el: Element | null) => (el ? parseFloat(getComputedStyle(el).columnGap) || 0 : 0);

        const units: StripUnit[] = [];
        bar.querySelectorAll<HTMLElement>('.status-slot, .footer-controls > .toolbar-priority-block').forEach((el) => {
          const id = el.dataset.slot ?? el.dataset.item;
          if (!id) return;
          const side = sideOf(el);
          const isSlot = el.classList.contains('status-slot');
          let measured: number;
          if (el.classList.contains('is-overflow')) {
            measured = el.getBoundingClientRect().width;
          } else if (isSlot) {
            const kids = [...el.children].map(outerWidth).filter((w) => w > 0);
            measured = kids.length === 0 ? 0 : kids.reduce((a, b) => a + b, 0) + gapOf(containers[side]) * (kids.length - 1);
          } else {
            measured = outerWidth(el);
          }
          const w = Math.max(measured, widest.current.get(id) ?? 0);
          widest.current.set(id, w);
          units.push({ id, side, run: isSlot ? null : el.closest('.footer-controls'), width: w });
        });

        const runGap = new Map<Element, number>();
        const emptyRuns: StripRoom['emptyRuns'] = [];
        bar.querySelectorAll('.footer-controls').forEach((run) => {
          runGap.set(run, gapOf(run));
          if (!units.some((u) => u.run === run) && getComputedStyle(run).display !== 'contents') {
            emptyRuns.push({ run, side: sideOf(run) });
          }
        });

        const pill = containers.end?.querySelector('.suggest-mode-pill');
        const arrow = containers.end?.querySelector('.status-row-toggle');
        const arrowWidth = arrow
          ? arrow.getBoundingClientRect().width + (parseFloat(getComputedStyle(arrow).marginInlineEnd) || 0)
          : (document.documentElement.classList.contains('phone') ? 40 : 36) - 6;
        const room = (withArrow: boolean): StripRoom => ({
          width,
          sideGap: parseFloat(style.columnGap) || 0,
          gap: { start: gapOf(containers.start), center: gapOf(containers.center), end: gapOf(containers.end) },
          runGap,
          emptyRuns,
          endMargin: containers.end ? parseFloat(getComputedStyle(containers.end).marginInlineStart) || 0 : 0,
          endReserve: [
            ...(pill ? [pill.getBoundingClientRect().width] : []),
            ...(withArrow ? [arrowWidth] : []),
          ],
        });
        let out = stripOverflow(units, room(false), narrow);
        // Something going up to the row brings the arrow, which needs room too.
        if (out.length > 0) out = stripOverflow(units, room(true), narrow);
        const key = out.join(' ');
        setOverflowKey((prev) => (prev === key ? prev : key));
      } catch (err) {
        console.warn('[StatusBar] could not fit the footer strip', err);
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
    fit();
    let resize: ResizeObserver | null = null;
    let mutation: MutationObserver | null = null;
    try {
      resize = new ResizeObserver(schedule);
      resize.observe(bar);
      // An item's text changing (the page, the word count, the element) can change what fits.
      mutation = new MutationObserver(schedule);
      mutation.observe(bar, { childList: true, subtree: true, characterData: true });
    } catch (err) {
      console.warn('[StatusBar] observers unavailable; fitting the footer strip on resize only', err);
    }
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      mutation?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [narrow, layout, overflowKey]);

  // With everything on the strip there is no row to show.
  const open = openChoice && hasRow;

  // The row's top edge, for menus that open upwards out of it: a row too full
  // for the screen scrolls, which would clip them, so they are placed against
  // the window instead (workspaceLayout.css). Its height follows what is on it
  // and how many lines that wraps to, so it is measured again when that changes.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      try {
        const row = rowRef.current;
        const bar = wrapRef.current?.querySelector('.status-bar');
        if (!row || !bar) return;
        // From the strip, not the row, which is still sliding in: its
        // transform would put the row's top at the strip's.
        const top = bar.getBoundingClientRect().top - row.offsetHeight;
        row.style.setProperty('--footer-row-lift', `${Math.max(0, Math.round(window.innerHeight - top))}px`);
      } catch (err) {
        console.warn('[StatusBar] could not place the footer row', err);
      }
    };
    place();
    let observer: ResizeObserver | null = null;
    try {
      observer = new ResizeObserver(place);
      if (rowRef.current) observer.observe(rowRef.current);
    } catch (err) {
      console.warn('[StatusBar] ResizeObserver unavailable; placing the footer row on resize only', err);
    }
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Tapping the script closes the row, as does Escape.
  useEffect(() => {
    if (!open) return;
    const pane = editorMain ?? document.querySelector<HTMLElement>('.editor-main');
    const onPointerDown = () => setOpen(false);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setOpen(false);
      wrapRef.current?.querySelector<HTMLButtonElement>('.status-row-toggle')?.focus();
    };
    pane?.addEventListener('pointerdown', onPointerDown);
    wrapRef.current?.addEventListener('keydown', onKeyDown);
    const wrap = wrapRef.current;
    return () => {
      pane?.removeEventListener('pointerdown', onPointerDown);
      wrap?.removeEventListener('keydown', onKeyDown);
    };
  }, [open, editorMain]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <div className={`status-bar-wrap${narrow ? ' is-narrow' : ''}`} ref={wrapRef}>
      {hasRow && (
        <div className={`status-row${open ? ' is-open' : ''}`} id="footer-controls-row" inert={!open}>
          <div className="status-row-scroll footer-controls" ref={rowRef} role="toolbar" aria-label={t('status.footerControls')}>
            <FooterRun ids={row} editor={editor} editorMain={editorMain} />
          </div>
        </div>
      )}
      <div className="status-bar">
        <div className="status-left">
          <FooterRun ids={strip.start} editor={editor} editorMain={editorMain} hidden={overflow} />
        </div>
        <div className="status-center">
          <FooterRun ids={strip.center} editor={editor} editorMain={editorMain} hidden={overflow} />
        </div>
        <div className="status-right">
          {/* Not a footer item: while edits become suggestions the writer must see it. */}
          <SuggestingPill />
          <FooterRun ids={strip.end} editor={editor} editorMain={editorMain} hidden={overflow} />
          {hasRow && (
            <button
              type="button"
              className={`status-row-toggle${open ? ' is-open' : ''}`}
              aria-expanded={open}
              aria-controls="footer-controls-row"
              aria-label={open ? t('status.hideFooterControls') : t('status.showFooterControls')}
              title={open ? t('status.hideFooterControls') : t('status.showFooterControls')}
              onClick={toggle}
            >
              <FaChevronUp aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StatusBar;

/** "Suggesting" while edits become suggestions; click to stop, unless a Suggest invite holds it on. */
function SuggestingPill() {
  const { t } = useTranslation('toolbar');
  const suggesting = useSuggestModeStore((st) => st.suggesting);
  const locked = useSuggestModeStore((st) => st.locked);
  if (!suggesting) return null;
  return (
    <button
      type="button"
      className="suggest-mode-pill"
      disabled={locked}
      onClick={() => useSuggestModeStore.getState().setSuggesting(false)}
      title={locked ? t('status.suggesting.lockedTitle') : t('status.suggesting.title')}
    >
      &#9998; {t('status.suggesting.label')}
    </button>
  );
}
