/**
 * A caret for writing with the Pencil.
 *
 * On iPadOS the system paints the caret in a web view only while the software
 * keyboard is up. Dismiss it — which is the whole point of writing with an
 * Apple Pencil — and the editor keeps focus, the selection stays exactly where
 * it was, and taps still land in the right place, but there is nothing on
 * screen to show the writer where. Confirmed on device: `ProseMirror-focused`
 * with one collapsed range and a visible caret colour, and no caret drawn.
 *
 * Nothing in CSS brings it back, so this draws one. It is deliberately narrow:
 *
 *   - touch devices only, so the desktop keeps the caret the platform gives it;
 *   - only for an empty selection, because a range shows itself by highlight.
 *
 * While it is active the native caret is turned off outright, via a class on
 * <body>. An earlier version tried to draw only when the keyboard was down and
 * leave the system to it otherwise, inferring keyboard state from the visual
 * viewport — but that is a guess about what another process is painting, and
 * when it guessed wrong both carets showed at once. One caret, drawn by us, is
 * the only arrangement with no third state to get wrong.
 *
 * It is an ordinary child of `.page`, positioned in that element's unscaled
 * coordinate space — the scale worked out by comparing painted width to layout
 * width, so it holds at any zoom and any window size without this having to
 * know how the page is scaled.
 *
 * Not a portal, and above all not a portal into `.ProseMirror`: ProseMirror
 * owns the DOM inside its own element and replaces those children as the
 * document changes, so React later fails to find a node it put there and the
 * whole view dies with `NotFoundError: The object can not be found here`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { toPagePoint, type PagePoint } from '../utils/pageCoords';

interface PencilCaretProps {
  editor: Editor | null;
  /** Touch device. Desktop carets work; leave them alone. */
  enabled: boolean;
}

const PencilCaret: React.FC<PencilCaretProps> = ({ editor, enabled }) => {
  const [box, setBox] = useState<PagePoint | null>(null);

  const measure = useCallback(() => {
    if (!editor || !enabled) { setBox(null); return; }
    try {
      const { state, view } = editor;
      // Asked of the DOM rather than `view.hasFocus()`, which reports false in
      // states where the editor plainly does hold focus — the element is the
      // active one and ProseMirror has put its own focused class on it.
      const dom = view.dom as HTMLElement;
      const focused = document.activeElement === dom
        || dom.contains(document.activeElement)
        || dom.classList.contains('ProseMirror-focused');
      if (!focused || !state.selection.empty) {
        setBox(null);
        return;
      }
      // Read-only drafts hide the caret on purpose.
      if (!view.editable) { setBox(null); return; }

      // Measured against the page, which is this element's offset parent, and
      // undone of whatever zoom is being applied to it — see pageCoords.ts.
      const page = dom.closest('.page') as HTMLElement | null;
      if (!page) { setBox(null); return; }
      setBox(toPagePoint(page, view.coordsAtPos(state.selection.head)));
    } catch {
      // coordsAtPos throws while the view is mid-update; the next tick re-reads.
      setBox(null);
    }
  }, [editor, enabled]);

  /** Coalesce the several events a single caret move fires into one measure. */
  /**
   * Measure straight away rather than coalescing into an animation frame. A
   * frame that is cancelled by the effect's own cleanup never fires, and one
   * getBoundingClientRect is far too cheap to be worth that risk.
   */
  const schedule = measure;

  // Suppress the system caret for exactly as long as this one is in charge, so
  // the two can never both be on screen.
  useEffect(() => {
    if (!enabled) return;
    document.body.classList.add('pencil-caret-active');
    return () => document.body.classList.remove('pencil-caret-active');
  }, [enabled]);

  useEffect(() => {
    if (!editor || !enabled) return;

    editor.on('selectionUpdate', schedule);
    editor.on('transaction', schedule);
    editor.on('focus', schedule);
    editor.on('blur', schedule);

    const main = editor.view.dom.closest('.editor-main');
    main?.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);

    schedule();
    // ProseMirror writes its DOM after these fire, so take a second reading
    // once that has settled.
    const settle = window.setTimeout(schedule, 0);
    return () => {
      window.clearTimeout(settle);
      editor.off('selectionUpdate', schedule);
      editor.off('transaction', schedule);
      editor.off('focus', schedule);
      editor.off('blur', schedule);
      main?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [editor, enabled, schedule]);

  if (!box) return null;

  return (
    <div
      className="pencil-caret"
      aria-hidden="true"
      style={{ left: box.left, top: box.top, height: box.height }}
    />
  );
};

export default PencilCaret;
