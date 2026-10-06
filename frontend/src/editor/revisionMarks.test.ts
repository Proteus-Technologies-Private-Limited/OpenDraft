import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { Slice, Fragment, type Node as PMNode } from '@tiptap/pm/model';
import { testExtensions, block } from '../test/screenplaySchema';
import { RevisionMark, RevisionTextStyle } from './extensions/RevisionMark';
import { InkAwareColor } from './extensions/InkAwareColor';
import {
  REVISION_SKIP_META, clearRevisions, hasRevisions, mergeLineBoxes, revisionMarksPlugin, revisionOf,
  type RevisionConfig,
} from './revisionMarks';

const schema = getSchema([...testExtensions, RevisionTextStyle, InkAwareColor, RevisionMark]);
const revised = (color: string, extra: Record<string, unknown> = {}) =>
  schema.marks.textStyle.create({ ...extra, revision: color });

function setup(content: object[], config: RevisionConfig | null = { enabled: true, color: 'Blue' }) {
  const cfg = { current: config };
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON({ type: 'doc', content }),
    plugins: [history(), revisionMarksPlugin(() => cfg.current)],
  });
  return { state, cfg };
}

function apply(state: EditorState, build: (s: EditorState) => Transaction): EditorState {
  return state.apply(build(state));
}

function run(state: EditorState, cmd: typeof undo): EditorState {
  let next = state;
  cmd(state, (tr) => { next = state.apply(tr); });
  return next;
}

/** [text, revision colour | null] for every text node, in order. */
function runs(doc: PMNode): Array<[string, string | null]> {
  const out: Array<[string, string | null]> = [];
  doc.descendants((n) => {
    if (n.isText) out.push([n.text!, revisionOf(n)]);
  });
  return out;
}

const flags = (doc: PMNode) => {
  const out: Array<string | null> = [];
  doc.forEach((n) => out.push((n.attrs.revised as string | null) ?? null));
  return out;
};

/** Position just after the text of the top-level block at `index`. */
function endOf(doc: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  return pos + doc.child(index).nodeSize - 1;
}

describe('marking edits', () => {
  it('marks text typed with Revision Mode on, in the current colour', () => {
    const { state } = setup([block('action', 'He waits.')]);
    const next = apply(state, (s) => s.tr.insertText(' Then runs.', endOf(s.doc, 0)));
    expect(runs(next.doc)).toEqual([['He waits.', null], [' Then runs.', 'Blue']]);
  });

  it('marks nothing with Revision Mode off', () => {
    const { state } = setup([block('action', 'He waits.')], { enabled: false, color: 'Blue' });
    const next = apply(state, (s) => s.tr.insertText('!', endOf(s.doc, 0)));
    expect(runs(next.doc)).toEqual([['He waits.!', null]]);
  });

  it('does not let new text inherit a revised neighbour with the mode off', () => {
    const { state, cfg } = setup([block('action', 'He waits.')]);
    let s = apply(state, (st) => st.tr.insertText(' Runs.', endOf(st.doc, 0)));
    cfg.current = { enabled: false, color: 'Blue' };
    // Typing at the end of the marked run: the inclusive mark would carry over.
    s = apply(s, (st) => st.tr.insertText(' Stops.', endOf(st.doc, 0), endOf(st.doc, 0)).addStoredMark(revised('Blue')));
    expect(runs(s.doc)).toEqual([['He waits.', null], [' Runs.', 'Blue'], [' Stops.', null]]);
  });

  it('re-colours text revised again in a later colour', () => {
    const { state, cfg } = setup([block('action', 'abc')]);
    let s = apply(state, (st) => st.tr.insertText('XYZ', endOf(st.doc, 0)));
    cfg.current = { enabled: true, color: 'Pink' };
    s = apply(s, (st) => st.tr.insertText('!', endOf(st.doc, 0) - 1));
    expect(runs(s.doc)).toEqual([['abc', null], ['XY', 'Blue'], ['!', 'Pink'], ['Z', 'Blue']]);
  });

  it('flags a line when text is only deleted', () => {
    const { state } = setup([block('action', 'He waits here.'), block('action', 'Untouched.')]);
    const next = apply(state, (s) => s.tr.delete(9, 14)); // " here"
    expect(next.doc.child(0).textContent).toBe('He waits.');
    expect(flags(next.doc)).toEqual(['Blue', null]);
    expect(runs(next.doc).every(([, c]) => c === null)).toBe(true);
  });

  it('flags the joined line when two lines are joined', () => {
    const { state } = setup([block('action', 'One.'), block('action', 'Two.')]);
    const at = endOf(state.doc, 0);
    const next = apply(state, (s) => s.tr.join(at + 1));
    expect(next.doc.childCount).toBe(1);
    expect(flags(next.doc)).toEqual(['Blue']);
  });

  it('flags the new line, not the old one, when a line is split', () => {
    const { state } = setup([block('action', 'One. Two.')]);
    const next = apply(state, (s) => s.tr.split(5));
    expect(next.doc.childCount).toBe(2);
    expect(flags(next.doc)).toEqual([null, 'Blue']);
  });

  it('flags a line whose element type changed', () => {
    const { state } = setup([block('action', 'JOHN')]);
    const next = apply(state, (s) => s.tr.setNodeMarkup(0, schema.nodes.character));
    expect(next.doc.child(0).type.name).toBe('character');
    expect(flags(next.doc)).toEqual(['Blue']);
  });

  it('marks a paste', () => {
    const { state } = setup([block('action', 'Start.')]);
    const slice = new Slice(Fragment.from(schema.text(' Pasted.')), 0, 0);
    const next = apply(state, (s) => {
      const tr = s.tr.setSelection(TextSelection.create(s.doc, endOf(s.doc, 0)));
      return tr.replaceSelection(slice).setMeta('uiEvent', 'paste');
    });
    expect(runs(next.doc)).toEqual([['Start.', null], [' Pasted.', 'Blue']]);
  });
});

describe('what is not a revision', () => {
  const cases: Array<[string, (tr: Transaction) => Transaction]> = [
    ['pagination / renumbering (addToHistory: false)', (tr) => tr.setMeta('addToHistory', false)],
    ['a collaborator\'s edit', (tr) => tr.setMeta('y-sync$', { isChangeOrigin: true })],
    ['an explicitly skipped transaction', (tr) => tr.setMeta(REVISION_SKIP_META, true)],
  ];
  it.each(cases)('%s', (_, tag) => {
    const { state } = setup([block('action', 'Text.')]);
    const next = apply(state, (s) => tag(s.tr.insertText(' More.', endOf(s.doc, 0))));
    expect(hasRevisions(next.doc)).toBe(false);
  });

  it('loading a whole document', () => {
    const { state } = setup([block('action', 'Old.')]);
    const fresh = schema.nodeFromJSON({ type: 'doc', content: [block('action', 'Loaded.'), block('dialogue', 'Hi.')] });
    const next = apply(state, (s) => s.tr.replaceWith(0, s.doc.content.size, fresh.content));
    expect(hasRevisions(next.doc)).toBe(false);
  });

  it('making text bold', () => {
    const { state } = setup([block('action', 'Bold me.')]);
    const next = apply(state, (s) => s.tr.addMark(1, 5, schema.marks.bold.create()));
    expect(hasRevisions(next.doc)).toBe(false);
  });

  it('anything, while there is no config (history view)', () => {
    const { state } = setup([block('action', 'Text.')], null);
    const next = apply(state, (s) => s.tr.insertText('!', endOf(s.doc, 0)));
    expect(hasRevisions(next.doc)).toBe(false);
  });
});

describe('undo, redo and clearing', () => {
  it('undo takes the text and its mark together; redo brings both back', () => {
    const { state } = setup([block('action', 'He waits.')]);
    const typed = apply(state, (s) => s.tr.insertText(' Runs.', endOf(s.doc, 0)));
    const undone = run(typed, undo);
    expect(runs(undone.doc)).toEqual([['He waits.', null]]);
    const redone = run(undone, redo);
    expect(runs(redone.doc)).toEqual([['He waits.', null], [' Runs.', 'Blue']]);
  });

  it('undoing a deletion of unrevised text restores it unmarked', () => {
    const { state } = setup([block('action', 'He waits here.')]);
    const deleted = apply(state, (s) => s.tr.delete(9, 14));
    const undone = run(deleted, undo);
    expect(undone.doc.child(0).textContent).toBe('He waits here.');
    expect(hasRevisions(undone.doc)).toBe(false);
  });

  it('Clear Revision Marks removes everything, and one undo restores it', () => {
    const { state } = setup([block('action', 'One.'), block('action', 'Two here.')]);
    let s = apply(state, (st) => st.tr.insertText(' More.', endOf(st.doc, 0)));
    s = apply(s, (st) => st.tr.delete(endOf(st.doc, 1) - 6, endOf(st.doc, 1) - 1));
    expect(hasRevisions(s.doc)).toBe(true);
    const cleared = s.apply(clearRevisions(s));
    expect(hasRevisions(cleared.doc)).toBe(false);
    const back = run(cleared, undo);
    expect(runs(back.doc)).toContainEqual([' More.', 'Blue']);
    expect(flags(back.doc)).toEqual([null, 'Blue']);
  });
});

describe('older app versions', () => {
  it('stores the revision as a textStyle attribute, which they ignore rather than reject', () => {
    const { state } = setup([block('action', 'He waits.')]);
    const next = apply(state, (s) => s.tr.insertText('!', endOf(s.doc, 0)));
    const json = JSON.stringify(next.doc.toJSON());
    expect(json).toContain('"type":"textStyle"');
    expect(json).not.toContain('"type":"revision"');
    // A schema without Revision Mode (an older app) still reads the document.
    const oldSchema = getSchema([...testExtensions, RevisionTextStyle]);
    expect(() => oldSchema.nodeFromJSON(next.doc.toJSON())).not.toThrow();
  });

  it('keeps colour and font when marking, and drops an emptied textStyle when clearing', () => {
    const doc = schema.nodeFromJSON({ type: 'doc', content: [
      { type: 'action', content: [{ type: 'text', text: 'Red words', marks: [{ type: 'textStyle', attrs: { color: '#c00000' } }] }] },
    ] });
    const cfg = { enabled: true, color: 'Blue' };
    let state = EditorState.create({ schema, doc, plugins: [history(), revisionMarksPlugin(() => cfg)] });
    state = apply(state, (s) => s.tr.insertText(' more', endOf(s.doc, 0)));
    const marksOf = (st: EditorState) => {
      const out: Array<Record<string, unknown> | null> = [];
      st.doc.descendants((n) => { if (n.isText) out.push(n.marks.find((m) => m.type.name === 'textStyle')?.attrs ?? null); });
      return out;
    };
    // Inherited the red, and gained the revision.
    expect(marksOf(state).at(-1)).toMatchObject({ color: '#c00000', revision: 'Blue' });
    state = state.apply(clearRevisions(state));
    expect(marksOf(state).every((a) => a?.color === '#c00000' && !a?.revision)).toBe(true);

    // A run whose textStyle carried only the revision loses the mark entirely.
    const plain = setup([block('action', 'Plain.')]);
    let p = apply(plain.state, (s) => s.tr.insertText(' Added.', endOf(s.doc, 0)));
    p = p.apply(clearRevisions(p));
    expect(JSON.stringify(p.doc.toJSON())).not.toContain('textStyle');
  });
});

describe('mergeLineBoxes', () => {
  it('gives each line one asterisk, however many revised runs it holds', () => {
    expect(mergeLineBoxes([
      { top: 40, height: 16 },
      { top: 0, height: 16 },
      { top: 1, height: 16 }, // second run on the first line
      { top: 20, height: 16 },
      { top: 60, height: 0 }, // collapsed rect
    ])).toEqual([
      { top: 0, height: 16 },
      { top: 20, height: 16 },
      { top: 40, height: 16 },
    ]);
  });
});
