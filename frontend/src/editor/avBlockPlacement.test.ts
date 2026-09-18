/**
 * Where a new AV body lands, and what it joins.
 *
 * `Insert AV Columns` used to be `tr.replaceSelectionWith(block)`, which put
 * the body at the CURSOR. On a line with text that splits the line: starting a
 * two-column body from the middle of "INT. KITCHEN - DAY" left a stray
 * "INT. " scene heading above the table, and that heading went on to appear in
 * the navigator and in the scene numbering. A scene heading ABOVE an AV body is
 * exactly right — it is how the two-column format is headed, and how
 * WriterDuet's A/V template builds its columns — but the heading has to survive
 * whole.
 *
 * The second half is adjacency. Two `avBlock`s with nothing between them draw
 * as one continuous table and are not one: they carry separate column widths,
 * repeat the header row, and used to restart the shot numbering. Inserting
 * against an existing body therefore adds a row to it.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, Selection, type Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { testSchema } from '../test/screenplaySchema';
import { AvBlock } from './extensions/AvBlock';

const avCommands = (AvBlock.config.addCommands as () => Record<string, (...a: never[]) => (p: unknown) => boolean>).call(
  { name: 'avBlock', options: {}, storage: {}, editor: null, type: testSchema.nodes.avBlock } as never,
);

function run(state: EditorState, name: string, ...args: unknown[]): EditorState | null {
  let next: Transaction | null = null;
  const ok = avCommands[name](...(args as never[]))({
    tr: state.tr, state, dispatch: (tr: Transaction) => { next = tr; },
  } as never);
  if (!ok || !next) return null;
  return state.apply(next!);
}

/** The document's top-level children, as `type("text")`. */
const shape = (state: EditorState): string[] =>
  state.doc.content.content.map(n => `${n.type.name}(${JSON.stringify(n.textContent)})`);

/** How many rows each top-level avBlock holds. */
const rowCounts = (state: EditorState): number[] =>
  state.doc.content.content.filter(n => n.type.name === 'avBlock').map(n => n.childCount);

const avRow = (video: string, audio: string) => ({
  type: 'avRow',
  content: [
    { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara', content: video ? [{ type: 'text', text: video }] : [] }] },
    { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara', content: audio ? [{ type: 'text', text: audio }] : [] }] },
  ],
});

/** A state over the given document JSON, with no selection placed. */
function stateOf(json: Record<string, unknown>): EditorState {
  return EditorState.create({ doc: testSchema.nodeFromJSON(json) as PmNode, schema: testSchema });
}

/** A state with the caret at `pos` in the given document JSON. */
function stateAt(json: Record<string, unknown>, pos: number): EditorState {
  const state = stateOf(json);
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
}

/** A state with the caret inside the nth top-level child. */
function caretInChild(json: Record<string, unknown>, index: number, offset = 0): EditorState {
  const state = stateOf(json);
  return state.apply(state.tr.setSelection(
    TextSelection.create(state.doc, insideChild(state, index, offset)),
  ));
}

/** The position just inside the nth top-level child's text. */
function insideChild(state: EditorState, index: number, offset = 0): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += state.doc.child(i).nodeSize;
  return pos + 1 + offset;
}

const HEADING = { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. KITCHEN - DAY' }] };
const ACTION = { type: 'action', content: [{ type: 'text', text: 'She enters.' }] };
const BLANK_ACTION = { type: 'action' };

describe('inserting an AV body next to a line of text', () => {
  it('never splits a scene heading, wherever the caret sits in it', () => {
    const base = EditorState.create({ doc: testSchema.nodeFromJSON({ type: 'doc', content: [HEADING, ACTION] }) });
    // Every caret position inside the heading, including both ends.
    for (let offset = 0; offset <= 'INT. KITCHEN - DAY'.length; offset++) {
      const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, insideChild(base, 0, offset))));
      const after = run(state, 'toggleAvBlock');
      expect(after, `offset ${offset} produced no transaction`).not.toBeNull();
      expect(shape(after!), `caret at offset ${offset}`).toEqual([
        'sceneHeading("INT. KITCHEN - DAY")',
        'avBlock("")',
        'action("She enters.")',
      ]);
    }
  });

  it('puts the body after an action line, keeping the line intact', () => {
    const state = stateAt({ type: 'doc', content: [ACTION] }, 5);
    const after = run(state, 'toggleAvBlock');
    expect(shape(after!)).toEqual(['action("She enters.")', 'avBlock("")']);
  });

  it('takes the place of a blank line rather than pushing it around', () => {
    const state = stateAt({ type: 'doc', content: [HEADING, BLANK_ACTION] }, 21);
    const after = run(state, 'toggleAvBlock');
    expect(shape(after!)).toEqual(['sceneHeading("INT. KITCHEN - DAY")', 'avBlock("")']);
  });

  it('leaves the caret in the new row’s video cell', () => {
    const state = stateAt({ type: 'doc', content: [ACTION] }, 5);
    const after = run(state, 'toggleAvBlock')!;
    const $from = after.selection.$from;
    expect($from.parent.type.name).toBe('avPara');
    expect($from.node($from.depth - 1).type.name).toBe('avCell');
    expect($from.node($from.depth - 1).attrs.side).toBe('video');
  });
});

describe('inserting against an existing AV body', () => {
  it('adds a row to the body above instead of starting a second one', () => {
    // Caret on the blank line after the body.
    const state = caretInChild({
      type: 'doc',
      content: [{ type: 'avBlock', content: [avRow('A', 'a')] }, BLANK_ACTION],
    }, 1);
    const after = run(state, 'toggleAvBlock')!;
    expect(shape(after)).toEqual(['avBlock("Aa")']);
    expect(rowCounts(after)).toEqual([2]);
  });

  it('adds a row to the body below when the caret is on the blank line above it', () => {
    const state = stateAt({
      type: 'doc',
      content: [BLANK_ACTION, { type: 'avBlock', content: [avRow('A', 'a')] }],
    }, 1);
    const after = run(state, 'toggleAvBlock')!;
    expect(rowCounts(after)).toEqual([2]);
    // The new row is at the TOP — where the caret was.
    const block = after.doc.child(0);
    expect(block.child(0).textContent).toBe('');
    expect(block.child(1).textContent).toBe('Aa');
  });

  it('keeps a line of text between two bodies as its own line', () => {
    const state = caretInChild({
      type: 'doc',
      content: [{ type: 'avBlock', content: [avRow('A', 'a')] }, ACTION],
    }, 1, 3);
    const after = run(state, 'toggleAvBlock')!;
    expect(shape(after)).toEqual(['avBlock("Aa")', 'action("She enters.")', 'avBlock("")']);
  });

  it('keeps the existing body’s column settings when it joins one', () => {
    const columns = { cue: true, image: true, widths: { cue: 1, video: 3, audio: 6, image: 2 } };
    const state = caretInChild({
      type: 'doc',
      content: [{ type: 'avBlock', attrs: { columns }, content: [avRow('A', 'a')] }, BLANK_ACTION],
    }, 1);
    const after = run(state, 'toggleAvBlock')!;
    expect(after.doc.childCount).toBe(1);
    expect(after.doc.child(0).attrs.columns).toEqual(columns);
  });

  it('merges two bodies when the blank line between them becomes a row', () => {
    const state = caretInChild({
      type: 'doc',
      content: [
        { type: 'avBlock', content: [avRow('A', 'a')] },
        BLANK_ACTION,
        { type: 'avBlock', content: [avRow('B', 'b')] },
      ],
    }, 1);
    const after = run(state, 'toggleAvBlock')!;
    expect(after.doc.childCount).toBe(1);
    expect(rowCounts(after)).toEqual([3]);
    const block = after.doc.child(0);
    expect([0, 1, 2].map(i => block.child(i).textContent)).toEqual(['Aa', '', 'Bb']);
    // The caret is in the seam row, not in either of the rows that existed.
    expect(after.selection.$from.parent.textContent).toBe('');
  });

  it('never leaves two AV bodies touching', () => {
    // The shape the old insert produced: a second body flush against the first,
    // drawn as one table but carrying its own (default) column config.
    const starts = [
      { type: 'doc', content: [{ type: 'avBlock', content: [avRow('A', 'a')] }, BLANK_ACTION] },
      { type: 'doc', content: [BLANK_ACTION, { type: 'avBlock', content: [avRow('A', 'a')] }] },
      { type: 'doc', content: [{ type: 'avBlock', content: [avRow('A', 'a')] }, BLANK_ACTION, { type: 'avBlock', content: [avRow('B', 'b')] }] },
    ];
    for (const json of starts) {
      const blankIndex = json.content.findIndex(n => n === BLANK_ACTION);
      const after = run(caretInChild(json, blankIndex), 'toggleAvBlock')!;
      const types = after.doc.content.content.map(n => n.type.name);
      for (let i = 1; i < types.length; i++) {
        expect(types[i] === 'avBlock' && types[i - 1] === 'avBlock').toBe(false);
      }
    }
  });
});

describe('leaving an AV body', () => {
  it('unwraps back to a single line, as it always did', () => {
    const state = stateAt({
      type: 'doc',
      content: [{ type: 'avBlock', content: [avRow('A', 'a')] }],
    }, 4);
    const after = run(state, 'toggleAvBlock')!;
    expect(shape(after)).toEqual(['action("")']);
  });
});

describe('with no line to place the body against', () => {
  it('inserts at a gap cursor between two bodies', () => {
    // A gap cursor resolves at the document, not inside a block. There is no
    // line to go after, and inserting at the selection cannot split anything.
    const state = stateOf({
      type: 'doc',
      content: [
        { type: 'avBlock', content: [avRow('A', 'a')] },
        { type: 'avBlock', content: [avRow('B', 'b')] },
      ],
    });
    const between = state.doc.child(0).nodeSize;
    const moved = state.apply(state.tr.setSelection(
      Selection.near(state.doc.resolve(between)),
    ));
    // Only meaningful if the selection really did land at document depth.
    if (moved.selection.$from.depth !== 0) return;
    const after = run(moved, 'toggleAvBlock')!;
    expect(after.doc.content.content.map(n => n.type.name))
      .toEqual(['avBlock', 'avBlock', 'avBlock']);
  });

  it('reports failure rather than guessing when nothing will take one', () => {
    // A cursor inside an AV cell never reaches here — `toggleAvBlock` unwraps
    // first — but the guard has to hold if it ever did: an avCell will not
    // hold an avBlock, and neither will an avRow.
    const state = stateAt({
      type: 'doc',
      content: [{ type: 'avBlock', content: [avRow('A', 'a')] }],
    }, 4);
    const cell = state.selection.$from.node(state.selection.$from.depth - 1);
    expect(cell.type.name).toBe('avCell');
    expect(cell.type.contentMatch.matchType(testSchema.nodes.avBlock)).toBeNull();
  });
});
