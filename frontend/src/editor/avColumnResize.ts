/**
 * The drag session behind an AV column divider.
 *
 * Module-level, deliberately, and it holds the whole gesture: the listeners,
 * the guide line, the body class and the commit. Two hard-won reasons.
 *
 * **It must outlive the node view that started it.** Drag state used to be a
 * `useRef` inside `AvRowView`. ProseMirror re-creates a block's descs — and
 * with them every row's React node view — for all sorts of reasons, and a
 * remount mid-drag left the release handler looking at a fresh, empty ref. It
 * returned early, the teardown never ran, and `av-col-resizing` stayed on
 * `<body>` for the rest of the session: `cursor: col-resize` and
 * `user-select: none` over the whole app, which looks exactly like the editor
 * having died. Only one divider can be dragged at a time, so one module-level
 * session is the honest shape for this.
 *
 * **Nothing inside the editor may be touched while dragging.** The first
 * version previewed by writing `--av-grid` onto the `.av-block` element.
 * ProseMirror's DOMObserver watches attributes across `view.dom`, and
 * `registerMutation` passes a `style` change through unless there was no old
 * value — the block always has one, from `renderHTML` — while `avBlock`, having
 * no custom node view, falls back to a `ignoreMutation` that returns false
 * whenever a `contentDOM` exists. So every frame of the drag was read as a user
 * DOM edit: the style was reverted (so the columns never appeared to move) and
 * the block was re-rendered (which is what remounted the node views). A guide
 * line in `document.body`, outside `view.dom` entirely, cannot be mistaken for
 * an edit — and it is what Word, Google Docs and prosemirror-tables all draw
 * for the same gesture.
 */
import type { Editor } from '@tiptap/react';
import { readColumnConfig, visibleColumns, type AvColumnConfig } from './extensions/AvBlock';
import { frPerPixel, measureRow, widthsAfterDrag, type AvBoundary } from './avColumnDrag';

/** Marks the document while a drag is live; see avScript.css. */
const DRAGGING_CLASS = 'av-col-resizing';
/** Marks the one handle being dragged, so the others stay quiet. */
const ACTIVE_HANDLE_CLASS = 'av-col-handle--active';

interface Session {
  pointerId: number;
  startX: number;
  /** Viewport x of the divider when the drag began. */
  originX: number;
  boundary: AvBoundary;
  blockPos: number;
  cfg: AvColumnConfig;
  rate: number;
  editor: Editor;
  handleEl: HTMLElement;
  guide: HTMLElement;
  pending: Partial<AvColumnConfig['widths']> | null;
  detach: () => void;
}

let session: Session | null = null;

/** The vertical line that follows the pointer, parented outside the editor. */
function createGuide(blockEl: Element | null): HTMLElement {
  const guide = document.createElement('div');
  guide.className = 'av-col-guide';
  const rect = blockEl?.getBoundingClientRect();
  guide.style.top = `${rect ? rect.top : 0}px`;
  guide.style.height = `${rect ? rect.height : 0}px`;
  document.body.appendChild(guide);
  return guide;
}

function teardown(commit: boolean): void {
  const active = session;
  session = null;
  if (!active) return;
  active.detach();
  active.guide.remove();
  active.handleEl.classList.remove(ACTIVE_HANDLE_CLASS);
  document.body.classList.remove(DRAGGING_CLASS);
  if (commit && active.pending) {
    try {
      active.editor.commands.setAvColumnWidths(active.pending, active.blockPos);
    } catch (err) {
      // A body that moved or vanished under the drag. The widths simply do not
      // change; nothing here is worth breaking the editor over.
      console.warn('[av] could not apply the new column widths', err);
    }
  }
}

/** Abandon any drag in flight, leaving the widths as they were. */
export function cancelColumnDrag(): void {
  teardown(false);
}

/** True while a divider is being dragged. */
export function isColumnDragActive(): boolean {
  return session !== null;
}

export interface BeginColumnDragOptions {
  event: PointerEvent;
  handleEl: HTMLElement;
  boundary: AvBoundary;
  /** Document position of the avBlock being resized. */
  blockPos: number;
  editor: Editor;
}

/**
 * Start dragging a divider. Returns false when there is nothing to drag —
 * an unmeasurable row, a body that is not there any more — in which case the
 * caller should let the event alone rather than swallow it.
 */
export function beginColumnDrag({
  event, handleEl, boundary, blockPos, editor,
}: BeginColumnDragOptions): boolean {
  if (event.button !== 0) return false;
  // A second pointerdown while one is live: end the first cleanly rather than
  // stacking sessions and orphaning its listeners.
  if (session) teardown(true);

  // `blockPos` came from the node view's `getPos()`, which can be stale by the
  // time a pointer lands on the handle — and `nodeAt` THROWS on a position past
  // the end of the document rather than answering null, which would take the
  // whole pointerdown handler down with it.
  const cfg = (() => {
    try {
      if (blockPos < 0 || blockPos > editor.state.doc.content.size) return null;
      const block = editor.state.doc.nodeAt(blockPos);
      if (!block || block.type.name !== 'avBlock') return null;
      return readColumnConfig(block.attrs);
    } catch {
      return null;
    }
  })();
  if (!cfg) return false;

  const rowEl = handleEl.closest('.av-row');
  const metrics = measureRow(rowEl, visibleColumns(cfg).length);
  const rate = frPerPixel(cfg, metrics);
  if (rate === 0) return false;

  const handleRect = handleEl.getBoundingClientRect();
  const guide = createGuide(handleEl.closest('.av-block'));
  const originX = handleRect.left + handleRect.width / 2;
  guide.style.left = `${originX}px`;

  const onMove = (e: PointerEvent) => {
    if (!session || e.pointerId !== session.pointerId) return;
    e.preventDefault();
    const next = widthsAfterDrag(session.cfg, session.boundary, e.clientX - session.startX, metrics);
    session.pending = next;
    // The guide follows the COLUMNS, not the pointer: when a column reaches its
    // limit the line stops with it, so the writer can see they have run out of
    // room rather than watching the line drift away from the layout it claims
    // to be setting.
    const movedFr = next ? (next[session.boundary.left]! - session.cfg.widths[session.boundary.left]) : 0;
    session.guide.style.left = `${session.originX + movedFr / session.rate}px`;
  };
  const onUp = (e: PointerEvent) => {
    if (!session || e.pointerId !== session.pointerId) return;
    teardown(true);
  };
  const onCancel = (e: PointerEvent) => {
    if (!session || e.pointerId !== session.pointerId) return;
    teardown(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !session) return;
    e.preventDefault();
    e.stopPropagation();
    teardown(false);
  };
  // A window that loses focus mid-drag never sees the pointerup. Without this
  // the session — and the body class with it — would outlive the gesture, which
  // is the failure this module exists to make impossible.
  const onBlur = () => teardown(false);

  const detach = () => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('blur', onBlur);
  };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onCancel, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('blur', onBlur);
  document.body.classList.add(DRAGGING_CLASS);
  handleEl.classList.add(ACTIVE_HANDLE_CLASS);

  session = {
    pointerId: event.pointerId,
    startX: event.clientX,
    originX,
    boundary,
    blockPos,
    cfg,
    rate,
    editor,
    handleEl,
    guide,
    pending: null,
    detach,
  };
  return true;
}
