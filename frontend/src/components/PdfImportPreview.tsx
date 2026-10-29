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
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/react';
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
    return [...REVIEW_TYPES, 'dualDialogue'].filter((t) => seen.has(t));
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
      showToast(`Import failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
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
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (order.length === 0) return;
      const pos = sel.anchor === null ? -1 : order.indexOf(sel.anchor);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      let p = pos === -1 ? (step === 1 ? 0 : order.length - 1) : pos + step;
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
    <div className="dialog-overlay" onClick={onCancel}>
      <div
        className="dialog-box pdf-review-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-review-title"
      >
        <div className="dialog-header" id="pdf-review-title">
          Import Preview <span className="pdf-review-file">{filename}</span>
        </div>
        <div className="dialog-body pdf-review-body">
          <p className="pdf-review-help">
            Check how each line of the PDF was read. Select lines — shift-click for a range,
            {' '}⌘/Ctrl-click or tick to add one — then set their type. Nothing changes in the open
            script until you press Import.
          </p>
          {parsed.warnings.map((w) => <p key={w} className="pdf-review-warning" role="status">{w}</p>)}

          <div className="pdf-review-toolbar">
            <label className="pdf-review-filter">
              <span>Show</span>
              <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show lines">
                <option value="all">All lines</option>
                <option value="changed">Changed lines</option>
                {presentTypes.map((t) => <option key={t} value={t}>{REVIEW_TYPE_LABELS[t] ?? t}</option>)}
              </Select>
            </label>
            <div className="pdf-review-select-btns" role="group" aria-label="Select">
              <button type="button" className="dialog-btn" onClick={selectAllShown} disabled={total === 0}>All</button>
              <button type="button" className="dialog-btn" onClick={selectNone} disabled={selectedCount === 0}>None</button>
              <button
                type="button"
                className="dialog-btn"
                onClick={() => setSel((s) => ({ selected: selectSameType(rows, types, selected), anchor: s.anchor }))}
                disabled={selectedCount === 0}
                title="Select every line of the type(s) already selected"
              >
                Same type
              </button>
              <button
                type="button"
                className="dialog-btn"
                onClick={() => setSel((s) => ({ selected: selectSameLook(rows, selected), anchor: s.anchor }))}
                disabled={selectedCount === 0}
                title="Select every line at the same indent, in the same case, as those already selected"
              >
                Same indent
              </button>
              <button
                type="button"
                className={`dialog-btn pdf-review-range${rangeNext ? ' active' : ''}`}
                onClick={() => setRangeNext((r) => !r)}
                disabled={sel.anchor === null}
                aria-pressed={rangeNext}
                title="Select everything from the last line you picked to the next line you tap"
              >
                Range…
              </button>
            </div>
          </div>

          <div
            ref={listRef}
            className="pdf-review-list"
            role="listbox"
            aria-multiselectable="true"
            aria-label="Imported lines"
            tabIndex={0}
            onKeyDown={onListKeyDown}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          >
            {total === 0 && <p className="pdf-review-empty">No lines to show.</p>}
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
                    role="option"
                    aria-selected={isSelected}
                    onClick={(e) => click(i, { range: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={row.locked}
                      aria-label={`Select line ${i + 1}`}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => click(i, { toggle: true, range: (e.nativeEvent as MouseEvent).shiftKey })}
                    />
                    <span className="pdf-review-scene" title="Scene">{scenes[i] > 0 ? scenes[i] : ''}</span>
                    <span className={`pdf-review-type pdf-review-type-${type}`} title={isChanged ? `Read as ${REVIEW_TYPE_LABELS[row.originalType] ?? row.originalType}` : undefined}>
                      {REVIEW_TYPE_LABELS[type] ?? type}
                    </span>
                    <span className={`pdf-review-text pdf-review-text-${type}`}>{row.text || ' '}</span>
                    <span className="pdf-review-meta">
                      {row.page !== null ? `p.${row.page}` : ''}
                      {row.indent !== null ? ` · ${row.indent.toFixed(1)}″` : ''}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pdf-review-apply">
            <span className="pdf-review-count">{selectedCount} selected</span>
            <label className="pdf-review-settype">
              <span>Set type</span>
              <Select
                value=""
                onChange={(e) => { if (e.target.value) setSelectedType(e.target.value); }}
                disabled={selectedCount === 0}
                aria-label="Set the selected lines' type"
              >
                <option value="">Choose…</option>
                {REVIEW_TYPES.map((t, n) => <option key={t} value={t}>{REVIEW_TYPE_LABELS[t]} ({n + 1})</option>)}
              </Select>
            </label>
            <button type="button" className="dialog-btn" onClick={undo} disabled={!canUndo}>Undo</button>
            <button
              type="button"
              className="dialog-btn"
              onClick={() => commitTypes(rows.map((r) => r.originalType))}
              disabled={changed === 0}
            >
              Revert all
            </button>
          </div>
        </div>
        <div className="dialog-actions">
          <span className="pdf-review-summary">
            {bodyCount} lines{changed > 0 ? ` · ${changed} changed` : ''}
          </span>
          <button onClick={onCancel}>Cancel</button>
          <button className="dialog-primary" onClick={doImport}>Import</button>
        </div>
      </div>
    </div>
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
