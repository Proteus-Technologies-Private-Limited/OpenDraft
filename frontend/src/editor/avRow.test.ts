/**
 * AV row commands — the implementation behind every route to "add a row".
 *
 * Until issue #116 the only callers were keyboard shortcuts (Tab, Mod-Enter),
 * so the commands were only ever exercised through keys an iPhone or iPad does
 * not have. The toolbar, context menu, Format menu and element picker now call
 * them directly, which makes the position math below load-bearing for touch as
 * well: a new row has to land on the right side of the current one and leave
 * the caret in its left (video) cell, or the writer's next keystroke goes
 * somewhere they did not tap.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import { testSchema } from '../test/screenplaySchema';
import { AvBlock, AvKeymap, avRowContext, isInAvCell } from './extensions/AvBlock';

/** One avRow whose two cells carry the given text, optionally with a
 *  storyboard frame in the third column. */
const row = (video: string, audio: string, frame?: Record<string, unknown> | 'empty') => ({
  type: 'avRow',
  content: [
    { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara', content: video ? [{ type: 'text', text: video }] : [] }] },
    { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara', content: audio ? [{ type: 'text', text: audio }] : [] }] },
    ...(frame ? [{ type: 'avImage', attrs: frame === 'empty' ? {} : frame }] : []),
  ],
});

const docWithRows = (...rows: ReturnType<typeof row>[]) =>
  testSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'avBlock', content: rows }] });

/**
 * The commands are plain functions on the node's `addCommands()` — no editor
 * instance, so no DOM, so they run in the same node environment as the rest of
 * the suite. Only `tr`, `state` and `dispatch` are read.
 */
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

/** A state whose caret sits inside the nth cell paragraph of the nth row. */
function stateAt(doc: PmNode, rowIndex: number, side: 'video' | 'audio'): EditorState {
  let pos = -1;
  let seen = -1;
  doc.descendants((node, p) => {
    if (node.type.name !== 'avRow') return true;
    seen += 1;
    if (seen !== rowIndex) return false;
    // +1 into the row, then the video cell, then its first paragraph.
    let cellPos = p + 1;
    if (side === 'audio') cellPos += node.child(0).nodeSize;
    pos = cellPos + 2;
    return false;
  });
  if (pos < 0) throw new Error(`no row ${rowIndex}`);
  return EditorState.create({ doc, selection: TextSelection.create(doc, pos) });
}

/** Every row's [video, audio] text, top to bottom. */
function rowTexts(doc: PmNode): [string, string][] {
  const out: [string, string][] = [];
  doc.descendants((node) => {
    if (node.type.name !== 'avRow') return true;
    out.push([node.child(0).textContent, node.child(1).textContent]);
    return false;
  });
  return out;
}

/** The row index the caret is in, or -1. */
function caretRow(state: EditorState): number {
  const ctx = avRowContext(state);
  if (!ctx) return -1;
  const rowStart = state.selection.$from.before(ctx.rowDepth);
  return rowTexts(state.doc).findIndex((_, i) => {
    let pos = -1;
    let seen = -1;
    state.doc.descendants((node, p) => {
      if (node.type.name !== 'avRow') return true;
      seen += 1;
      if (seen === i) pos = p;
      return false;
    });
    return pos === rowStart;
  });
}

describe('avRowContext / isInAvCell', () => {
  it('finds the row and block around a caret in a cell', () => {
    const state = stateAt(docWithRows(row('WIDE', 'V.O.')), 0, 'audio');
    const ctx = avRowContext(state)!;
    expect(ctx).not.toBeNull();
    expect(state.selection.$from.node(ctx.rowDepth).type.name).toBe('avRow');
    expect(state.selection.$from.node(ctx.blockDepth).type.name).toBe('avBlock');
    expect(isInAvCell(state)).toBe(true);
  });

  it('reports nothing outside an AV body', () => {
    const doc = testSchema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'action', content: [{ type: 'text', text: 'Not AV.' }] }],
    });
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
    expect(avRowContext(state)).toBeNull();
    expect(isInAvCell(state)).toBe(false);
  });
});

describe('insertAvRow', () => {
  it('adds an empty row below the caret’s row by default', () => {
    const state = stateAt(docWithRows(row('ONE', 'one'), row('TWO', 'two')), 0, 'audio');
    const next = run(state, 'insertAvRow')!;
    expect(rowTexts(next.doc)).toEqual([['ONE', 'one'], ['', ''], ['TWO', 'two']]);
  });

  it('adds a row above when asked', () => {
    const state = stateAt(docWithRows(row('ONE', 'one'), row('TWO', 'two')), 1, 'video');
    const next = run(state, 'insertAvRow', 'above')!;
    expect(rowTexts(next.doc)).toEqual([['ONE', 'one'], ['', ''], ['TWO', 'two']]);
  });

  it('leaves the caret in the new row’s video cell, either way', () => {
    for (const [where, expected] of [['below', 1], ['above', 0]] as const) {
      const state = stateAt(docWithRows(row('ONE', 'one'), row('TWO', 'two')), 0, 'audio');
      const next = run(state, 'insertAvRow', where)!;
      expect(caretRow(next)).toBe(expected);
      const { $from } = next.selection;
      expect($from.parent.type.name).toBe('avPara');
      expect($from.node($from.depth - 1).attrs.side).toBe('video');
      expect($from.parent.textContent).toBe('');
    }
  });

  it('keeps working from the video cell, not just the audio one', () => {
    // Tab only ever reached this command from the audio cell; the toolbar
    // button can be tapped with the caret anywhere in the row.
    const state = stateAt(docWithRows(row('ONE', 'one')), 0, 'video');
    const next = run(state, 'insertAvRow')!;
    expect(rowTexts(next.doc)).toEqual([['ONE', 'one'], ['', '']]);
  });

  it('wraps a fresh avBlock when the caret is outside one', () => {
    // The route Mod-Shift-A takes. None of the touch controls can reach it —
    // they only appear inside an AV cell — but the command has to stay honest.
    const doc = testSchema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'action', content: [{ type: 'text', text: 'Intro.' }] }],
    });
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 8) });
    const next = run(state, 'insertAvRow')!;
    const blocks: PmNode[] = [];
    next.doc.descendants((n) => { if (n.type.name === 'avBlock') blocks.push(n); return true; });
    expect(blocks).toHaveLength(1);
    expect(rowTexts(next.doc)).toEqual([['', '']]);
  });
});

describe('deleteAvRow', () => {
  it('removes just the caret’s row when others remain', () => {
    const state = stateAt(docWithRows(row('ONE', 'one'), row('TWO', 'two')), 0, 'video');
    const next = run(state, 'deleteAvRow')!;
    expect(rowTexts(next.doc)).toEqual([['TWO', 'two']]);
  });

  it('removes the whole block with the last row', () => {
    const state = stateAt(docWithRows(row('ONE', 'one')), 0, 'audio');
    const next = run(state, 'deleteAvRow')!;
    expect(rowTexts(next.doc)).toEqual([]);
    let anyBlock = false;
    next.doc.descendants((n) => { if (n.type.name === 'avBlock') anyBlock = true; return true; });
    expect(anyBlock).toBe(false);
  });

  it('declines outside an AV body', () => {
    const doc = testSchema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'action', content: [{ type: 'text', text: 'Not AV.' }] }],
    });
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) });
    expect(run(state, 'deleteAvRow')).toBeNull();
  });
});

describe('creating a fresh AV body', () => {
  /**
   * The caret has to land in the VIDEO cell. It used to be left wherever
   * `replaceSelectionWith` put it, which resolved into the AUDIO cell — so the
   * first thing typed after creating an AV body went into the wrong column,
   * and Tab then (correctly, from the right-hand cell) opened a second row.
   */
  it('leaves the caret in the new row’s video cell, not the audio one', () => {
    const doc = testSchema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'action' }],
    });
    const base = EditorState.create({ doc, schema: testSchema });
    const next = run(base, 'insertAvRow');
    expect(next).not.toBeNull();

    // Walk up from the caret to the enclosing cell and read its side.
    const $from = next!.selection.$from;
    let side: string | null = null;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === 'avCell') { side = $from.node(d).attrs.side as string; break; }
    }
    expect(side).toBe('video');
  });
});

describe('toggleAvBlock', () => {
  /**
   * It used to fall back to `editor.commands.insertAvRow()`, which dispatched a
   * SECOND transaction built from the pre-insert state while the outer command
   * dispatched its own. ProseMirror rejected the pair — "Applying a mismatched
   * transaction" — on every Mod-Shift-A, visible only in the console.
   */
  it('wraps a new AV body using the caller’s transaction, not a second one', () => {
    const doc = testSchema.nodeFromJSON({ type: 'doc', content: [{ type: 'action' }] });
    const base = EditorState.create({ doc, schema: testSchema });

    let dispatched = 0;
    let produced: Transaction | null = null;
    const ok = avCommands.toggleAvBlock()({
      tr: base.tr,
      state: base,
      // A real editor is deliberately absent: if the command reaches for
      // editor.commands it throws, which is the regression.
      editor: null,
      dispatch: (tr: Transaction) => { dispatched++; produced = tr; },
    } as never);

    expect(ok).toBe(true);
    expect(dispatched).toBe(1);
    const next = base.apply(produced!);
    let hasBlock = false;
    next.doc.descendants(n => { if (n.type.name === 'avBlock') hasBlock = true; return !hasBlock; });
    expect(hasBlock).toBe(true);
  });
});

describe('Backspace in an empty AV cell', () => {
  const keymap = (AvKeymap.config.addKeyboardShortcuts as () => Record<string, (p: unknown) => boolean>).call(
    { name: 'avKeymap', options: {}, storage: {}, editor: null } as never,
  );

  /** Run the Backspace handler over a caret position; reports whether it
   *  handled the key and whether it asked for the row to be deleted. */
  function backspace(doc: PmNode, rowIndex: number, side: 'video' | 'audio') {
    const state = stateAt(doc, rowIndex, side);
    let deleted = false;
    const handled = keymap.Backspace({
      editor: { state, commands: { deleteAvRow: () => { deleted = true; return true; } } },
    } as never);
    return { handled, deleted };
  }

  it('deletes a row whose cells are both empty', () => {
    expect(backspace(docWithRows(row('WIDE', 'V.O.'), row('', '')), 1, 'video').deleted).toBe(true);
  });

  it('leaves a row alone when the other cell still has content', () => {
    expect(backspace(docWithRows(row('', 'NARRATOR (V.O.): Hello')), 0, 'video').deleted).toBe(false);
    expect(backspace(docWithRows(row('WIDE ON STREET', '')), 0, 'audio').deleted).toBe(false);
  });

  it('still sees the other cell’s content when the row has a storyboard frame', () => {
    // avImage is an atom whose textContent is '' and it is always the row's
    // last child, so a handler that assigned rather than accumulated read the
    // row as empty and took the narration with it.
    const withFrame = docWithRows(row('', 'NARRATOR (V.O.): Hello', { assetId: 'a1', projectId: 'p1' }));
    expect(backspace(withFrame, 0, 'video').deleted).toBe(false);

    const audioSide = docWithRows(row('WIDE ON STREET', '', { assetId: 'a1', projectId: 'p1' }));
    expect(backspace(audioSide, 0, 'audio').deleted).toBe(false);
  });

  it('will not silently drop a frame from an otherwise empty row', () => {
    const doc = docWithRows(row('WIDE', 'V.O.'), row('', '', { assetId: 'a1', projectId: 'p1' }));
    expect(backspace(doc, 1, 'video').deleted).toBe(false);
  });

  it('deletes an empty row whose frame slot is also empty', () => {
    // An empty slot is not content — it is just the column being switched on.
    const doc = docWithRows(row('WIDE', 'V.O.'), row('', '', 'empty'));
    expect(backspace(doc, 1, 'video').deleted).toBe(true);
  });

  it('does nothing when the caret is not at the start of the cell', () => {
    const doc = docWithRows(row('WIDE', 'V.O.'));
    const state = stateAt(doc, 0, 'video');
    const moved = EditorState.create({ doc, selection: TextSelection.create(doc, state.selection.from + 2) });
    let deleted = false;
    const handled = keymap.Backspace({
      editor: { state: moved, commands: { deleteAvRow: () => { deleted = true; return true; } } },
    } as never);
    expect(handled).toBe(false);
    expect(deleted).toBe(false);
  });
});
