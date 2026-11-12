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

  it('reports an edit that never pauses every maxWait, with the document as it stands', () => {
    vi.useFakeTimers();
    const ed = emitter();
    const seen: string[] = [];
    watchSettledDoc(ed as never, 300, (d) => seen.push(d.textContent), 3000);
    // A key every 100 ms for 7 s: never a 300 ms pause.
    let text = 'A';
    for (let t = 0; t < 7000; t += 100) {
      text += 'x';
      ed.edit(text);
      vi.advanceTimersByTime(100);
    }
    expect(seen).toHaveLength(2);
    expect(seen[0].length).toBe(31); // the 30th key landed at 2.9 s
    expect(seen[1].length).toBe(61);
    // Once the typing stops, the last document is reported after the pause.
    vi.advanceTimersByTime(300);
    expect(seen).toHaveLength(3);
    expect(seen[2]).toBe(text);
  });

  it('starts the longest wait again after each report', () => {
    vi.useFakeTimers();
    const ed = emitter();
    const onSettle = vi.fn();
    watchSettledDoc(ed as never, 300, onSettle, 3000);
    ed.edit('AB');
    vi.advanceTimersByTime(300);
    expect(onSettle).toHaveBeenCalledTimes(1);
    // A fresh burst 1 s later is not cut short by the earlier one's clock.
    vi.advanceTimersByTime(1000);
    for (let t = 0; t < 2900; t += 100) { ed.edit(`AB${t}`); vi.advanceTimersByTime(100); }
    expect(onSettle).toHaveBeenCalledTimes(1);
    ed.edit('ABC');
    vi.advanceTimersByTime(100);
    expect(onSettle).toHaveBeenCalledTimes(2);
  });

  it('keeps reporting after a reader throws', () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ed = emitter();
    const onSettle = vi.fn().mockImplementationOnce(() => { throw new Error('boom'); });
    watchSettledDoc(ed as never, 300, onSettle, 3000);
    ed.edit('AB');
    vi.advanceTimersByTime(300);
    ed.edit('ABC');
    vi.advanceTimersByTime(300);
    expect(onSettle).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('[editor] a settled-document reader failed', expect.any(Error));
  });
});
