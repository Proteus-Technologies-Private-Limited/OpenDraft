/**
 * The trackpad-drag fallback for mobile web views.
 *
 * Two things this pins. A drag used to be cancelled by ANY change to the
 * document, so a collaborator typing elsewhere (or a plugin touching the
 * document) froze the selection mid-drag; the anchor is now carried through
 * the edit and only an anchor that was itself deleted ends the drag. And a
 * double-click drag used to fall back to character-by-character from the press
 * point, dropping the start of the double-clicked word.
 *
 * No DOM here: the view is a stand-in around a real EditorState, with
 * coordinates mapped straight to positions (x = position × 10, so a move of
 * one position clears the drag threshold).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Schema } from '@tiptap/pm/model';
import { EditorState, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { installMobileMouseSelection, wordRangeAt } from './mobileMouseSelection';

const schema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*' },
    text: {},
  },
});

function docOf(...paragraphs: string[]) {
  return schema.node('doc', null, paragraphs.map(t => schema.node('paragraph', null, t ? [schema.text(t)] : [])));
}

class FakeElement {
  closest() { return null; }
}

// Handlers take whatever event the code under test listens for.
type Listener = (event: never) => void;

function listeners() {
  const map = new Map<string, Set<Listener>>();
  return {
    add: (type: string, fn: Listener) => { if (!map.has(type)) map.set(type, new Set()); map.get(type)!.add(fn); },
    remove: (type: string, fn: Listener) => { map.get(type)?.delete(fn); },
    fire: (type: string, event: object) => { for (const fn of map.get(type) ?? []) fn(event as never); },
  };
}

function setup(text: string[]) {
  const winListeners = listeners();
  const domListeners = listeners();
  let rafCallbacks: Array<() => void> = [];
  /** What the browser reports as its own selection, as positions. */
  let browserRange: { anchor: number; focus: number } | null = null;

  const win = {
    innerWidth: 100_000,
    innerHeight: 10_000,
    requestAnimationFrame: (cb: () => void) => { rafCallbacks.push(cb); return rafCallbacks.length; },
    cancelAnimationFrame: () => {},
    addEventListener: winListeners.add,
    removeEventListener: winListeners.remove,
  };
  const marker = {};
  const doc = {
    defaultView: win,
    getSelection: () => browserRange && {
      anchorNode: marker, anchorOffset: browserRange.anchor,
      focusNode: marker, focusOffset: browserRange.focus,
      isCollapsed: browserRange.anchor === browserRange.focus,
      setBaseAndExtent: () => {},
    },
  };
  const dom = {
    ownerDocument: doc,
    closest: () => null,
    contains: () => true,
    addEventListener: domListeners.add,
    removeEventListener: domListeners.remove,
    getBoundingClientRect: () => ({ left: -1, top: -1, right: 100_000, bottom: 10_000 }),
  };

  const view = {
    state: EditorState.create({ doc: docOf(...text) }),
    dom,
    editable: true,
    composing: false,
    isDestroyed: false,
    posAtCoords: ({ left }: { left: number }) => ({ pos: Math.min(Math.round(left / 10), view.state.doc.content.size - 1), inside: -1 }),
    posAtDOM: (_node: unknown, offset: number) => offset,
    domAtPos: (pos: number) => ({ node: marker, offset: pos }),
    hasFocus: () => true,
    focus: () => {},
    dispatch(tr: Transaction) { view.state = view.state.apply(tr); },
    updateState(state: EditorState) { view.state = state; },
  };

  const uninstall = installMobileMouseSelection(view as unknown as EditorView);

  const flush = () => {
    const pending = rafCallbacks;
    rafCallbacks = [];
    for (const cb of pending) cb();
  };
  const press = (x: number, clicks = 1) => {
    domListeners.fire('pointerdown', {
      pointerType: 'mouse', button: 0, pointerId: 1, clientX: x * 10, clientY: 5,
      target: new FakeElement(), detail: 0,
    });
    domListeners.fire('mousedown', { button: 0, detail: clicks });
  };
  const moveTo = (x: number) => {
    winListeners.fire('pointermove', { pointerId: 1, buttons: 1, clientX: x * 10, clientY: 5 });
    flush();
  };
  const sel = () => ({ anchor: view.state.selection.anchor, head: view.state.selection.head });

  return {
    view, press, moveTo, sel, uninstall,
    setBrowserRange: (r: { anchor: number; focus: number } | null) => { browserRange = r; },
  };
}

describe('mobile trackpad selection', () => {
  beforeEach(() => {
    (globalThis as unknown as { Element?: unknown }).Element = FakeElement;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete (globalThis as unknown as { Element?: unknown }).Element;
    vi.restoreAllMocks();
  });

  it('keeps extending when someone else edits the document mid-drag', () => {
    // "hello world": h at 1, w at 7.
    const t = setup(['hello world']);
    t.press(7);
    t.moveTo(10);
    expect(t.sel()).toEqual({ anchor: 7, head: 10 });

    // A collaborator types at the start of the paragraph.
    t.view.dispatch(t.view.state.tr.insertText('XX', 1));
    t.moveTo(13);
    // The anchor followed the edit (7 → 9) and the drag carried on.
    expect(t.sel()).toEqual({ anchor: 9, head: 13 });
  });

  it('ends the drag only when the anchor itself is deleted', () => {
    const t = setup(['hello world']);
    t.press(7);
    t.moveTo(10);
    t.view.dispatch(t.view.state.tr.delete(5, 9));
    const after = t.sel();
    t.moveTo(3);
    expect(t.sel()).toEqual(after);
  });

  it('extends a double-click drag by whole words', () => {
    // "one two three": one 1-4, two 5-8, three 9-14.
    const t = setup(['one two three']);
    t.press(6, 2);
    // A web view that never extends: its selection stays exactly the word.
    t.setBrowserRange({ anchor: 5, focus: 8 });
    t.moveTo(7);
    // Still inside the double-clicked word: left alone.
    expect(t.sel()).toEqual({ anchor: 1, head: 1 });

    t.moveTo(10);
    expect(t.sel()).toEqual({ anchor: 5, head: 14 });
    // Back across the word: anchored at its end, out to the start of "one".
    t.moveTo(2);
    expect(t.sel()).toEqual({ anchor: 8, head: 1 });
  });

  it('stays out of a double-click drag the browser is extending itself', () => {
    const t = setup(['one two three']);
    t.press(6, 2);
    // Anchored at the word's start and already reaching into "three".
    t.setBrowserRange({ anchor: 5, focus: 11 });
    t.moveTo(11);
    expect(t.sel()).toEqual({ anchor: 1, head: 1 });
  });

  it('still drags character by character from a single click', () => {
    const t = setup(['one two three']);
    t.press(6);
    t.moveTo(10);
    expect(t.sel()).toEqual({ anchor: 6, head: 10 });
  });

  it('takes its edit watcher back out when uninstalled', () => {
    const t = setup(['one']);
    const before = t.view.state.plugins.length;
    t.uninstall();
    expect(t.view.state.plugins.length).toBe(before - 1);
  });
});

describe('wordRangeAt', () => {
  it('finds the word, the run of spaces, and the word before a block end', () => {
    const doc = docOf('one  two');
    expect(wordRangeAt(doc, 2)).toEqual({ from: 1, to: 4 });
    expect(wordRangeAt(doc, 5)).toEqual({ from: 4, to: 6 });
    expect(wordRangeAt(doc, 9)).toEqual({ from: 6, to: 9 });
  });

  it('is a caret in an empty block', () => {
    expect(wordRangeAt(docOf(''), 1)).toEqual({ from: 1, to: 1 });
  });
});
