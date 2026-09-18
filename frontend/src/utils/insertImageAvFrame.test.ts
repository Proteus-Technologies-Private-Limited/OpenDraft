/**
 * An image inserted, pasted or dropped inside an AV row.
 *
 * `screenplayImage` is not in `AV_CELL_CONTENT`. Inserting one at a position
 * inside a cell asked ProseMirror to make room for a node the cell cannot hold,
 * and it did so by splitting the avBlock: a two-row table grew a third, empty
 * row belonging to a SECOND table with its own column widths, and the picture
 * itself appeared nowhere. Observed on Android, but the split is schema
 * arithmetic — nothing about it is platform-specific.
 *
 * An image in an AV row means a storyboard frame, so that is what it becomes.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { testSchema } from '../test/screenplaySchema';
import { insertImageNode } from './insertImage';

/** A two-row AV table, the shape the bug was found in. */
function avDoc() {
  return testSchema.nodeFromJSON({
    type: 'doc',
    content: [{
      type: 'avBlock',
      content: [1, 2].map((n) => ({
        type: 'avRow',
        content: [
          { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara', content: [{ type: 'text', text: `video ${n}` }] }] },
          { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara', content: [{ type: 'text', text: `audio ${n}` }] }] },
        ],
      })),
    }],
  });
}

/** A plain screenplay, to prove the ordinary path is untouched. */
function actionDoc() {
  return testSchema.nodeFromJSON({
    type: 'doc',
    content: [{ type: 'action', content: [{ type: 'text', text: 'A street at night.' }] }],
  });
}

const ATTRS = {
  src: null, assetId: 'asset-1', projectId: 'proj-1', scratchId: null,
  filename: 'frame.png', align: 'center',
};

/**
 * Enough of a Tiptap editor for `insertImageNode`.
 *
 * `screenplayImage` is absent from the shared test schema (it drags in
 * `services/api`), and `insertImageNode` bails without it — so the node type is
 * stubbed onto the schema view the function reads. The chain is recorded rather
 * than run: whether `setAvRowImage` is reached, and with what, is the behaviour
 * under test.
 */
function fakeEditor(doc: ReturnType<typeof avDoc>, at: number) {
  let state = EditorState.create({ doc, schema: testSchema });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
  const calls: { op: string; arg?: unknown }[] = [];
  const dispatched: unknown[] = [];

  const chain: Record<string, (...a: unknown[]) => unknown> = {
    focus: () => chain,
    setAvRowImage: (arg?: unknown) => { calls.push({ op: 'setAvRowImage', arg }); return chain; },
    run: () => { calls.push({ op: 'run' }); return true; },
  };

  const editor = {
    get state() { return state; },
    schema: {
      nodes: { ...testSchema.nodes, screenplayImage: testSchema.nodes.avImage },
    },
    chain: () => chain,
    view: {
      dispatch: (tr: { docChanged: boolean }) => {
        dispatched.push(tr);
        state = state.apply(tr as never);
      },
      focus: () => {},
    },
  } as unknown as Parameters<typeof insertImageNode>[0];

  return { editor, calls, dispatched, at, docNow: () => state.doc };
}

/** A position inside the second row's video cell. */
function posInSecondRowVideoCell(doc: ReturnType<typeof avDoc>): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === 'avPara' && node.textContent === 'video 2') found = pos + 1;
    return true;
  });
  if (found < 0) throw new Error('fixture lost its second row');
  return found;
}

describe('insertImageNode inside an AV row', () => {
  it('becomes the row storyboard frame rather than splitting the table', () => {
    const doc = avDoc();
    const at = posInSecondRowVideoCell(doc);
    const { editor, calls, docNow } = fakeEditor(doc, at);

    insertImageNode(editor, ATTRS, at);

    expect(calls.map((c) => c.op)).toEqual(['setAvRowImage', 'run']);
    // The document still holds exactly one AV table with exactly two rows.
    let blocks = 0;
    let rows = 0;
    docNow().descendants((node) => {
      if (node.type.name === 'avBlock') blocks++;
      if (node.type.name === 'avRow') rows++;
      return true;
    });
    expect(blocks).toBe(1);
    expect(rows).toBe(2);
  });

  it('carries every source field across, and leaves the aspect ratio alone', () => {
    const doc = avDoc();
    const at = posInSecondRowVideoCell(doc);
    const { editor, calls } = fakeEditor(doc, at);

    insertImageNode(editor, ATTRS, at);

    const arg = calls[0].arg as Record<string, unknown>;
    expect(arg).toMatchObject({
      src: null, assetId: 'asset-1', projectId: 'proj-1', scratchId: null,
      filename: 'frame.png', alt: 'frame.png',
    });
    // An existing frame keeps the ratio it was given — the same contract the
    // menu's Add / Replace Frame honours.
    expect(arg).not.toHaveProperty('aspect');
  });

  it('selects the targeted row, not wherever the caret happened to be', () => {
    const doc = avDoc();
    const at = posInSecondRowVideoCell(doc);
    // The fake editor starts with the selection at the top of the document, in
    // row one. A drop carries coordinates of its own, and the frame has to
    // follow them.
    const { editor, dispatched } = fakeEditor(doc, at);

    insertImageNode(editor, ATTRS, at);

    expect(dispatched.length).toBeGreaterThan(0);
    const sel = (dispatched[0] as { selection: { from: number } }).selection;
    expect(sel.from).toBeGreaterThanOrEqual(at - 1);
  });

  it('leaves an ordinary screenplay on the normal insert path', () => {
    const doc = actionDoc();
    const { editor, calls, dispatched } = fakeEditor(doc as never, 2);

    insertImageNode(editor, ATTRS, 2);

    // The frame command is never reached, and the ordinary insert ran instead.
    // What that insert PRODUCES is not asserted here: `screenplayImage` is
    // stood in for by `avImage`, which the schema will not seat at top level,
    // so the resulting node would be testing the stub rather than the code.
    expect(calls).toEqual([]);
    expect(dispatched.length).toBe(1);
  });
});
