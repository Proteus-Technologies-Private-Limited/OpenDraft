/**
 * Deleting a script note has to take its highlight with it.
 *
 * The bug these exist for: the note disappeared from the panel but its
 * highlight stayed on the page. The delete ran through a TipTap chain that
 * began with `.focus()`, and a chain that fails at any step dispatches nothing
 * at all — so the store half of the delete happened and the document half did
 * not. These drive the real helpers against a real ProseMirror state, with a
 * view that records whether anything was dispatched.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import {
  removeScriptNoteMarks,
  recolorScriptNoteMarks,
  findScriptNotePos,
  isTranslucent,
  sweepStrayNoteHighlights,
  type MarkEditor,
} from './scriptNoteMarks';
import { doc, marked, pmDoc, testSchema } from '../test/screenplaySchema';
import type { JSONContent } from '@tiptap/react';

const note = (id: string, color = '#f4d35e') => ({ type: 'scriptNote', attrs: { noteId: id, color } });

/** An editor whose dispatch applies the transaction, as a real view would. */
function fakeEditor(json: JSONContent) {
  let state = EditorState.create({ schema: testSchema, doc: pmDoc(json) });
  let dispatched = 0;
  const ed: MarkEditor = {
    get state() { return state as unknown as MarkEditor['state']; },
    view: { dispatch: (tr: Transaction) => { dispatched++; state = state.apply(tr); } },
  };
  return {
    ed,
    get dispatched() { return dispatched; },
    /** Every note id still marked in the document, in order. */
    marks(): string[] {
      const out: string[] = [];
      state.doc.descendants((n) => {
        if (!n.isText) return;
        for (const m of n.marks) {
          if (m.type === testSchema.marks.scriptNote) out.push(String(m.attrs.noteId));
        }
      });
      return out;
    },
    colors(): string[] {
      const out: string[] = [];
      state.doc.descendants((n) => {
        if (!n.isText) return;
        for (const m of n.marks) {
          if (m.type === testSchema.marks.scriptNote) out.push(String(m.attrs.color));
        }
      });
      return out;
    },
  };
}

const SPLIT: JSONContent = doc({
  type: 'action',
  content: [
    { type: 'text', text: 'one small ' },
    { type: 'text', text: 'step', marks: [note('n1')] },
    { type: 'text', text: ' for ' },
    // The same note anchored again further along.
    { type: 'text', text: 'a man', marks: [note('n1')] },
  ],
});

const TWO = doc(
  marked('action', 'first', note('n1')),
  marked('action', 'second', note('n2')),
);

describe('removeScriptNoteMarks', () => {
  it('takes the highlight with it', () => {
    const e = fakeEditor(TWO);
    expect(e.marks()).toEqual(['n1', 'n2']);
    expect(removeScriptNoteMarks(e.ed, 'n1')).toBe(true);
    expect(e.marks()).toEqual(['n2']);
  });

  it('actually dispatches — the bug was that it did not', () => {
    const e = fakeEditor(TWO);
    removeScriptNoteMarks(e.ed, 'n1');
    expect(e.dispatched).toBe(1);
  });

  it('clears every anchor of the same note, not just the first', () => {
    const e = fakeEditor(SPLIT);
    expect(e.marks()).toEqual(['n1', 'n1']);
    removeScriptNoteMarks(e.ed, 'n1');
    expect(e.marks()).toEqual([]);
  });

  it('leaves the other notes alone', () => {
    const e = fakeEditor(TWO);
    removeScriptNoteMarks(e.ed, 'n2');
    expect(e.marks()).toEqual(['n1']);
  });

  it('dispatches nothing when the note has no mark left', () => {
    // A general note never had one; nor does a note whose text was deleted.
    const e = fakeEditor(TWO);
    expect(removeScriptNoteMarks(e.ed, 'gone')).toBe(false);
    expect(e.dispatched).toBe(0);
    expect(e.marks()).toEqual(['n1', 'n2']);
  });

  it('is safe without an editor or an id', () => {
    expect(removeScriptNoteMarks(null, 'n1')).toBe(false);
    expect(removeScriptNoteMarks(fakeEditor(TWO).ed, '')).toBe(false);
  });
});

describe('recolorScriptNoteMarks', () => {
  it('repaints every anchor of the note', () => {
    const e = fakeEditor(SPLIT);
    expect(recolorScriptNoteMarks(e.ed, 'n1', '#6abf69')).toBe(true);
    expect(e.colors()).toEqual(['#6abf69', '#6abf69']);
  });

  it('leaves other notes their colour', () => {
    const e = fakeEditor(TWO);
    recolorScriptNoteMarks(e.ed, 'n1', '#6abf69');
    expect(e.colors()).toEqual(['#6abf69', '#f4d35e']);
  });

  it('keeps the note attached to its text', () => {
    const e = fakeEditor(TWO);
    recolorScriptNoteMarks(e.ed, 'n1', '#6abf69');
    expect(e.marks()).toEqual(['n1', 'n2']);
  });
});

describe('findScriptNotePos', () => {
  it('finds the first anchor', () => {
    const e = fakeEditor(SPLIT);
    // Block opens at 0, its text at 1, and the marked word follows 'one small '.
    expect(findScriptNotePos(e.ed, 'n1')).toBe(1 + 'one small '.length);
  });

  it('is null for a note with no anchor', () => {
    expect(findScriptNotePos(fakeEditor(TWO).ed, 'gone')).toBeNull();
  });
});

describe('isTranslucent', () => {
  // How a highlight left behind by the render bug is told apart from one the
  // writer actually pasted.
  it('recognises an alpha channel', () => {
    expect(isTranslucent('rgba(244, 211, 94, 0.2)')).toBe(true);
    expect(isTranslucent('#f4d35e33')).toBe(true);
  });

  it('treats an opaque colour as one the writer pasted', () => {
    expect(isTranslucent('rgb(244, 211, 94)')).toBe(false);
    expect(isTranslucent('#f4d35e')).toBe(false);
    expect(isTranslucent('rgba(244, 211, 94, 1)')).toBe(false);
    expect(isTranslucent('#f4d35eff')).toBe(false);
    expect(isTranslucent('yellow')).toBe(false);
    expect(isTranslucent('')).toBe(false);
  });
});

describe('the highlight that outlived its note', () => {
  /**
   * The real bug: PastedHighlight matches any inline `background-color`, and
   * the note mark used to write one — so re-parsing the document (a copy and
   * paste inside the editor does it) left a second, translucent highlight over
   * the same words. Deleting the note removed only the note's own mark.
   */
  const withStray = (color: string): JSONContent => doc({
    type: 'action',
    content: [
      { type: 'text', text: 'plain ' },
      {
        type: 'text',
        text: 'noted',
        marks: [note('n1'), { type: 'highlight', attrs: { color } }],
      },
    ],
  });

  const highlights = (json: JSONContent, run: (e: ReturnType<typeof fakeEditor>) => void) => {
    const e = fakeEditor(json);
    run(e);
    const out: string[] = [];
    // Read the highlights left in the document.
    const state = (e.ed.state as unknown as { doc: { descendants: (f: (n: unknown) => void) => void } });
    state.doc.descendants((n: unknown) => {
      const node = n as { isText?: boolean; marks?: readonly { type: unknown; attrs: Record<string, unknown> }[] };
      if (!node.isText || !node.marks) return;
      for (const m of node.marks) {
        if (m.type === testSchema.marks.highlight) out.push(String(m.attrs.color));
      }
    });
    return out;
  };

  it('sweeps a translucent stray away with the note', () => {
    const left = highlights(withStray('rgba(244, 211, 94, 0.2)'), (e) => {
      removeScriptNoteMarks(e.ed, 'n1');
    });
    expect(left).toEqual([]);
  });

  it('keeps a highlight the writer pasted', () => {
    // Opaque: this one is the writer's, not ours, and deleting a note must not
    // quietly take it.
    const left = highlights(withStray('rgb(255, 230, 153)'), (e) => {
      removeScriptNoteMarks(e.ed, 'n1');
    });
    expect(left).toEqual(['rgb(255, 230, 153)']);
  });

  it('still removes the note mark itself either way', () => {
    const e = fakeEditor(withStray('rgb(255, 230, 153)'));
    removeScriptNoteMarks(e.ed, 'n1');
    expect(e.marks()).toEqual([]);
  });
});

describe('sweepStrayNoteHighlights', () => {
  /** Text carrying an annotation and, on top of it, a highlight. */
  const over = (annotation: { type: string; attrs?: Record<string, unknown> }, color: string): JSONContent => doc({
    type: 'action',
    content: [
      { type: 'text', text: 'clean ' },
      { type: 'text', text: 'marked', marks: [annotation, { type: 'highlight', attrs: { color } }] },
    ],
  });

  const remaining = (e: ReturnType<typeof fakeEditor>) => {
    const out: string[] = [];
    const st = e.ed.state as unknown as { doc: { descendants: (f: (n: unknown) => void) => void } };
    st.doc.descendants((n: unknown) => {
      const node = n as { isText?: boolean; marks?: readonly { type: unknown; attrs: Record<string, unknown> }[] };
      if (!node.isText || !node.marks) return;
      for (const m of node.marks) {
        if (m.type === testSchema.marks.highlight) out.push(String(m.attrs.color));
      }
    });
    return out;
  };

  it('clears a translucent highlight sitting on a note', () => {
    // The signature of the bug: turning note highlights off left this behind.
    const e = fakeEditor(over(note('n1'), 'rgba(244, 211, 94, 0.2)'));
    expect(sweepStrayNoteHighlights(e.ed)).toBe(1);
    expect(remaining(e)).toEqual([]);
    // ...and the note itself is untouched.
    expect(e.marks()).toEqual(['n1']);
  });

  it('clears one sitting on a production tag', () => {
    const tag = { type: 'productionTag', attrs: { tagId: 't1', color: '#9370DB' } };
    const e = fakeEditor(over(tag, 'rgba(147, 112, 219, 0.25)'));
    expect(sweepStrayNoteHighlights(e.ed)).toBe(1);
    expect(remaining(e)).toEqual([]);
  });

  it('keeps an opaque highlight, which the writer pasted', () => {
    const e = fakeEditor(over(note('n1'), 'rgb(255, 230, 153)'));
    expect(sweepStrayNoteHighlights(e.ed)).toBe(0);
    expect(remaining(e)).toEqual(['rgb(255, 230, 153)']);
  });

  it('keeps a translucent highlight that is not on an annotation', () => {
    // Nothing marks it as ours, so it is the writer's to keep.
    const plain: JSONContent = doc(marked('action', 'just highlighted',
      { type: 'highlight', attrs: { color: 'rgba(0, 200, 0, 0.3)' } }));
    const e = fakeEditor(plain);
    expect(sweepStrayNoteHighlights(e.ed)).toBe(0);
    expect(remaining(e)).toEqual(['rgba(0, 200, 0, 0.3)']);
  });

  it('dispatches nothing when there is nothing to sweep', () => {
    const e = fakeEditor(TWO);
    expect(sweepStrayNoteHighlights(e.ed)).toBe(0);
    expect(e.dispatched).toBe(0);
  });

  it('is safe without an editor', () => {
    expect(sweepStrayNoteHighlights(null)).toBe(0);
  });
});
