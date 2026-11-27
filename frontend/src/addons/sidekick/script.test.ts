/**
 * Capturing a selection with its formatting, finding it again after edits
 * and round trips, and putting it back — against core's real screenplay
 * schema, with no browser.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, Selection, TextSelection } from '@tiptap/pm/state';
import { testSchema, block, BR } from '../../test/screenplaySchema';
import { captureSelection, excerptSlice, insertTransaction, locate, moveSelection, sceneAt, sourceAt, MAX_EXCERPT_CHARS } from './script';

const docJSON = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', attrs: { sceneUid: 'kitchen' }, content: [{ type: 'text', text: 'INT. KITCHEN - NIGHT' }] },
    block('action', 'Anna waits by the door.'),
    block('character', 'ANNA'),
    { type: 'dialogue', content: [{ type: 'text', text: 'You came ' }, { type: 'text', text: 'back', marks: [{ type: 'italic' }] }, { type: 'text', text: '.' }] },
    { type: 'sceneHeading', attrs: { sceneUid: 'street' }, content: [{ type: 'text', text: 'EXT. STREET - NIGHT' }] },
    block('action', 'Rain.', BR, 'Anna waits by the door.'),
  ],
};

function stateWith(from: number, to: number) {
  const doc = testSchema.nodeFromJSON(docJSON);
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, to) });
}

/** Document positions of a text inside the nth textblock that has it. */
function find(state: EditorState, text: string, nth = 0): { from: number; to: number } {
  const hits: Array<{ from: number; to: number }> = [];
  state.doc.descendants((node, pos) => {
    if (node.isText && node.text!.includes(text)) {
      const at = pos + node.text!.indexOf(text);
      hits.push({ from: at, to: at + text.length });
    }
  });
  return hits[nth];
}

describe('captureSelection', () => {
  it('keeps the elements and marks, and records the scene', () => {
    const base = stateWith(1, 1);
    const start = find(base, 'ANNA').from;
    // Through the full stop after the italic "back".
    const end = find(base, 'back').to + 1;
    const capture = captureSelection(stateWith(start, end))!;
    expect(capture.excerpt.text).toBe('ANNA\n\nYou came back.');
    expect(capture.excerpt.content.map((n) => n.type)).toEqual(['character', 'dialogue']);
    expect(JSON.stringify(capture.excerpt.content)).toContain('"italic"');
    expect(capture.source).toMatchObject({ sceneHeading: 'INT. KITCHEN - NIGHT', sceneUid: 'kitchen', sceneIndex: 0, elementType: 'character', navigation: 'selection', anchor: { offset: start } });
  });

  it('returns nothing for an empty selection', () => {
    expect(captureSelection(stateWith(3, 3))).toBeNull();
  });

  it('refuses a selection too long to keep', () => {
    const huge = testSchema.nodeFromJSON({ type: 'doc', content: [block('action', 'x'.repeat(MAX_EXCERPT_CHARS + 10))] });
    const state = EditorState.create({ doc: huge, selection: TextSelection.create(huge, 1, huge.content.size - 1) });
    expect(() => captureSelection(state)).toThrow(/too long/);
  });

  it('knows the scene of any position', () => {
    const state = stateWith(1, 1);
    expect(sceneAt(state.doc, find(state, 'Rain').from)).toEqual({ sceneHeading: 'EXT. STREET - NIGHT', sceneUid: 'street', sceneIndex: 1 });
  });
});

describe('locate', () => {
  const state = stateWith(1, 1);
  const kitchenCapture = () => captureSelection(stateWith(find(state, 'Anna waits').from, find(state, 'door.').to))!;

  it('prefers the copy in the scene it came from', () => {
    const capture = kitchenCapture();
    const street = sourceAt(state.doc, find(state, 'Anna waits', 1).from, 'selection');
    const there = locate(state.doc, capture.excerpt, street)!;
    // The second copy sits after a hard break, which counts as one character.
    expect(state.doc.textBetween(there.from, there.to)).toBe('Anna waits by the door.');
    expect(there.from).toBe(find(state, 'Anna waits', 1).from);
    const here = locate(state.doc, capture.excerpt, capture.source)!;
    expect(here.from).toBe(find(state, 'Anna waits', 0).from);
    expect(here.exact).toBe(true);
  });

  it('falls back to the saved position when the text changes, and to nothing when both are gone', () => {
    const capture = kitchenCapture();
    const edited = { ...capture.excerpt, text: 'A line that is no longer in the script' };
    const scene = locate(state.doc, edited, capture.source)!;
    expect(scene.exact).toBe(false);
    expect(scene).toEqual({ from: find(state, 'Anna waits').from, to: find(state, 'Anna waits').from, exact: false });
    expect(locate(state.doc, edited, { sceneHeading: 'INT. NOWHERE', sceneUid: null, sceneIndex: null, elementType: null })).toBeNull();
  });

  it('still falls back to the scene heading for older tasks', () => {
    const { excerpt, source } = kitchenCapture();
    const legacy = { ...source, navigation: undefined, anchor: undefined };
    expect(locate(state.doc, { ...excerpt, text: 'rewritten' }, legacy)).toEqual({ from: 1, to: 1, exact: false });
  });

  it('finds the scene by heading when its id did not survive a round trip', () => {
    const capture = kitchenCapture();
    const noUid = { ...capture.source, sceneUid: 'lost-in-fountain' };
    const edited = { ...capture.excerpt, text: 'rewritten beyond recognition' };
    const scene = locate(state.doc, edited, noUid)!;
    expect(scene.from).toBe(find(state, 'Anna waits').from);
  });

  it('returns the full formatted range across elements and a hard break after edits', () => {
    const from = find(state, 'back').from;
    const to = find(state, 'Anna waits', 1).from + 4;
    const capture = captureSelection(stateWith(from, to))!;
    const tr = state.tr.insertText('Earlier edit: ', find(state, 'Anna waits').from);
    expect(locate(tr.doc, capture.excerpt, capture.source)).toEqual({ from: tr.mapping.map(from), to: tr.mapping.map(to), exact: true });
  });

  it('uses context to distinguish repeated text within a scene', () => {
    const tr = state.tr.insertText('Second: Anna waits by the door.', find(state, 'door.').to);
    const next = state.apply(tr);
    const from = find(next, 'door.').from + 'door.Second: '.length;
    const to = from + 'Anna waits'.length;
    const capture = captureSelection(next.apply(next.tr.setSelection(TextSelection.create(next.doc, from, to))))!;
    expect(locate(next.doc, capture.excerpt, capture.source)).toEqual({ from, to, exact: true });
  });

  it('returns to the moved text’s former position even when a duplicate remains', () => {
    const from = find(state, 'Anna waits', 1).from;
    const to = from + 'Anna waits by the door.'.length;
    const { excerpt } = captureSelection(stateWith(from, to))!;
    const cut = state.tr.delete(from, to);
    const source = sourceAt(cut.doc, from, 'cursor');
    const edit = state.apply(cut).tr.insertText('Cold ', find(state, 'Rain').from);
    const expected = edit.mapping.map(from);
    expect(locate(edit.doc, excerpt, source)).toEqual({ from: expected, to: expected, exact: false });
    expect(locate(edit.doc, excerpt, { ...source, navigation: 'none' })).toBeNull();
  });
});

describe('excerptSlice', () => {
  it('puts the excerpt back with its formatting', () => {
    const base = stateWith(1, 1);
    const capture = captureSelection(stateWith(find(base, 'ANNA').from, find(base, 'back').to + 1))!;
    const slice = excerptSlice(testSchema, capture.excerpt);
    const end = base.doc.content.size;
    const next = base.apply(base.tr.replaceRange(end, end, slice));
    const last = next.doc.lastChild!;
    expect(last.type.name).toBe('dialogue');
    expect(last.textContent).toBe('You came back.');
    expect(JSON.stringify(last.toJSON())).toContain('italic');
  });

  it('throws for an excerpt the schema cannot hold', () => {
    expect(() => excerptSlice(testSchema, { content: [{ type: 'noSuchElement' }], openStart: 0, openEnd: 0, text: 'x' })).toThrow();
  });
});

describe('insertTransaction', () => {
  const base = stateWith(1, 1);
  const held = () => captureSelection(stateWith(find(base, 'You came').from, find(base, 'back').to + 1))!;

  it('puts a part of one element back as an element of its own, below the cursor\'s', () => {
    const excerpt = held();
    expect(excerpt.excerpt.openStart).toBe(1); // captured from inside the dialogue
    const cursor = find(base, 'Anna waits').from + 4; // inside the first action
    const state = stateWith(cursor, cursor);
    const next = state.apply(insertTransaction(state, excerpt.excerpt));
    const types = next.doc.content.content.map((n) => `${n.type.name}:${n.textContent}`);
    expect(types.slice(1, 3)).toEqual(['action:Anna waits by the door.', 'dialogue:You came back.']);
    // Formatting comes back, and the inserted text is selected.
    expect(JSON.stringify(next.doc.child(2).toJSON())).toContain('italic');
    expect(next.doc.textBetween(next.selection.from, next.selection.to)).toBe('You came back.');
  });

  it('puts several elements back in order, after the selection, replacing nothing', () => {
    const excerpt = captureSelection(stateWith(find(base, 'ANNA').from, find(base, 'back').to + 1))!.excerpt;
    const from = find(base, 'Rain').from;
    const state = stateWith(from, from + 5); // "Rain." selected
    const next = state.apply(insertTransaction(state, excerpt));
    const names = next.doc.content.content.map((n) => n.type.name);
    expect(names.slice(-3)).toEqual(['action', 'character', 'dialogue']);
    expect(next.doc.textContent).toContain('Rain.');
  });

  it.each([
    ['part of a formatted line', find(base, 'back').from, find(base, 'back').to],
    ['an entire formatted line', find(base, 'You came').from, find(base, 'back').to + 1],
    ['a partial range across elements', find(base, 'waits').from, find(base, 'You came').to],
    ['a range starting with an entire element', find(base, 'ANNA').from, find(base, 'You came').to],
  ] as const)('restores %s at the saved cursor', (_description, from, to) => {
    const original = stateWith(from, to);
    const { excerpt } = captureSelection(original)!;
    const cut = moveSelection(original, original.selection);
    const saved = sourceAt(cut.doc, cut.selection.from, 'cursor');
    const afterCut = original.apply(cut.setSelection(TextSelection.create(cut.doc, locate(cut.doc, excerpt, saved)!.from)));
    const restored = afterCut.apply(insertTransaction(afterCut, excerpt, saved));

    expect(restored.doc.toJSON()).toEqual(original.doc.toJSON());
    expect(restored.selection.from).toBe(from);
    expect(restored.selection.to).toBe(to);
  });

  it('restores the original element type for older cuts that removed its opening', () => {
    const from = find(base, 'ANNA').from;
    const to = find(base, 'You came').to;
    const original = stateWith(from, to);
    const { excerpt } = captureSelection(original)!;
    const cut = original.tr.deleteSelection();
    const cursor = Selection.near(cut.doc.resolve(cut.mapping.map(from, -1)));
    const saved = sourceAt(cut.doc, cursor.from, 'cursor');
    const afterCut = original.apply(cut.setSelection(cursor));
    const restored = afterCut.apply(insertTransaction(afterCut, excerpt, saved));
    expect(restored.doc.toJSON()).toEqual(original.doc.toJSON());
    expect(restored.selection.from).toBe(from);
    expect(restored.selection.to).toBe(to);
  });
});

describe('locate a long line', () => {
  it('selects the whole first line, not just the start it searched for', () => {
    const long = 'He copies the files to a second drive, tapes it under his desk drawer, grabs his coat and the original drive, and heads for the door.';
    const doc = testSchema.nodeFromJSON({ type: 'doc', content: [block('action', long)] });
    const found = locate(doc, { content: [], openStart: 0, openEnd: 0, text: long }, { sceneHeading: null, sceneUid: null, sceneIndex: null, elementType: null })!;
    expect(long.length).toBeGreaterThan(120);
    expect(doc.textBetween(found.from, found.to)).toBe(long);
  });
});
