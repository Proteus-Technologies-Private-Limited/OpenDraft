/**
 * Getting out of an AV table.
 *
 * The AV Script template's starter document is a single `avBlock` and nothing
 * else, and every route out of a cell was a keystroke a soft keyboard does not
 * have — Tab, Mod-Enter. Tapping the page below the table does not help: that
 * area is `.page`, not `.ProseMirror`, so the tap never reaches the editor.
 * Opened on a phone, the format gave the writer a table they could fill and no
 * way to write a line anywhere else in their own script.
 *
 * `exitAvBlock` is the door. These tests hold down where it puts the caret,
 * that it reuses a blank line rather than stacking them, and — for the arrow
 * keys — that it stays out of the way of ordinary navigation.
 */
import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { testSchema } from '../test/screenplaySchema';
import { AvBlock as AvBlockExt } from './extensions';
import { avArrowExit } from './extensions/AvBlock';
import { AV_SCRIPT_TEMPLATE } from '../stores/templates/avScriptTemplate';

const commands = (AvBlockExt.config.addCommands as () => Record<
  string,
  (...a: never[]) => (p: {
    tr: unknown; dispatch: unknown; state: EditorState;
  }) => boolean
>).call({} as never);

const AV_ROW = {
  type: 'avRow',
  content: [
    { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara', content: [{ type: 'text', text: 'video' }] }] },
    { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara', content: [{ type: 'text', text: 'audio' }] }] },
  ],
};

/** A document made of the given top-level nodes, caret inside the AV cell. */
function docWith(nodes: unknown[]) {
  const doc = testSchema.nodeFromJSON({ type: 'doc', content: nodes });
  let state = EditorState.create({ doc, schema: testSchema });
  let at = -1;
  doc.descendants((node, pos) => {
    if (at < 0 && node.type.name === 'avPara' && node.textContent === 'video') at = pos + 1;
    return true;
  });
  if (at < 0) throw new Error('fixture has no AV cell');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, at)));
  return state;
}

const AV_ONLY = [{ type: 'avBlock', content: [AV_ROW] }];
const ACTION = (text: string) => ({ type: 'action', content: [{ type: 'text', text }] });
const BLANK_ACTION = { type: 'action' };

/** Run `exitAvBlock`, returning the new state or null when it declined. */
function runExit(state: EditorState, where: 'before' | 'after'): EditorState | null {
  let next: EditorState | null = null;
  const ok = commands.exitAvBlock(where as never)({
    tr: state.tr,
    state,
    dispatch: (tr: unknown) => { next = state.apply(tr as never); },
  });
  return ok ? next : null;
}

/** The top-level node names of a document, in order. */
function topLevel(state: EditorState): string[] {
  const names: string[] = [];
  state.doc.forEach((n) => { names.push(n.type.name); });
  return names;
}

describe('exitAvBlock', () => {
  it('adds a line after a table that is the whole document, and lands on it', () => {
    const state = docWith(AV_ONLY);
    const next = runExit(state, 'after');
    expect(next).not.toBeNull();
    expect(topLevel(next!)).toEqual(['avBlock', 'action']);
    // The caret is on the new line, outside the table.
    const { $from } = next!.selection;
    expect($from.parent.type.name).toBe('action');
    let inAv = false;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === 'avCell') inAv = true;
    }
    expect(inAv).toBe(false);
  });

  it('adds a line before the table when asked', () => {
    const state = docWith(AV_ONLY);
    const next = runExit(state, 'before');
    expect(next).not.toBeNull();
    expect(topLevel(next!)).toEqual(['action', 'avBlock']);
    expect(next!.selection.$from.parent.type.name).toBe('action');
  });

  it('reuses a blank line that is already there rather than stacking another', () => {
    const state = docWith([{ type: 'avBlock', content: [AV_ROW] }, BLANK_ACTION]);
    const next = runExit(state, 'after');
    expect(next).not.toBeNull();
    // Still one trailing line, not two.
    expect(topLevel(next!)).toEqual(['avBlock', 'action']);
    expect(next!.selection.$from.parent.type.name).toBe('action');
  });

  it('adds a line even when the neighbour has text, so the table is not merged into it', () => {
    const state = docWith([{ type: 'avBlock', content: [AV_ROW] }, ACTION('A street.')]);
    const next = runExit(state, 'after');
    expect(next).not.toBeNull();
    expect(topLevel(next!)).toEqual(['avBlock', 'action', 'action']);
    // The caret is on the NEW empty line, not in the writer's existing text.
    expect(next!.selection.$from.parent.textContent).toBe('');
  });

  it('declines outside an AV body', () => {
    const doc = testSchema.nodeFromJSON({ type: 'doc', content: [ACTION('A street.')] });
    let state = EditorState.create({ doc, schema: testSchema });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1)));
    expect(runExit(state, 'after')).toBeNull();
  });
});

/**
 * The arrow keys are the hardware-keyboard half of the same door, and the
 * thing they must NOT do is take a key that ordinary navigation needs. The
 * rule is narrow on purpose: only from the row on the edge being left, and
 * only when there is nothing on the far side of the table to move to.
 */
describe('arrow escape rule', () => {
  const TWO_ROWS = [{ type: 'avBlock', content: [AV_ROW, {
    type: 'avRow',
    content: [
      { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara', content: [{ type: 'text', text: 'second' }] }] },
      { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara' }] },
    ],
  }] }];

  /**
   * The real `avArrowExit`, with a stand-in editor that records whether it
   * reached `exitAvBlock`. Nothing about the gate is restated here — a test
   * that mirrored the rule would pass whatever the rule became.
   */
  function wouldExit(state: EditorState, where: 'before' | 'after'): boolean {
    let called = false;
    const editor = {
      state,
      commands: { exitAvBlock: () => { called = true; return true; } },
    };
    const took = avArrowExit(editor, where);
    // A handled key and a reached command are the same event here.
    expect(took).toBe(called);
    return called;
  }

  it('does not take Down from a row that has another row below it', () => {
    // Caret is in row ONE of two; Down means "row two", not "leave".
    expect(wouldExit(docWith(TWO_ROWS), 'after')).toBe(false);
  });

  it('takes Down from the last row when nothing follows the table', () => {
    expect(wouldExit(docWith(AV_ONLY), 'after')).toBe(true);
  });

  it('does not take Down when there is a line after the table to move into', () => {
    expect(wouldExit(docWith([{ type: 'avBlock', content: [AV_ROW] }, ACTION('A street.')]), 'after')).toBe(false);
  });

  it('takes Up from the first row when nothing precedes the table', () => {
    expect(wouldExit(docWith(AV_ONLY), 'before')).toBe(true);
  });

  it('does not take Up when there is a line before the table', () => {
    expect(wouldExit(docWith([ACTION('A street.'), { type: 'avBlock', content: [AV_ROW] }]), 'before')).toBe(false);
  });
});

/**
 * The AV Script template's own starting point.
 *
 * `exitAvBlock` covers every AV body in every document, but the one case it
 * should not take a menu to reach is the first: a writer who has just picked
 * the format. The starter was the avBlock alone, which on a phone is a
 * document with nowhere to write that is not a cell.
 */
describe('AV Script starter document', () => {
  it('parses, and holds a line outside the table', () => {
    const starter = AV_SCRIPT_TEMPLATE.starterDocument;
    expect(starter).toBeDefined();
    // Parsed through the real schema: a starter the document cannot hold is
    // worse than no starter at all.
    const doc = testSchema.nodeFromJSON({ type: 'doc', content: starter as never });
    const names: string[] = [];
    doc.forEach((n) => { names.push(n.type.name); });
    expect(names).toContain('avBlock');
    // At least one top-level node that is an ordinary script line.
    expect(names.some((n) => n !== 'avBlock')).toBe(true);
  });

  it('puts that line where a caret can reach it without leaving the document', () => {
    const doc = testSchema.nodeFromJSON({
      type: 'doc',
      content: AV_SCRIPT_TEMPLATE.starterDocument as never,
    });
    const last = doc.child(doc.childCount - 1);
    expect(last.type.name).not.toBe('avBlock');
    expect(last.isTextblock).toBe(true);
  });
});
