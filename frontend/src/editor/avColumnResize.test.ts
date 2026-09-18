/**
 * The AV column drag session.
 *
 * These cover one thing above all: the drag must never leave `av-col-resizing`
 * on the document. When it did, every element in the app inherited a resize
 * cursor and `user-select: none`, and the editor looked dead — which is how the
 * bug was reported, rather than as anything to do with resizing.
 *
 * The session is module state on purpose (a node view can be remounted
 * mid-drag), so it is also exercised here for leaking BETWEEN drags.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TextSelection, EditorState } from '@tiptap/pm/state';
import { testSchema } from '../test/screenplaySchema';
import { beginColumnDrag, cancelColumnDrag, isColumnDragActive } from './avColumnResize';
import { AV_BOUNDARIES } from './avColumnDrag';
import { AV_DEFAULT_COLUMNS } from './extensions/AvBlock';

const boundary = (id: string) => AV_BOUNDARIES.find((b) => b.id === id)!;

/** A one-row AV body, and the position of its block. */
function avDoc() {
  const doc = testSchema.nodeFromJSON({
    type: 'doc',
    content: [{
      type: 'avBlock',
      content: [{
        type: 'avRow',
        content: [
          { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara', content: [{ type: 'text', text: 'V' }] }] },
          { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara', content: [{ type: 'text', text: 'A' }] }] },
        ],
      }],
    }],
  });
  let blockPos = -1;
  doc.descendants((n, p) => { if (blockPos < 0 && n.type.name === 'avBlock') blockPos = p; return blockPos < 0; });
  const state = EditorState.create({ doc, schema: testSchema });
  return { doc, blockPos, state: state.apply(state.tr.setSelection(TextSelection.create(doc, 4))) };
}

// ── A DOM small enough to hold in one hand ────────────────────────────────
type Listener = (e: unknown) => void;

let listeners: Record<string, Listener[]>;
let bodyClasses: Set<string>;
let appended: { removed: boolean; style: Record<string, string> }[];

function fire(type: string, event: Record<string, unknown>) {
  for (const fn of [...(listeners[type] || [])]) fn(event);
}

function stubDom() {
  listeners = {};
  bodyClasses = new Set();
  appended = [];
  const body = {
    classList: {
      add: (c: string) => bodyClasses.add(c),
      remove: (c: string) => bodyClasses.delete(c),
    },
    appendChild: (el: { removed: boolean; style: Record<string, string> }) => { appended.push(el); },
  };
  (globalThis as Record<string, unknown>).document = {
    body,
    createElement: () => {
      const el = { className: '', removed: false, style: {} as Record<string, string>, remove() { this.removed = true; } };
      return el;
    },
  };
  // `window` is read-only on globalThis under some runtimes, so define rather
  // than assign.
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      addEventListener: (t: string, fn: Listener) => { (listeners[t] ||= []).push(fn); },
      removeEventListener: (t: string, fn: Listener) => {
        listeners[t] = (listeners[t] || []).filter((f) => f !== fn);
      },
    },
  });
  (globalThis as Record<string, unknown>).getComputedStyle = () =>
    ({ gridTemplateColumns: '50px 200px 200px', columnGap: '12px' });
}

/** Classes the session put on the handle it is dragging. */
let handleClasses: Set<string>;

/** The handle, its row and its block, all measurable. */
function handleEl() {
  const row = {};
  const block = { getBoundingClientRect: () => ({ top: 10, height: 300 }) };
  handleClasses = new Set();
  return {
    getBoundingClientRect: () => ({ left: 300, width: 16 }),
    classList: {
      add: (c: string) => handleClasses.add(c),
      remove: (c: string) => handleClasses.delete(c),
    },
    closest: (sel: string) => (sel === '.av-row' ? row : sel === '.av-block' ? block : null),
  } as unknown as HTMLElement;
}

function fakeEditor(state: EditorState) {
  const setAvColumnWidths = vi.fn();
  return { editor: { state, commands: { setAvColumnWidths } } as never, setAvColumnWidths };
}

function start(overrides: Record<string, unknown> = {}) {
  const { blockPos, state } = avDoc();
  const { editor, setAvColumnWidths } = fakeEditor(state);
  const ok = beginColumnDrag({
    event: { button: 0, pointerId: 1, clientX: 300 } as PointerEvent,
    handleEl: handleEl(),
    boundary: boundary('video-audio'),
    blockPos,
    editor,
    ...overrides,
  } as never);
  return { ok, setAvColumnWidths };
}

describe('the AV column drag session', () => {
  beforeEach(stubDom);
  afterEach(() => {
    cancelColumnDrag();
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).window;
    delete (globalThis as Record<string, unknown>).getComputedStyle;
  });

  it('marks the document while dragging and clears it on release', () => {
    const { ok } = start();
    expect(ok).toBe(true);
    expect(bodyClasses.has('av-col-resizing')).toBe(true);
    fire('pointerup', { pointerId: 1 });
    expect(bodyClasses.has('av-col-resizing')).toBe(false);
  });

  it('clears it on cancel, on Escape, and when the window loses focus', () => {
    for (const [type, event] of [
      ['pointercancel', { pointerId: 1 }],
      ['keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} }],
      ['blur', {}],
    ] as const) {
      stubDom();
      start();
      expect(bodyClasses.has('av-col-resizing')).toBe(true);
      fire(type, event as Record<string, unknown>);
      expect(bodyClasses.has('av-col-resizing'), `after ${type}`).toBe(false);
      expect(isColumnDragActive(), `after ${type}`).toBe(false);
    }
  });

  it('lights the handle being dragged, and puts it out on release', () => {
    start();
    expect(handleClasses.has('av-col-handle--active')).toBe(true);
    fire('pointerup', { pointerId: 1 });
    expect(handleClasses.has('av-col-handle--active')).toBe(false);
  });

  it('removes every window listener it added', () => {
    start();
    expect(Object.values(listeners).flat().length).toBeGreaterThan(0);
    fire('pointerup', { pointerId: 1 });
    expect(Object.values(listeners).flat()).toEqual([]);
  });

  it('takes the guide line down with it', () => {
    start();
    expect(appended).toHaveLength(1);
    expect(appended[0].removed).toBe(false);
    fire('pointerup', { pointerId: 1 });
    expect(appended[0].removed).toBe(true);
  });

  it('commits the dragged widths once, on release', () => {
    const { setAvColumnWidths } = start();
    fire('pointermove', { pointerId: 1, clientX: 350, preventDefault() {} });
    expect(setAvColumnWidths).not.toHaveBeenCalled();
    fire('pointerup', { pointerId: 1 });
    // 50px at 4.5fr/450px = 0.5fr moved from audio into video.
    expect(setAvColumnWidths).toHaveBeenCalledTimes(1);
    const [widths] = setAvColumnWidths.mock.calls[0];
    expect(widths.video).toBeCloseTo(AV_DEFAULT_COLUMNS.widths.video + 0.5, 10);
    expect(widths.audio).toBeCloseTo(AV_DEFAULT_COLUMNS.widths.audio - 0.5, 10);
  });

  it('commits nothing when the drag is abandoned', () => {
    const { setAvColumnWidths } = start();
    fire('pointermove', { pointerId: 1, clientX: 350, preventDefault() {} });
    fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
    expect(setAvColumnWidths).not.toHaveBeenCalled();
  });

  it('ignores events from a different pointer', () => {
    const { setAvColumnWidths } = start();
    fire('pointerup', { pointerId: 99 });
    expect(isColumnDragActive()).toBe(true);
    expect(setAvColumnWidths).not.toHaveBeenCalled();
  });

  it('refuses to start on a position that is not an AV body', () => {
    const { ok } = start({ blockPos: 9999 });
    expect(ok).toBe(false);
    expect(bodyClasses.has('av-col-resizing')).toBe(false);
  });

  it('refuses to start on a row it cannot measure', () => {
    (globalThis as Record<string, unknown>).getComputedStyle = () =>
      ({ gridTemplateColumns: 'none', columnGap: '0px' });
    const { ok } = start({
      handleEl: {
        getBoundingClientRect: () => ({ left: 300, width: 16 }),
        classList: { add: () => {}, remove: () => {} },
        closest: (sel: string) => (sel === '.av-row'
          ? { getBoundingClientRect: () => ({ width: 0 }) }
          : null),
      } as unknown as HTMLElement,
    });
    expect(ok).toBe(false);
    expect(bodyClasses.has('av-col-resizing')).toBe(false);
  });

  it('refuses a non-primary button, so a right-click is not a resize', () => {
    const { ok } = start({ event: { button: 2, pointerId: 1, clientX: 300 } as PointerEvent });
    expect(ok).toBe(false);
    expect(isColumnDragActive()).toBe(false);
  });
});
