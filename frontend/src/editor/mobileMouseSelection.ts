import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

interface MouseDrag {
  pointerId: number;
  doc: ProseMirrorNode;
  anchor: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  fallback: boolean;
}

const DRAG_THRESHOLD = 4;

/** Some mobile browsers and web views move the mouse without extending the
 * editable selection. Supply the range only when the native drag hasn't begun. */
export function installMobileMouseSelection(view: EditorView): () => void {
  const { dom } = view;
  const document = dom.ownerDocument;
  const window = document.defaultView!;
  const page = dom.closest('.page');
  const scroller = dom.closest<HTMLElement>('.editor-main');
  let drag: MouseDrag | null = null;
  let frame = 0;

  const cancel = () => {
    if (drag?.fallback) page?.removeAttribute('data-mouse-selecting');
    drag = null;
    window.cancelAnimationFrame(frame);
    frame = 0;
  };

  const start = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    cancel();
    if (!view.editable || view.composing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    if (!(event.target instanceof Element) || event.target.closest('[contenteditable="false"], [draggable="true"], a, button, input')) return;

    const { doc, selection } = view.state;
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!hit || !doc.resolve(hit.pos).parent.inlineContent) return;
    // Pressing inside a range can start a native drag of the selected text.
    if (!selection.empty && hit.pos >= selection.from && hit.pos <= selection.to) return;

    drag = {
      pointerId: event.pointerId, doc, anchor: hit.pos,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, fallback: false,
    };
  };

  const extend = (): boolean => {
    if (!drag || !view.editable || view.state.doc !== drag.doc) {
      cancel();
      return false;
    }
    const { anchor, doc, fallback, x, y } = drag;
    const browserSelection = document.getSelection();
    if (!fallback && browserSelection?.anchorNode && browserSelection.focusNode && !browserSelection.isCollapsed
      && dom.contains(browserSelection.anchorNode) && dom.contains(browserSelection.focusNode)
      && view.posAtDOM(browserSelection.anchorNode, browserSelection.anchorOffset) === anchor) {
      cancel();
      return false;
    }

    const viewport = (scroller ?? dom).getBoundingClientRect();
    let scrolled = false;
    if (scroller) {
      const delta = y < viewport.top ? y - viewport.top : Math.max(0, y - viewport.bottom);
      const previousTop = scroller.scrollTop;
      scroller.scrollTop += Math.max(-24, Math.min(24, delta));
      scrolled = scroller.scrollTop !== previousTop;
    }

    const editorBounds = dom.getBoundingClientRect();
    const left = Math.max(0, editorBounds.left, viewport.left);
    const top = Math.max(0, editorBounds.top, viewport.top);
    const right = Math.min(window.innerWidth, editorBounds.right, viewport.right);
    const bottom = Math.min(window.innerHeight, editorBounds.bottom, viewport.bottom);
    if (right - left < 2 || bottom - top < 2) return scrolled;
    const hit = view.posAtCoords({
      left: Math.max(left + 1, Math.min(right - 1, x)),
      top: Math.max(top + 1, Math.min(bottom - 1, y)),
    });
    if (!hit || (!fallback && hit.pos === anchor)) return scrolled;

    if (!fallback) {
      drag.fallback = true;
      page?.setAttribute('data-mouse-selecting', '');
    }
    const selection = TextSelection.between(doc.resolve(anchor), doc.resolve(hit.pos));
    if (!view.hasFocus()) view.focus();
    if (!selection.eq(view.state.selection)) {
      view.dispatch(view.state.tr.setSelection(selection).setMeta('pointer', true));
      // ProseMirror can defer writing the DOM range while the mouse is down.
      // Keep the on-screen highlight current throughout the drag.
      const start = view.domAtPos(selection.anchor);
      const end = view.domAtPos(selection.head);
      browserSelection?.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
    }

    return scrolled;
  };

  const update = () => {
    frame = 0;
    if (extend()) frame = window.requestAnimationFrame(update);
  };

  const move = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (!(event.buttons & 1)) {
      cancel();
      return;
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
    const distance = Math.max(Math.abs(drag.x - drag.startX), Math.abs(drag.y - drag.startY));
    if (!frame && (drag.fallback || distance > DRAG_THRESHOLD)) frame = window.requestAnimationFrame(update);
  };

  const finish = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (frame || drag.fallback) {
      drag.x = event.clientX;
      drag.y = event.clientY;
      extend();
    }
    cancel();
  };

  const preventNativeDragSelection = (event: MouseEvent) => {
    if (drag?.fallback) event.preventDefault();
  };

  dom.addEventListener('pointerdown', start);
  window.addEventListener('pointermove', move);
  window.addEventListener('mousemove', preventNativeDragSelection, true);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  return () => {
    cancel();
    dom.removeEventListener('pointerdown', start);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('mousemove', preventNativeDragSelection, true);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
  };
}
