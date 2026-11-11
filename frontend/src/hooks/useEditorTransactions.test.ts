import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import { block, doc, pmDoc } from '../test/screenplaySchema';
import { docJSON, readEditor, watchSettledDoc } from './useEditorTransactions';

const fakeEditor = (overrides: Partial<Editor> = {}) =>
  ({ isDestroyed: false, state: { doc: pmDoc(doc(block('action', 'A'))) }, ...overrides }) as unknown as Editor;

afterEach(() => vi.restoreAllMocks());

describe('readEditor', () => {
  it('reads the editor it is given', () => {
    const ed = fakeEditor();
    expect(readEditor(ed, (e) => e.state.doc.textContent, '', 'text')).toBe('A');
  });

  it('answers the fallback without an editor, or for a destroyed one', () => {
    expect(readEditor(null, () => 'read', 'fallback', 'text')).toBe('fallback');
    expect(readEditor(fakeEditor({ isDestroyed: true }), () => 'read', 'fallback', 'text')).toBe('fallback');
  });

  it('logs a selector that throws and answers the fallback instead of throwing during render', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = readEditor(fakeEditor(), () => { throw new Error('malformed doc'); }, false, 'whether the script has an AV body');
    expect(result).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[editor] whether the script has an AV body could not be read from the editor',
      expect.any(Error),
    );
  });
});

describe('docJSON', () => {
  it('serialises a document once, and a changed document afresh', () => {
    const first = pmDoc(doc(block('action', 'One')));
    const spy = vi.spyOn(first, 'toJSON');
    const json = docJSON(first);
    expect(docJSON(first)).toBe(json);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(json).toEqual(first.toJSON());

    const second = pmDoc(doc(block('action', 'Two')));
    expect(docJSON(second)).not.toBe(json);
    expect(docJSON(second)).toEqual(second.toJSON());
  });
});

describe('watchSettledDoc', () => {
  type Handler = (e: { transaction: { docChanged: boolean } }) => void;
  function emitter() {
    const handlers = new Set<Handler>();
    const ed = {
      isDestroyed: false,
      state: { doc: pmDoc(doc(block('action', 'A'))) },
      on: (_: string, h: Handler) => { handlers.add(h); },
      off: (_: string, h: Handler) => { handlers.delete(h); },
      edit(text: string) {
        ed.state = { doc: pmDoc(doc(block('action', text))) };
        handlers.forEach((h) => h({ transaction: { docChanged: true } }));
      },
      moveCaret() { handlers.forEach((h) => h({ transaction: { docChanged: false } })); },
      handlers,
    };
    return ed;
  }

  afterEach(() => vi.useRealTimers());

  it('reports a burst of edits once, after it stops, with the last document', () => {
    vi.useFakeTimers();
    const ed = emitter();
    const seen: string[] = [];
    watchSettledDoc(ed as never, 300, (d) => seen.push(d.textContent));
    ed.edit('AB');
    vi.advanceTimersByTime(200);
    ed.edit('ABC');
    vi.advanceTimersByTime(200);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(seen).toEqual(['ABC']);
  });

  it('does not count a caret move as a change', () => {
    vi.useFakeTimers();
    const ed = emitter();
    const onSettle = vi.fn();
    watchSettledDoc(ed as never, 300, onSettle);
    ed.moveCaret();
    vi.advanceTimersByTime(1000);
    expect(onSettle).not.toHaveBeenCalled();
  });

  it('stops listening, and drops a pending report, when unsubscribed or destroyed', () => {
    vi.useFakeTimers();
    const ed = emitter();
    const onSettle = vi.fn();
    const stop = watchSettledDoc(ed as never, 300, onSettle);
    ed.edit('AB');
    stop();
    vi.advanceTimersByTime(1000);
    expect(onSettle).not.toHaveBeenCalled();
    expect(ed.handlers.size).toBe(0);

    watchSettledDoc(ed as never, 300, onSettle);
    ed.edit('ABC');
    ed.isDestroyed = true;
    vi.advanceTimersByTime(1000);
    expect(onSettle).not.toHaveBeenCalled();
  });
});
