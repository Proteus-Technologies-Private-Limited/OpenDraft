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
import { toPagePoint, toPageRect, type PagePoint, type PageRect } from '../utils/pageCoords';

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

/** Two readings of the same end, to the pixel. */
const samePoint = (a: PagePoint, b: PagePoint) =>
  a.left === b.left && a.top === b.top && a.height === b.height;

const SelectionHandles: React.FC<SelectionHandlesProps> = ({ editor, enabled }) => {
  const [ends, setEnds] = useState<{ start: PagePoint; end: PagePoint } | null>(null);
  /**
   * The selection highlight, when the app has to draw it.
   *
   * iPadOS paints no highlight in a view without focus, so the moment the
   * writer reaches for a menu the range they are about to act on disappears —
   * leaving two handles marking the ends of nothing. The selection is still
   * there and the command still applies to it, so what is missing is only the
   * drawing of it. One band per line, from the range's own client rectangles.
   */
  const [bands, setBands] = useState<PageRect[] | null>(null);
  const dragRef = useRef<Drag | null>(null);
  /** Mirrors dragRef into the render, purely to put the class on the handles. */
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<number | null>(null);
  const settleRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    /**
     * Keep the object already in state when the reading has not changed.
     * Every transaction re-measures and a drag dispatches one per pointer
     * move, so handing React a fresh object each time re-rendered both
     * handles on every event whether or not either had actually moved.
     */
    const apply = (next: { start: PagePoint; end: PagePoint } | null) =>
      setEnds((prev) => {
        if (next === null || prev === null) return prev === next ? prev : next;
        return samePoint(prev.start, next.start) && samePoint(prev.end, next.end)
          ? prev
          : next;
      });

    if (!editor || !enabled) { apply(null); setBands(null); return; }
    try {
      const { state, view } = editor;
      // Read-only drafts have no selection to adjust.
      if (!view.editable) { apply(null); return; }

      const sel = state.selection;
      if (!(sel instanceof TextSelection) || sel.empty) { apply(null); return; }

      // Focus is deliberately not consulted, and neither is whether the
      // browser is still painting the highlight.
      //
      // iPadOS stops drawing the highlight the moment the editor gives up
      // focus — tapping a menu, the keyboard arriving or leaving — but the
      // selection itself is untouched: it is still ProseMirror's selection,
      // Cut still cuts it and a style still applies to it. Hiding the handles
      // along with the highlight therefore took away the last thing on screen
      // saying what those commands were about to act on, which is worse than
      // the stale marker it was meant to fix. They are the stand-in for a
      // selection UI the system is not drawing, exactly as PencilCaret is the
      // stand-in for a caret it is not drawing, so they stay up for as long as
      // there is a selection for them to mark.
      const dom = view.dom as HTMLElement;

      const page = dom.closest('.page') as HTMLElement | null;
      if (!page) { apply(null); return; }

      // Biased outwards, so each end is measured on the side the selection is
      // on: at a line wrap the same position sits at both the end of one line
      // and the start of the next, and an unbiased reading puts the handle on
      // the wrong one.
      const start = toPagePoint(page, view.coordsAtPos(sel.from, 1));
      const end = toPagePoint(page, view.coordsAtPos(sel.to, -1));
      if (!start || !end) { apply(null); return; }
      apply({ start, end });

      const head = view.domAtPos(sel.from);
      const tail = view.domAtPos(sel.to);
      const range = document.createRange();
      range.setStart(head.node, head.offset);
      range.setEnd(tail.node, tail.offset);
      const drawn: PageRect[] = [];
      for (const box of Array.from(range.getClientRects())) {
        if (box.width <= 0 || box.height <= 0) continue;
        const band = toPageRect(page, box);
        if (band) drawn.push(band);
      }
      setBands((prev) => {
        if (!drawn.length) return prev === null ? prev : null;
        if (prev && prev.length === drawn.length
          && prev.every((b, i) => b.left === drawn[i].left && b.top === drawn[i].top
            && b.width === drawn[i].width && b.height === drawn[i].height)) return prev;
        return drawn;
      });
    } catch {
      // coordsAtPos throws while the view is mid-update; the next tick re-reads.
      apply(null);
      setBands(null);
    }
  }, [editor, enabled]);

  /**
   * At most one reading per animation frame.
   *
   * A drag dispatches a new selection on every pointer move, and each dispatch
   * fires both `transaction` and `selectionUpdate` — so measuring straight off
   * the event took two full readings per move, four `coordsAtPos` calls and
   * the page rectangle twice, each one forcing layout in the middle of the
   * gesture it was meant to be keeping up with. A frame is as often as the
   * handles can be repainted anyway; everything above that rate was work
   * thrown away, and enough of it to be felt as the handle stuttering behind
   * the finger rather than following it character by character (issue #108).
   */
  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  /**
   * A reading taken after the current task has run to the end, for the first
   * one: ProseMirror writes its DOM after the effect runs, so measuring inside
   * it measures the layout the view is about to replace.
   */
  const scheduleSettled = useCallback(() => {
    if (settleRef.current !== null) window.clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      settleRef.current = null;
      measure();
    }, 0);
  }, [measure]);

  /**
   * Suppress the system's own highlight for exactly as long as this component
   * is drawing one, so the two can never both be on screen — the same bargain
   * PencilCaret strikes with the system caret.
   *
   * Drawing ours only when the view lost focus was the obvious way to avoid
   * the overlap, and it was wrong: the web view can hold focus and still stop
   * painting a highlight, which is what the software keyboard arriving or
   * leaving does. There is no signal from the outside for "is it painting one
   * right now", so the question is removed instead — it never paints one here,
   * and these bands are the highlight. Scoped to the script, so a selection in
   * a search field or a dialog keeps the system's.
   */
  useEffect(() => {
    if (!enabled) return;
    document.body.classList.add('selection-bands-active');
    return () => document.body.classList.remove('selection-bands-active');
  }, [enabled]);

  useEffect(() => {
    if (!editor || !enabled) return;

    editor.on('selectionUpdate', schedule);
    editor.on('transaction', schedule);
    editor.on('focus', schedule);
    editor.on('blur', scheduleSettled);

    // A drag that ends anywhere but on the handle — the pointer released over
    // another element, or the handles unmounted under it — otherwise leaves
    // the drag flag set for good, and every check that defers to a drag in
    // progress stops doing its job.
    const onGlobalRelease = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(false);
      schedule();
    };
    window.addEventListener('pointerup', onGlobalRelease);
    window.addEventListener('pointercancel', onGlobalRelease);

    const main = editor.view.dom.closest('.editor-main');
    main?.addEventListener('scroll', schedule, { passive: true });
    const onViewportResize = () => { schedule(); scheduleSettled(); };
    window.addEventListener('resize', onViewportResize);
    window.visualViewport?.addEventListener('resize', onViewportResize);
    window.visualViewport?.addEventListener('scroll', schedule);

    // A first reading for a selection that already existed when this mounted.
    scheduleSettled();
    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (settleRef.current !== null) window.clearTimeout(settleRef.current);
      frameRef.current = null;
      settleRef.current = null;
      editor.off('selectionUpdate', schedule);
      editor.off('transaction', schedule);
      editor.off('focus', schedule);
      editor.off('blur', scheduleSettled);
      window.removeEventListener('pointerup', onGlobalRelease);
      window.removeEventListener('pointercancel', onGlobalRelease);
      main?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', onViewportResize);
      window.visualViewport?.removeEventListener('resize', onViewportResize);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [editor, enabled, schedule, scheduleSettled]);

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
    setDragging(true);
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
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    measure();
  };

  if (!ends) return null;

  const handle = (which: HandleEnd, point: PagePoint) => (
    <div
      key={which}
      className={`selection-handle selection-handle-${which}${dragging ? ' is-dragging' : ''}`}
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
      {bands?.map((b, i) => (
        <div
          key={`band-${i}`}
          className="selection-band"
          aria-hidden="true"
          style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
        />
      ))}
      {handle('start', ends.start)}
      {handle('end', ends.end)}
    </>
  );
};

export default SelectionHandles;
