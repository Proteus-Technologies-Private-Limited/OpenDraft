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
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({
    options: opts,
  } as never);
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(doc(block('dialogue', 'first'), block('dialogue', 'second'))),
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
  } as never) as Record<string, (...args: unknown[]) => (props: unknown) => boolean>;
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
    e.dispatch(e.state.tr.insert(7, schema.nodes.dialogue.create(null, schema.text('inserted'))));
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
    expect(collectNumberedElements(e.state.doc).every((f) => !f.item.numberLocked)).toBe(true);
    const decorations = elementNumbersPluginKey.getState(e.state)!.find();
    expect(decorations).toHaveLength(2);
    expect(JSON.stringify(schema.nodeFromJSON(e.state.doc.toJSON()).toJSON())).toContain('FX 12');
  });
  it('does not duplicate a reference when the numbered paragraph is split', () => {
    const e = setup();
    e.run('lockElementNumbers');
    e.dispatch(e.state.tr.split(3));
    expect(refs(e.state)).toEqual(['1', '1A', '2']);
  });
});

it('does not repair or assign UUIDs in response to a remote Yjs insertion', () => {
  const e = setup();
  e.run('lockElementNumbers');
  const inserted = schema.nodes.dialogue.create(null, schema.text('remote'));
  const tr = e.state.tr.insert(7, inserted).setMeta('y-sync$', { isChangeOrigin: true });
  const result = e.state.applyTransaction(tr);
  expect(result.transactions).toHaveLength(1);
  expect(result.state.doc.child(1).attrs.elementNumberId).toBeNull();
  expect(result.state.doc.child(1).attrs.elementNumber).toBeNull();
  expect(refs(result.state)).toEqual(['1', null, '2']);
});

it('keeps sparse source references isolated when the format numbers nothing', () => {
  const json = doc(block('action', 'before'), block('action', 'source'), block('action', 'after'));
  json.content![1].attrs = {
    elementNumber: '12',
    elementNumberLocked: true,
    elementNumberId: 'source-id',
  };
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({
    options: { getRules: () => ({}), getSceneNumbersVisible: () => false },
  } as never);
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(json), plugins });
  expect(elementNumbersPluginKey.getState(state)!.find()).toHaveLength(1);
  const result = state.applyTransaction(state.tr.insertText('!', 1));
  expect(result.transactions).toHaveLength(1);
  expect(refs(result.state)).toEqual([null, '12', null]);
  expect(result.state.doc.child(0).attrs.elementNumberId).toBeNull();
  expect(result.state.doc.child(2).attrs.elementNumberId).toBeNull();
});

it('does not walk the document to repair ordinary unnumbered typing', async () => {
  const { vi } = await import('vitest');
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({
    options: { getRules: () => ({}), getSceneNumbersVisible: () => false },
  } as never);
  const state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(doc(...Array.from({ length: 2000 }, () => block('action', 'plain')))),
    plugins,
  });
  const spy = vi.spyOn(Object.getPrototypeOf(state.doc), 'descendants');
  try {
    const result = state.applyTransaction(state.tr.insertText('!', 1));
    expect(result.transactions).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it('recognises a newly added sparse reference from an attribute-only step', () => {
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({
    options: { getRules: () => ({}), getSceneNumbersVisible: () => false },
  } as never);
  let state = EditorState.create({
    schema,
    doc: schema.nodeFromJSON(doc(block('action', 'plain'))),
    plugins,
  });
  state = state.applyTransaction(state.tr.setNodeAttribute(0, 'elementNumber', 'A12')).state;
  const decorations = elementNumbersPluginKey.getState(state)!.find();
  expect(decorations).toHaveLength(1);
  expect(state.doc.child(0).attrs.elementNumber).toBe('A12');
});

it('does not lock a format sequence merely because another type has an imported reference', () => {
  const json = doc(block('action', 'source'), block('dialogue', 'one'), block('dialogue', 'two'));
  json.content![0].attrs = { elementNumber: 'A12', elementNumberLocked: true };
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({
    options: opts,
  } as never);
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(json), plugins });
  const result = state.applyTransaction(state.tr.insertText('!', 2));
  expect(result.transactions).toHaveLength(1);
  expect(refs(result.state)).toEqual(['A12', null, null]);
});

it('keeps Use Automatic Number through undo and redo', () => {
  const e = setup();
  e.run('lockElementNumbers');
  e.run('setElementNumber', '12', 0);
  e.run('setElementNumber', null, 0);
  expect(e.state.doc.child(0).attrs.elementNumber).toBeNull();
  expect(e.state.doc.child(0).attrs.elementNumberAutomatic).toBe(true);
  expect(undo(e.state, e.dispatch)).toBe(true);
  expect(redo(e.state, e.dispatch)).toBe(true);
  expect(e.state.doc.child(0).attrs.elementNumber).toBeNull();
  expect(e.state.doc.child(0).attrs.elementNumberAutomatic).toBe(true);
});

it('keeps a sparse imported reference on its original paragraph when split', () => {
  const json = doc(block('action', 'source words'));
  json.content![0].attrs = {
    elementNumber: '12',
    elementNumberLocked: true,
    elementNumberId: 'source',
  };
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({
    options: { getRules: () => ({}), getSceneNumbersVisible: () => false },
  } as never);
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(json), plugins });
  const next = state.applyTransaction(state.tr.split(7)).state;
  expect(refs(next)).toEqual(['12', null]);
  expect(next.doc.child(1).attrs.elementNumberId).toBeNull();
});

it('does not silently rewrite duplicate labels already present in the source', () => {
  const json = doc(block('dialogue', 'one'), block('dialogue', 'two'));
  json.content!.forEach((n, i) => {
    n.attrs = { elementNumber: '12', elementNumberLocked: true, elementNumberId: `original-${i}` };
  });
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({
    options: opts,
  } as never);
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON(json), plugins });
  const result = state.applyTransaction(state.tr.insertText('!', 1));
  expect(result.transactions).toHaveLength(1);
  expect(refs(result.state)).toEqual(['12', '12']);
});

it('locks and unlocks the active format without changing unrelated imported references', () => {
  const json = doc(block('action', 'source'), block('dialogue', 'one'), block('dialogue', 'two'));
  json.content![0].attrs = {
    elementNumber: 'A12',
    elementNumberLocked: true,
    elementNumberId: 'source-id',
  };
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({
    options: opts,
  } as never);
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(json), plugins });
  const sourceAttrs = { ...state.doc.child(0).attrs };
  const commands = ElementNumbers.config.addCommands!.call({ options: opts } as never) as Record<
    string,
    () => (props: unknown) => boolean
  >;
  const run = (name: string) =>
    commands[name]()({
      state,
      tr: state.tr,
      dispatch: (tr: Transaction) => {
        state = state.applyTransaction(tr).state;
      },
    });
  expect(run('lockElementNumbers')).toBe(true);
  expect(refs(state)).toEqual(['A12', '1', '2']);
  expect(run('unlockElementNumbers')).toBe(true);
  expect(state.doc.child(0).attrs).toEqual(sourceAttrs);
  expect(state.doc.child(1).attrs.elementNumberLocked).toBe(false);
});

function sparseEditor() {
  const options = { getRules: () => ({}), getSceneNumbersVisible: () => false };
  const json = doc(block('action', 'before'), block('action', 'source'), block('action', 'after'));
  json.content![1].attrs = { elementNumber: '12', elementNumberLocked: false, elementNumberId: 'imported' };
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({ options } as never);
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON(json), plugins });
  const commands = ElementNumbers.config.addCommands!.call({ options } as never) as Record<string, (...args: unknown[]) => (props: unknown) => boolean>;
  return {
    get state() { return state; },
    run(name: string, ...args: unknown[]) {
      return commands[name](...args)({ state, tr: state.tr, dispatch: (tr: Transaction) => { state = state.applyTransaction(tr).state; } });
    },
  };
}

it('locks, edits and unlocks sparse imported references without enabling a sequence', () => {
  const e = sparseEditor();
  expect(e.run('lockElementNumbers')).toBe(true);
  expect(refs(e.state)).toEqual([null, '12', null]);
  expect(e.state.doc.child(1).attrs.elementNumberLocked).toBe(true);
  expect(e.run('setElementNumber', '12A', 8)).toBe(true);
  expect(refs(e.state)).toEqual([null, '12A', null]);
  expect(e.run('unlockElementNumbers')).toBe(true);
  expect(e.state.doc.child(1).attrs.elementNumberLocked).toBe(false);
  expect(elementNumbersPluginKey.getState(e.state)!.find()).toHaveLength(1);
  expect(e.state.doc.child(0).attrs.elementNumberId).toBeNull();
  expect(e.state.doc.child(2).attrs.elementNumberId).toBeNull();
});

it('confirms concurrent local suffix allocation needs explicit resolution after Yjs merging', async () => {
  const Y = await import('yjs');
  const { prosemirrorJSONToYDoc, yDocToProsemirrorJSON, updateYFragment } = await import('y-prosemirror');
  const base = setup();
  base.run('lockElementNumbers');
  const shared = prosemirrorJSONToYDoc(schema, base.state.doc.toJSON(), 'default');
  const peers = ['Ann', 'Ben'].map((name) => {
    const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({ options: opts } as never);
    const state = EditorState.create({ schema, doc: base.state.doc, plugins });
    const local = state.applyTransaction(state.tr.insert(7, schema.nodes.dialogue.create(null, schema.text(name)))).state;
    expect(refs(local)).toEqual(['1', '1A', '2']);
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(shared));
    updateYFragment(peer, peer.getXmlFragment('default'), local.doc, { mapping: new Map(), isOMark: new Map() });
    return peer;
  });
  for (const peer of peers) Y.applyUpdate(shared, Y.encodeStateAsUpdate(peer));
  const merged = schema.nodeFromJSON(yDocToProsemirrorJSON(shared, 'default'));
  const labels = collectNumberedElements(merged).map(f => f.item.number);
  expect(labels).toEqual(['1', '1A', '1A', '2']);
  expect(new Set(collectNumberedElements(merged).map(f => f.node.attrs.elementNumberId)).size).toBe(4);
  expect(merged.textContent).toContain('Ann');
  expect(merged.textContent).toContain('Ben');
  const plugins = (ElementNumbers.config.addProseMirrorPlugins as () => Plugin[]).call({ options: opts } as never);
  const state = EditorState.create({ schema, doc: base.state.doc, plugins });
  const remote = state.applyTransaction(state.tr.replaceWith(0, state.doc.content.size, merged.content).setMeta('y-sync$', { isChangeOrigin: true }));
  expect(remote.transactions).toHaveLength(1);
  expect(refs(remote.state)).toEqual(labels);
  const subsequent = remote.state.applyTransaction(remote.state.tr.insertText('!', 1));
  expect(refs(subsequent.state)).toEqual(labels);
  for (const peer of peers) peer.destroy();
  shared.destroy();
});
