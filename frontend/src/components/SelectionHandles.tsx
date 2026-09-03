/**
 * Draggable selection handles, for the same reason PencilCaret exists.
 *
 * iPadOS does not put its own selection grabbers on a range selected inside
 * this web view. The range highlights, and that is all: to move either end of
 * it by a word the writer has to throw the selection away and make it again
 * (issue #108). Every other text field on the device shows a handle at each
 * end that can be dragged to widen or narrow the selection, and a screenplay
 * editor is exactly where that matters.
 *
 * So the app draws them. Deliberately narrow, the way the caret is:
 *
 *   - the iOS web view only, where the system provides none. Android's web
 *     view draws its own, and so does Safari; a second pair on top of those
 *     would be two handles per end, both live.
 *   - text ranges only. A node selection — a tapped image — is not a range
 *     with ends to drag.
 *
 * Like the caret, these are ordinary children of `.page` rather than a portal
 * into `.ProseMirror`: ProseMirror owns the DOM inside its own element and
 * replaces those children as the document changes, so React later fails to
 * find a node it put there and the view dies with `NotFoundError`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { toPagePoint, type PagePoint } from '../utils/pageCoords';

interface SelectionHandlesProps {
  editor: Editor | null;
  /** The iOS web view. Everywhere else the system draws its own. */
  enabled: boolean;
}

/** Which end of the range a handle belongs to, and which one is being dragged. */
type HandleEnd = 'start' | 'end';

interface Drag {
  /** The end left where it was; the drag moves the other one against it. */
  anchor: number;
  /**
   * Pointer-to-text offset, captured when the drag began. The knob sits clear
   * of the text so a finger does not cover it, so the position under the
   * finger is not the position being moved. Measured rather than hard-coded,
   * so wherever on the handle the writer grabbed it, the text end stays put
   * under that grip instead of jumping to meet the finger.
   */
  dx: number;
  dy: number;
}

const SelectionHandles: React.FC<SelectionHandlesProps> = ({ editor, enabled }) => {
  const [ends, setEnds] = useState<{ start: PagePoint; end: PagePoint } | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const measure = useCallback(() => {
    if (!editor || !enabled) { setEnds(null); return; }
    try {
      const { state, view } = editor;
      // Read-only drafts have no selection to adjust.
      if (!view.editable) { setEnds(null); return; }

      const sel = state.selection;
      if (!(sel instanceof TextSelection) || sel.empty) { setEnds(null); return; }

      // Same reading as PencilCaret's: `view.hasFocus()` reports false in
      // states where the editor plainly does hold focus. A drag keeps the
      // handles up regardless — the pointer is captured by one of them, and
      // wherever focus has gone it has not gone somewhere that ends the drag.
      const dom = view.dom as HTMLElement;
      const focused = document.activeElement === dom
        || dom.contains(document.activeElement)
        || dom.classList.contains('ProseMirror-focused');
      if (!focused && !dragRef.current) { setEnds(null); return; }

      const page = dom.closest('.page') as HTMLElement | null;
      if (!page) { setEnds(null); return; }

      // Biased outwards, so each end is measured on the side the selection is
      // on: at a line wrap the same position sits at both the end of one line
      // and the start of the next, and an unbiased reading puts the handle on
      // the wrong one.
      const start = toPagePoint(page, view.coordsAtPos(sel.from, 1));
      const end = toPagePoint(page, view.coordsAtPos(sel.to, -1));
      if (!start || !end) { setEnds(null); return; }
      setEnds({ start, end });
    } catch {
      // coordsAtPos throws while the view is mid-update; the next tick re-reads.
      setEnds(null);
    }
  }, [editor, enabled]);

  useEffect(() => {
    if (!editor || !enabled) return;

    editor.on('selectionUpdate', measure);
    editor.on('transaction', measure);
    editor.on('focus', measure);
    editor.on('blur', measure);

    const main = editor.view.dom.closest('.editor-main');
    main?.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);

    // Take a first reading for a selection that already existed when this
    // mounted — on the next tick rather than now, because ProseMirror writes
    // its DOM after the effect runs, so measuring here measures the layout the
    // view is about to replace.
    const settle = window.setTimeout(measure, 0);
    return () => {
      window.clearTimeout(settle);
      editor.off('selectionUpdate', measure);
      editor.off('transaction', measure);
      editor.off('focus', measure);
      editor.off('blur', measure);
      main?.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [editor, enabled, measure]);

  const handlePointerDown = (which: HandleEnd) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editor) return;
    const sel = editor.state.selection;
    if (sel.empty) return;

    // Nothing about a handle is a click on the document: preventDefault keeps
    // the tap from moving focus out of the editor and collapsing the very
    // selection being adjusted.
    e.preventDefault();
    e.stopPropagation();

    const moving = which === 'start' ? sel.from : sel.to;
    const coords = editor.view.coordsAtPos(moving, which === 'start' ? 1 : -1);
    dragRef.current = {
      anchor: which === 'start' ? sel.to : sel.from,
      dx: coords.left - e.clientX,
      dy: (coords.top + coords.bottom) / 2 - e.clientY,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !editor) return;
    e.preventDefault();

    const { state, view } = editor;
    const at = view.posAtCoords({ left: e.clientX + drag.dx, top: e.clientY + drag.dy });
    if (!at) return;

    try {
      // `between` is what ProseMirror uses for a mouse drag: it settles on the
      // nearest position that can actually hold a text selection, so a finger
      // over a page margin or a page break does not throw the range away. It
      // also lets the moving end cross the fixed one, which is what iPadOS
      // does — past the crossing, the handle under the finger is the other one.
      const next = TextSelection.between(state.doc.resolve(drag.anchor), state.doc.resolve(at.pos));
      // A collapsed range would unmount the handles mid-drag, taking the
      // pointer capture with them and stranding the gesture. The two ends stay
      // at least one position apart instead.
      if (next.empty || next.eq(state.selection)) return;
      view.dispatch(state.tr.setSelection(next));
    } catch {
      // The anchor can fall outside a document that changed under the drag —
      // a collaborator's edit. Nothing to move it to; the next move re-reads.
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    measure();
  };

  if (!ends) return null;

  const handle = (which: HandleEnd, point: PagePoint) => (
    <div
      key={which}
      className={`selection-handle selection-handle-${which}`}
      aria-hidden="true"
      style={{ left: point.left, top: point.top, height: point.height }}
      onPointerDown={handlePointerDown(which)}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );

  return (
    <>
      {handle('start', ends.start)}
      {handle('end', ends.end)}
    </>
  );
};

export default SelectionHandles;
