/**
 * Check the PDF Import — shown after a PDF is read and before it opens.
 *
 * Every element the import found is listed with its type. The writer can set
 * one element's type from its pulldown, or tick several (Shift-click ticks a
 * run) and change them all at once; "Show" narrows the list to one type, so
 * "every Action that should be Dialogue" is a filter, a tick and a click.
 * Import opens the corrected script; Cancel leaves the open script as it was.
 *
 * Mounted once in App. Import paths ask for it through
 * stores/pdfImportReviewStore and wait for the answer.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ELEMENT_LABELS } from '../stores/editorStore';
import { usePdfImportReviewStore, type PendingPdfReview } from '../stores/pdfImportReviewStore';
import {
  REVIEW_TYPES, retypeImport, reviewRows, typeCounts, type ReviewType,
} from '../utils/pdfImportReview';

const labelOf = (type: string) =>
  type === 'dualDialogue' ? 'Dual Dialogue' : (ELEMENT_LABELS[type] ?? type).replace(/ \(.*\)$/, '');

const ReviewBody: React.FC<{ pending: PendingPdfReview; onDone: (doc: PendingPdfReview['doc'] | null) => void }> = ({ pending, onDone }) => {
  const rows = useMemo(() => reviewRows(pending.doc), [pending.doc]);
  const [changes, setChanges] = useState<Map<number, ReviewType>>(new Map());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<string>('all');
  const [bulkType, setBulkType] = useState<ReviewType>('dialogue');
  const lastClicked = useRef<number | null>(null);

  const typeOf = (index: number, original: string) => changes.get(index) ?? original;
  const current = useMemo(
    () => rows.map((r) => ({ ...r, type: typeOf(r.index, r.type) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, changes],
  );
  const counts = useMemo(() => typeCounts(current), [current]);
  const shown = useMemo(() => (filter === 'all' ? current : current.filter((r) => r.type === filter)), [current, filter]);

  // Escape cancels, as on every dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const setType = (indices: Iterable<number>, type: ReviewType) => {
    setChanges((prev) => {
      const next = new Map(prev);
      for (const i of indices) {
        const row = rows.find((r) => r.index === i);
        if (!row?.editable) continue;
        if (row.type === type) next.delete(i);
        else next.set(i, type);
      }
      return next;
    });
  };

  /** Tick or untick a row; with Shift, every shown row between it and the last one clicked. */
  const toggle = (index: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const on = !prev.has(index);
      if (shift && lastClicked.current !== null) {
        const a = shown.findIndex((r) => r.index === lastClicked.current);
        const b = shown.findIndex((r) => r.index === index);
        if (a >= 0 && b >= 0) {
          for (const r of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) {
            if (!r.editable) continue;
            if (on) next.add(r.index); else next.delete(r.index);
          }
          return next;
        }
      }
      if (on) next.add(index); else next.delete(index);
      return next;
    });
    lastClicked.current = index;
  };

  const editableShown = shown.filter((r) => r.editable);
  const allShownSelected = editableShown.length > 0 && editableShown.every((r) => selected.has(r.index));

  const applyBulk = () => {
    setType(selected, bulkType);
    setSelected(new Set());
  };

  const finish = () => onDone(retypeImport(pending.doc, changes));

  return (
    <div
      className="dialog-box pdf-review-dialog"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pdf-review-title"
    >
      <div className="dialog-header" id="pdf-review-title">Check the PDF Import</div>
      <div className="dialog-body pdf-review-body">
        <p className="pdf-review-help">
          {rows.length} elements read from <strong>{pending.filename}</strong>. A PDF has no elements of its own,
          so each line was read by where it sits on the page. Change any that came in as the wrong kind &mdash;
          tick several to change them together.
        </p>
        {pending.warnings.map((w) => <p key={w} className="pdf-review-warning" role="status">{w}</p>)}

        <div className="pdf-review-toolbar">
          <label className="pdf-review-field">
            <span>Show</span>
            <select value={filter} onChange={(e) => { setFilter(e.target.value); setSelected(new Set()); }}>
              <option value="all">Everything ({rows.length})</option>
              {[...counts.entries()].map(([type, n]) => (
                <option key={type} value={type}>{labelOf(type)} ({n})</option>
              ))}
            </select>
          </label>
          <label className="pdf-review-check">
            <input
              type="checkbox"
              checked={allShownSelected}
              onChange={() => setSelected(allShownSelected ? new Set() : new Set(editableShown.map((r) => r.index)))}
            />
            <span>Tick all shown</span>
          </label>
          <span className="pdf-review-bulk">
            <span>Change {selected.size} ticked to</span>
            <select value={bulkType} onChange={(e) => setBulkType(e.target.value as ReviewType)} aria-label="New element type">
              {REVIEW_TYPES.map((t) => <option key={t} value={t}>{labelOf(t)}</option>)}
            </select>
            <button type="button" className="dialog-btn" onClick={applyBulk} disabled={selected.size === 0}>Change</button>
          </span>
        </div>

        <div className="pdf-review-list" role="list">
          {shown.length === 0 && <p className="pdf-review-help">Nothing of this kind.</p>}
          {shown.map((r) => (
            <div
              key={r.index}
              role="listitem"
              className={`pdf-review-row${changes.has(r.index) ? ' is-changed' : ''}${selected.has(r.index) ? ' is-ticked' : ''}`}
            >
              <input
                type="checkbox"
                checked={selected.has(r.index)}
                disabled={!r.editable}
                // A checkbox's change event is its click, so it knows about Shift.
                onChange={(e) => toggle(r.index, (e.nativeEvent as MouseEvent).shiftKey === true)}
                aria-label={`Tick ${r.text || labelOf(r.type)}`}
              />
              {r.editable ? (
                <select
                  className="pdf-review-type"
                  value={r.type}
                  onChange={(e) => setType([r.index], e.target.value as ReviewType)}
                  aria-label="Element type"
                >
                  {REVIEW_TYPES.map((t) => <option key={t} value={t}>{labelOf(t)}</option>)}
                </select>
              ) : (
                <span className="pdf-review-type pdf-review-type--fixed">{labelOf(r.type)}</span>
              )}
              <span className={`pdf-review-text pdf-review-text--${r.type}`}>{r.text || ' '}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="dialog-actions">
        <span className="pdf-review-count">
          {changes.size > 0 ? `${changes.size} changed` : 'Nothing changed'}
          {changes.size > 0 && (
            <button type="button" className="pdf-review-reset" onClick={() => setChanges(new Map())}>Undo all</button>
          )}
        </span>
        <button onClick={() => onDone(null)}>Cancel</button>
        <button className="dialog-primary" onClick={finish}>Import</button>
      </div>
    </div>
  );
};

const PdfImportReviewDialog: React.FC = () => {
  const pending = usePdfImportReviewStore((s) => s.pending);
  const finish = usePdfImportReviewStore((s) => s.finish);
  const setReviewerMounted = usePdfImportReviewStore((s) => s.setReviewerMounted);

  useEffect(() => {
    setReviewerMounted(true);
    return () => {
      setReviewerMounted(false);
      // Nothing left to answer a request still open: let it go through as read.
      const open = usePdfImportReviewStore.getState().pending;
      if (open) usePdfImportReviewStore.getState().finish(open.doc);
    };
  }, [setReviewerMounted]);

  if (!pending) return null;
  return (
    // No close on a click outside: that would throw away the changes made so
    // far. Cancel and Escape are the ways out.
    <div className="dialog-overlay">
      {/* Keyed by the request, so a second import starts from a clean list. */}
      <ReviewBody key={pending.id} pending={pending} onDone={finish} />
    </div>
  );
};

export default PdfImportReviewDialog;
