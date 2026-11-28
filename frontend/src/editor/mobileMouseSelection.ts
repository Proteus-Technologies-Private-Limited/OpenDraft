import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';

interface WordRange {
  from: number;
  to: number;
}

interface MouseDrag {
  pointerId: number;
  /** The document `anchor` and `word` are positions in. */
  doc: ProseMirrorNode;
  anchor: number;
  /** Set when the press was a double click: the drag then extends by word. */
  word: WordRange | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  fallback: boolean;
}

const DRAG_THRESHOLD = 4;

const wordSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
const WORD_CHAR = /[\p{L}\p{M}\p{N}_'’]/u;

/**
 * The word (or run of spaces or punctuation) at `pos`, the unit a double click
 * selects and a double-click drag extends by. Intl.Segmenter knows where words
 * end in scripts without spaces between them; older web views fall back to
 * runs of letters and digits.
 */
export function wordRangeAt(doc: ProseMirrorNode, pos: number): WordRange {
  const $pos = doc.resolve(pos);
  const block = $pos.parent;
  if (!block.inlineContent) return { from: pos, to: pos };
  const start = $pos.start();
  // One character per inline leaf, so string offsets are parent offsets.
  const text = block.textBetween(0, block.content.size, undefined, '￼');
  if (!text) return { from: pos, to: pos };
  // At the end of a block the word is the one just before the caret.
  const offset = Math.min($pos.parentOffset, text.length - 1);

  if (wordSegmenter) {
    for (const { segment, index } of wordSegmenter.segment(text)) {
      if (offset < index + segment.length) return { from: start + index, to: start + index + segment.length };
    }
    return { from: pos, to: pos };
  }

  const isWord = WORD_CHAR.test(text[offset]);
  const same = (i: number) => WORD_CHAR.test(text[i]) === isWord && (isWord || text[i] === text[offset]);
  let from = offset;
  let to = offset + 1;
  while (from > 0 && same(from - 1)) from--;
  while (to < text.length && same(to)) to++;
  return { from: start + from, to: start + to };
}

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

  /**
   * Carry the drag across edits made while it is in progress — a collaborator
   * typing, a plugin updating the document. Cancelling on any change froze the
   * selection whenever someone else was in the script. Only an anchor that was
   * itself deleted ends the drag; there is nothing left to extend from.
   */
  const follow = (trs: readonly Transaction[], oldState: EditorState, newState: EditorState) => {
    if (!drag || oldState.doc !== drag.doc || newState.doc === drag.doc) return;
    const mapping = new Mapping();
    for (const tr of trs) mapping.appendMapping(tr.mapping);
    const anchor = mapping.mapResult(drag.anchor);
    if (anchor.deletedAcross || !newState.doc.resolve(anchor.pos).parent.inlineContent) {
      cancel();
      return;
    }
    drag.anchor = anchor.pos;
    if (drag.word) {
      const from = mapping.map(drag.word.from, 1);
      const to = Math.max(from, mapping.map(drag.word.to, -1));
      drag.word = { from, to };
    }
    drag.doc = newState.doc;
  };

  // A plugin is the one place every transaction, local or remote, passes
  // through with its mapping. If it cannot be added, a drag still works; it is
  // cancelled by an edit, as it always was.
  const tracker = new Plugin({
    key: new PluginKey('mobileMouseSelection'),
    appendTransaction: (trs, oldState, newState) => {
      try {
        follow(trs, oldState, newState);
      } catch (err) {
        console.warn('[mobileMouseSelection] could not follow an edit during a drag; ending the drag:', err);
        cancel();
      }
      return null;
    },
  });
  let trackerInstalled = false;
  try {
    view.updateState(view.state.reconfigure({ plugins: [...view.state.plugins, tracker] }));
    trackerInstalled = true;
  } catch (err) {
    console.warn('[mobileMouseSelection] could not watch for edits; a drag will end when the document changes:', err);
  }

  const start = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    cancel();
    if (!view.editable || view.composing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
    if (!(event.target instanceof Element) || event.target.closest('[contenteditable="false"], [draggable="true"], a, button, input')) return;

    const { doc, selection } = view.state;
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!hit || !doc.resolve(hit.pos).parent.inlineContent) return;
    const word = event.detail === 2 ? wordRangeAt(doc, hit.pos) : null;
    // Pressing inside a range can start a native drag of the selected text. A
    // double click lands on the caret its first click left, so it is exempt.
    if (!word && !selection.empty && hit.pos >= selection.from && hit.pos <= selection.to) return;

    drag = {
      pointerId: event.pointerId, doc, anchor: hit.pos, word,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, fallback: false,
    };
  };

  /**
   * The click count arrives on mousedown: most engines report 0 as a
   * pointerdown's `detail`. A double click selects a word, and dragging from
   * it extends by whole words — character-by-character from the press point
   * would drop the start of the word the writer double-clicked.
   */
  const countClicks = (event: MouseEvent) => {
    if (!drag || drag.fallback || event.button !== 0) return;
    drag.word = event.detail === 2 ? wordRangeAt(drag.doc, drag.anchor) : null;
  };

  /** Whether the browser is extending the selection itself, so we stay out. */
  const nativeDragBegun = (browserSelection: Selection | null, current: MouseDrag): boolean => {
    if (!browserSelection?.anchorNode || !browserSelection.focusNode || browserSelection.isCollapsed) return false;
    if (!dom.contains(browserSelection.anchorNode) || !dom.contains(browserSelection.focusNode)) return false;
    const anchor = view.posAtDOM(browserSelection.anchorNode, browserSelection.anchorOffset);
    if (!current.word) return anchor === current.anchor;
    // A double click's drag is anchored at the word's start (or its end when
    // dragging backwards). The word alone is just the double click itself — a
    // web view that never extends leaves it exactly that.
    const { from, to } = current.word;
    if (anchor !== from && anchor !== to) return false;
    const focus = view.posAtDOM(browserSelection.focusNode, browserSelection.focusOffset);
    return Math.min(anchor, focus) !== from || Math.max(anchor, focus) !== to;
  };

  const extend = (): boolean => {
    // Without the tracker there is no mapping to carry the anchor across an edit.
    if (!drag || !view.editable || view.state.doc !== drag.doc) {
      if (drag && view.state.doc !== drag.doc && trackerInstalled) {
        console.warn('[mobileMouseSelection] the document changed by a route the drag could not follow; ending the drag');
      }
      cancel();
      return false;
    }
    const { anchor, doc, fallback, word, x, y } = drag;
    const browserSelection = document.getSelection();
    if (!fallback && nativeDragBegun(browserSelection, drag)) {
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
    if (!hit) return scrolled;
    // Still on the press point (or the double-clicked word): nothing to extend.
    if (!fallback && (word ? hit.pos >= word.from && hit.pos <= word.to : hit.pos === anchor)) return scrolled;

    if (!fallback) {
      drag.fallback = true;
      page?.setAttribute('data-mouse-selecting', '');
    }
    let from = anchor;
    let to = hit.pos;
    if (word) {
      // Whole words, as a native double-click drag selects them: anchored at
      // the word's far side from the pointer, out to the end of the word under it.
      const under = wordRangeAt(doc, hit.pos);
      if (hit.pos < word.from) { from = word.to; to = under.from; }
      else { from = word.from; to = Math.max(word.to, under.to); }
    }
    const selection = TextSelection.between(doc.resolve(from), doc.resolve(to));
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
  dom.addEventListener('mousedown', countClicks);
  window.addEventListener('pointermove', move);
  window.addEventListener('mousemove', preventNativeDragSelection, true);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancel);
  return () => {
    cancel();
    dom.removeEventListener('pointerdown', start);
    dom.removeEventListener('mousedown', countClicks);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('mousemove', preventNativeDragSelection, true);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancel);
    if (trackerInstalled && !view.isDestroyed) {
      try {
        view.updateState(view.state.reconfigure({ plugins: view.state.plugins.filter(p => p !== tracker) }));
      } catch (err) {
        console.warn('[mobileMouseSelection] could not remove the edit watcher:', err);
      }
    }
  };
}
