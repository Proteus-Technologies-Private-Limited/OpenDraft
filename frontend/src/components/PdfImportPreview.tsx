/**
 * The PDF import preview (File ▸ Import, drag-and-drop, opening a PDF from the
 * OS, a project's Import Script — everything that goes through
 * utils/importScreenplay).
 *
 * Lists every paragraph read off the PDF with the element type it was given
 * and the scene it falls in, so lines read wrongly can be selected in bulk and
 * set right before the import replaces anything. Cancel leaves the open
 * script as it was: nothing is reset until Import.
 *
 * The list is windowed — a feature script is a few thousand rows, and only the
 * ones on screen are rendered.
 */
import React, { useCallback, useId, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import type { JSONContent } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { showToast } from './Toast';
import Select from './Select';
import type { ParsedPdfScreenplay } from '../utils/pdfImport';
import {
  REVIEW_TYPES, REVIEW_TYPE_LABELS,
  reviewRowsFrom, sceneOrdinals, clickSelect, selectSameType, selectSameLook,
  setTypeOf, countChanged, applyReviewedTypes, setPdfImportReviewer,
  type ClickModifiers, type PdfImportReviewRequest, type SelectionState,
} from '../utils/pdfImportReview';

/** Rows drawn above and below the visible window, so a fast scroll does not show blanks. */
const OVERSCAN = 12;
/** Undo steps kept. */
const HISTORY_LIMIT = 50;

type Filter = 'all' | 'changed' | string;

const isPhone = () => typeof document !== 'undefined' && document.documentElement.classList.contains('phone');

interface DialogProps {
  filename: string;
  parsed: ParsedPdfScreenplay;
  onImport: (doc: JSONContent) => void;
  onCancel: () => void;
}

export const PdfImportPreviewDialog: React.FC<DialogProps> = ({ filename, parsed, onImport, onCancel }) => {
  const { t } = useTranslation(['tools', 'common']);
  const rowPrefix = useId();
  const rows = useMemo(() => reviewRowsFrom(parsed), [parsed]);
  const [types, setTypes] = useState<string[]>(() => rows.map((r) => r.originalType));
  const history = useRef<string[][]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [sel, setSel] = useState<SelectionState>({ selected: new Set(), anchor: null });
  const [filter, setFilter] = useState<Filter>('all');
  /** Touch has no shift key: the next tap extends from the anchor. */
  const [rangeNext, setRangeNext] = useState(false);

  // Row height follows the layout: a phone row has to be a finger tall.
  const [rowHeight] = useState(() => (isPhone() ? 44 : 28));
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(400);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight || 400);
    measure();
    // Keyboard selection works straight away.
    el.focus({ preventScroll: true });
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scenes = useMemo(() => sceneOrdinals(types), [types]);
  const changed = useMemo(() => countChanged(rows, types), [rows, types]);
  const order = useMemo(() => {
    const all = rows.map((_, i) => i);
    if (filter === 'all') return all;
    if (filter === 'changed') return all.filter((i) => types[i] !== rows[i].originalType);
    return all.filter((i) => types[i] === filter);
  }, [rows, types, filter]);
  const isLocked = useCallback((i: number) => rows[i]?.locked ?? true, [rows]);
  /** Types present in the script, for the filter. */
  const presentTypes = useMemo(() => {
    const seen = new Set(types);
    return [...REVIEW_TYPES, 'dualDialogue'].filter((ty) => seen.has(ty));
  }, [types]);

  const commitTypes = useCallback((next: string[]) => {
    if (next === types) return;
    history.current.push(types);
    if (history.current.length > HISTORY_LIMIT) history.current.shift();
    setCanUndo(true);
    setTypes(next);
  }, [types]);

  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    setTypes(prev);
    setCanUndo(history.current.length > 0);
  };

  // Only what can be seen counts as selected: a row the filter hides would
  // otherwise be retyped without the writer knowing it was still selected.
  const selected = useMemo(() => {
    if (filter === 'all') return sel.selected;
    const shown = new Set(order);
    return new Set([...sel.selected].filter((i) => shown.has(i)));
  }, [sel.selected, order, filter]);

  const setSelectedType = (type: string) => {
    if (selected.size === 0) return;
    commitTypes(setTypeOf(rows, types, selected, type));
  };

  const scrollToRow = useCallback((rowIndex: number) => {
    const el = listRef.current;
    const pos = order.indexOf(rowIndex);
    if (!el || pos === -1) return;
    const top = pos * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + rowHeight - el.clientHeight;
  }, [order, rowHeight]);

  const click = (index: number, mods: ClickModifiers) => {
    const useRange = mods.range || rangeNext;
    setSel((s) => clickSelect(s, index, { range: useRange, toggle: mods.toggle || (rangeNext && useRange) }, order, isLocked));
    if (rangeNext) setRangeNext(false);
  };

  const selectAllShown = () => setSel((s) => ({ selected: new Set(order.filter((i) => !isLocked(i))), anchor: s.anchor }));
  const selectNone = () => setSel({ selected: new Set(), anchor: null });

  const doImport = () => {
    try {
      onImport(applyReviewedTypes(parsed.doc, rows, types));
    } catch (err) {
      console.error('[PDF import preview] could not build the reviewed document:', err);
      showToast(t('pdfImport.importFailed', { message: err instanceof Error ? err.message : String(err) }), 'error');
    }
  };

  // Keys the list handles stop here, so the editor behind the dialog does not
  // act on them too (⌘A, ⌘Z).
  const onListKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      e.stopPropagation();
      selectAllShown();
      return;
    }
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      undo();
      return;
    }
    if (e.key === ' ' && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      const target = sel.anchor !== null && order.includes(sel.anchor) ? sel.anchor : order.find((i) => !isLocked(i));
      if (target !== undefined && !isLocked(target)) click(target, { toggle: true });
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      if (order.length === 0) return;
      const pos = sel.anchor === null ? -1 : order.indexOf(sel.anchor);
      const step = e.key === 'ArrowDown' || e.key === 'Home' ? 1 : -1;
      let p = e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1
        : pos === -1 ? (step === 1 ? 0 : order.length - 1) : pos + step;
      while (p >= 0 && p < order.length && isLocked(order[p])) p += step;
      if (p < 0 || p >= order.length) return;
      const target = order[p];
      if (e.shiftKey && sel.anchor !== null) {
        // Shift+arrow grows the selection a line at a time.
        setSel((s) => {
          const next = new Set(s.selected);
          next.add(target);
          return { selected: next, anchor: target };
        });
      } else if (mod) {
        // Move the active row without clearing a noncontiguous selection.
        setSel((s) => ({ selected: s.selected, anchor: target }));
      } else {
        setSel({ selected: new Set([target]), anchor: target });
      }
      scrollToRow(target);
      return;
    }
    // 1–8 set the selected lines to the nth type in the picker.
    if (!mod && !e.altKey && /^[1-8]$/.test(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      setSelectedType(REVIEW_TYPES[Number(e.key) - 1]);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const total = order.length;
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const last = Math.min(total, Math.ceil((scrollTop + viewport) / rowHeight) + OVERSCAN);
  const selectedCount = selected.size;
  const bodyCount = rows.length;

  return (
    <ModalOverlay className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog-box pdf-review-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-review-title"
      >
        <div className="dialog-header" id="pdf-review-title">
          {t('pdfImport.title')} <span className="pdf-review-file">{filename}</span>
        </div>
        <div className="dialog-body pdf-review-body">
          <p className="pdf-review-help">
            {t('pdfImport.help')}
          </p>
          {parsed.warnings.map((w) => <p key={w} className="pdf-review-warning" role="status">{w}</p>)}

          <div className="pdf-review-toolbar">
            <label className="pdf-review-filter">
              <span>{t('pdfImport.show')}</span>
              <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('pdfImport.showLines')}>
                <option value="all">{t('pdfImport.filterAll')}</option>
                <option value="changed">{t('pdfImport.filterChanged')}</option>
                {presentTypes.map((ty) => <option key={ty} value={ty}>{REVIEW_TYPE_LABELS[ty] ?? ty}</option>)}
              </Select>
            </label>
            <div className="pdf-review-select-btns" role="group" aria-label={t('pdfImport.select')}>
              <button type="button" className="dialog-btn" onClick={selectAllShown} disabled={total === 0}>{t('pdfImport.all')}</button>
              <button type="button" className="dialog-btn" onClick={selectNone} disabled={selectedCount === 0}>{t('common:none')}</button>
              <button
                type="button"
                className="dialog-btn"
                onClick={() => setSel((s) => ({ selected: selectSameType(rows, types, selected), anchor: s.anchor }))}
                disabled={selectedCount === 0}
                title={t('pdfImport.sameTypeTitle')}
              >
                {t('pdfImport.sameType')}
              </button>
              <button
                type="button"
                className="dialog-btn"
                onClick={() => setSel((s) => ({ selected: selectSameLook(rows, selected), anchor: s.anchor }))}
                disabled={selectedCount === 0}
                title={t('pdfImport.sameIndentTitle')}
              >
                {t('pdfImport.sameIndent')}
              </button>
              <button
                type="button"
                className={`dialog-btn pdf-review-range${rangeNext ? ' active' : ''}`}
                onClick={() => setRangeNext((r) => !r)}
                disabled={sel.anchor === null}
                aria-pressed={rangeNext}
                title={t('pdfImport.rangeTitle')}
              >
                {t('pdfImport.range')}
              </button>
            </div>
          </div>

          <div
            ref={listRef}
            className="pdf-review-list"
            role="listbox"
            aria-multiselectable="true"
            aria-activedescendant={sel.anchor !== null && order.indexOf(sel.anchor) >= first && order.indexOf(sel.anchor) < last
              ? `${rowPrefix}-line-${sel.anchor}` : undefined}
            aria-label={t('pdfImport.importedLines')}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            {total === 0 && <p className="pdf-review-empty">{t('pdfImport.noLines')}</p>}
            <div className="pdf-review-spacer" style={{ height: total * rowHeight }}>
              {order.slice(first, last).map((i, k) => {
                const row = rows[i];
                const type = types[i];
                const isSelected = selected.has(i);
                const isChanged = type !== row.originalType;
                return (
                  <div
                    key={i}
                    className={`pdf-review-row${isSelected ? ' selected' : ''}${isChanged ? ' changed' : ''}${row.locked ? ' locked' : ''}`}
                    style={{ top: (first + k) * rowHeight, height: rowHeight }}
                    id={`${rowPrefix}-line-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={row.locked || undefined}
                    aria-posinset={first + k + 1}
                    aria-setsize={total}
                    onClick={(e) => click(i, { range: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
                  >
                    <span
                      className={`pdf-review-checkbox${isSelected ? ' is-checked' : ''}`}
                      aria-hidden="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!row.locked) click(i, { toggle: true, range: e.shiftKey });
                      }}
                    >{isSelected ? '✓' : ''}</span>
                    <span className="pdf-review-scene" title={t('pdfImport.scene')}>{scenes[i] > 0 ? scenes[i] : ''}</span>
                    <span className={`pdf-review-type pdf-review-type-${type}`} title={isChanged ? t('pdfImport.readAs', { type: REVIEW_TYPE_LABELS[row.originalType] ?? row.originalType }) : undefined}>
                      {REVIEW_TYPE_LABELS[type] ?? type}
                    </span>
                    <span className={`pdf-review-text pdf-review-text-${type}`}>{row.text || ' '}</span>
                    <span className="pdf-review-meta">
                      {row.page !== null ? t('pdfImport.pageShort', { page: row.page }) : ''}
                      {row.indent !== null ? ` · ${row.indent.toFixed(1)}″` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pdf-review-apply">
            <span className="pdf-review-count">{t('pdfImport.selectedCount', { count: selectedCount })}</span>
            <label className="pdf-review-settype">
              <span>{t('pdfImport.setType')}</span>
              <Select
                value=""
                onChange={(e) => { if (e.target.value) setSelectedType(e.target.value); }}
                disabled={selectedCount === 0}
                aria-label={t('pdfImport.setTypeLabel')}
              >
                <option value="">{t('pdfImport.choose')}</option>
                {REVIEW_TYPES.map((ty, n) => <option key={ty} value={ty}>{REVIEW_TYPE_LABELS[ty]} ({n + 1})</option>)}
              </Select>
            </label>
            <button type="button" className="dialog-btn" onClick={undo} disabled={!canUndo}>{t('pdfImport.undo')}</button>
            <button
              type="button"
              className="dialog-btn"
              onClick={() => commitTypes(rows.map((r) => r.originalType))}
              disabled={changed === 0}
            >
              {t('pdfImport.revertAll')}
            </button>
          </div>
        </div>
        <div className="dialog-actions">
          <span className="pdf-review-summary">
            {t('pdfImport.lineCount', { count: bodyCount })}{changed > 0 ? ` · ${t('pdfImport.changedCount', { count: changed })}` : ''}
          </span>
          <button onClick={onCancel}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={doImport}>{t('common:import')}</button>
        </div>
      </div>
    </ModalOverlay>
  );
};

interface Pending {
  id: number;
  request: PdfImportReviewRequest;
  resolve: (doc: JSONContent | null) => void;
}

/**
 * Mounted once (App.tsx): registers the preview with the import path and
 * shows one request at a time. Requests that arrive while one is open wait
 * their turn; any still waiting when it unmounts are cancelled.
 */
const PdfImportPreviewHost: React.FC = () => {
  const [queue, setQueue] = useState<Pending[]>([]);
  const queueRef = useRef<Pending[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  useEffect(() => {
    let nextId = 0;
    const unregister = setPdfImportReviewer((request) => new Promise((resolve) => {
      setQueue((q) => [...q, { id: ++nextId, request, resolve }]);
    }));
    return () => {
      unregister();
      for (const p of queueRef.current) p.resolve(null);
    };
  }, []);

  const current = queue[0];
  const finish = useCallback((pending: Pending, doc: JSONContent | null) => {
    pending.resolve(doc);
    setQueue((q) => q.filter((p) => p !== pending));
  }, []);
  const cancel = useCallback(() => { if (current) finish(current, null); }, [current, finish]);

  if (!current) return null;
  return (
    <PdfImportPreviewDialog
      // A fresh dialog per file: its selection and edits belong to that file.
      key={current.id}
      filename={current.request.filename}
      parsed={current.request.parsed}
      onImport={(doc) => finish(current, doc)}
      onCancel={cancel}
    />
  );
};

export default PdfImportPreviewHost;
