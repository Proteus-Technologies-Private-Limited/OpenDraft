import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import { EditorState, type Plugin, type Transaction } from '@tiptap/pm/state';
import { history, undo, redo } from '@tiptap/pm/history';
import { testExtensions, doc, block } from '../test/screenplaySchema';
import {
  ElementNumbers,
  collectNumberedElements,
  elementNumbersPluginKey,
} from './extensions/ElementNumbers';
const schema = getSchema([...testExtensions, ElementNumbers]);
const opts = {
  getRules: () => ({ dialogue: { enabled: true, resetOn: [] } }),
  getSceneNumbersVisible: () => false,
};
function setup(imported = false) {
  const plugins = (
    ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]
  ).call({ options: opts } as never);
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(
      doc(block('dialogue', 'first'), block('dialogue', 'second')),
    ),
    plugins: [history(), ...plugins],
  });
  if (imported)
    state = state.apply(
      state.tr
        .setNodeAttribute(0, 'elementNumber', 'FX 12')
        .setNodeAttribute(0, 'elementNumberLocked', true)
        .setNodeAttribute(0, 'elementNumberId', 'original')
        .setMeta('preventUpdate', true),
    );
  const commands = ElementNumbers.config.addCommands!.call({
    options: opts,
  } as never) as Record<
    string,
    (...args: unknown[]) => (props: unknown) => boolean
  >;
  const dispatch = (tr: Transaction) => {
    state = state.applyTransaction(tr).state;
  };
  return {
    get state() {
      return state;
    },
    dispatch,
    run: (name: string, ...args: unknown[]) =>
      commands[name](...args)({ state, tr: state.tr, dispatch }),
  };
}
const refs = (s: EditorState) =>
  collectNumberedElements(s.doc).map((f) => f.node.attrs.elementNumber);
describe('stored production element references', () => {
  it('locks, inserts a suffix, preserves following references, and undoes/redoes the insertion', () => {
    const e = setup();
    expect(e.run('lockElementNumbers')).toBe(true);
    expect(refs(e.state)).toEqual(['1', '2']);
    e.dispatch(
      e.state.tr.insert(
        7,
        schema.nodes.dialogue.create(null, schema.text('inserted')),
      ),
    );
    expect(refs(e.state)).toEqual(['1', '1A', '2']);
    expect(undo(e.state, e.dispatch)).toBe(true);
    expect(e.state.doc.textContent).toBe('firstsecond');
    expect(redo(e.state, e.dispatch)).toBe(true);
    expect(refs(e.state)).toEqual(['1', '1A', '2']);
  });
  it('edits a reference without changing text and rejects duplicates', () => {
    const e = setup();
    e.run('lockElementNumbers');
    expect(e.run('setElementNumber', '12B', 0)).toBe(true);
    expect(e.run('setElementNumber', '12B', 7)).toBe(false);
    expect(refs(e.state)).toEqual(['12B', '2']);
    expect(e.state.doc.textContent).toBe('firstsecond');
  });
  it('unlocks to automatic counting while retaining serializable source metadata', () => {
    const e = setup(true);
    expect(e.run('unlockElementNumbers')).toBe(true);
    expect(
      collectNumberedElements(e.state.doc).every((f) => !f.item.numberLocked),
    ).toBe(true);
    const decorations = elementNumbersPluginKey.getState(e.state)!.find();
    expect(decorations).toHaveLength(2);
    expect(
      JSON.stringify(schema.nodeFromJSON(e.state.doc.toJSON()).toJSON()),
    ).toContain('FX 12');
  });
  it('does not duplicate a reference when the numbered paragraph is split', () => {
    const e = setup();
    e.run('lockElementNumbers');
    e.dispatch(e.state.tr.split(3));
    expect(refs(e.state)).toEqual(['1', '1A', '2']);
  });
});
