/**
 * Plugin document data in a collaboration session. As in collabSync.test.ts:
 * two copies of the shared document, one bound to the stores through
 * collabSync (this writer) and one written to directly (a collaborator), with
 * updates exchanged by hand.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { startCollabSync, stopCollabSync } from './collabSync';
import { useEditorStore } from '../stores/editorStore';
import { usePluginDataStore } from '../stores/pluginDataStore';

let mine: Y.Doc;
let peer: Y.Doc;

function exchange() {
  const toPeer = Y.encodeStateAsUpdate(mine, Y.encodeStateVector(peer));
  const toMine = Y.encodeStateAsUpdate(peer, Y.encodeStateVector(mine));
  Y.applyUpdate(peer, toPeer, 'remote');
  Y.applyUpdate(mine, toMine, 'remote');
}

const store = () => usePluginDataStore.getState().data;
const setEntry = (id: string, value: unknown) => usePluginDataStore.getState().setEntry(id, value);
const peerPlugins = () => peer.getMap<string>('pluginData');
const peerLegacy = () => JSON.parse(peer.getMap<string>('metadata').get('pluginData') ?? 'null');
/** A collaborator on an older version: every plugin's data as one value. */
const olderPeerWrites = (data: Record<string, unknown>) =>
  peer.getMap<string>('metadata').set('pluginData', JSON.stringify(data));

beforeEach(() => {
  mine = new Y.Doc();
  peer = new Y.Doc();
  mine.clientID = 1;
  peer.clientID = 2;
  useEditorStore.setState({ notes: [], generalNotes: [] });
  usePluginDataStore.setState({ data: {} });
});

afterEach(() => {
  stopCollabSync();
});

describe('collaborating on plugin data', () => {
  it('keeps both when two people change different plugins at once', () => {
    usePluginDataStore.getState().setAll({ shared: { v: 0 } });
    startCollabSync(mine, true);
    exchange();

    setEntry('mine', { v: 1 });
    peerPlugins().set('theirs', JSON.stringify({ v: 2 }));
    exchange();
    exchange();

    expect(store()).toEqual({ shared: { v: 0 }, mine: { v: 1 }, theirs: { v: 2 } });
    expect(JSON.parse(peerPlugins().get('mine')!)).toEqual({ v: 1 });
    expect(JSON.parse(peerPlugins().get('theirs')!)).toEqual({ v: 2 });
  });

  it('writes only the plugin that changed', () => {
    usePluginDataStore.getState().setAll({ a: { v: 1 }, b: { v: 1 } });
    startCollabSync(mine, true);
    exchange();
    const changedKeys: string[] = [];
    peerPlugins().observe((e) => changedKeys.push(...e.keysChanged));
    setEntry('a', { v: 2 });
    exchange();
    expect(changedKeys).toEqual(['a']);
    expect(JSON.parse(peerPlugins().get('b')!)).toEqual({ v: 1 });
  });

  it('removes a plugin’s entry for everyone', () => {
    usePluginDataStore.getState().setAll({ a: 1, b: 2 });
    startCollabSync(mine, true);
    exchange();
    peerPlugins().delete('a');
    exchange();
    expect(store()).toEqual({ b: 2 });
    setEntry('b', undefined);
    exchange();
    expect(peerPlugins().size).toBe(0);
  });

  it('writes no plugin data when only the script metadata changes', () => {
    usePluginDataStore.getState().setAll({ a: 1 });
    startCollabSync(mine, true);
    exchange();
    let pluginWrites = 0;
    mine.getMap('pluginData').observe(() => { pluginWrites++; });
    useEditorStore.getState().setTags([]);
    useEditorStore.getState().addGeneralNote({ title: 'T', content: 'c', color: 'Blue' });
    expect(pluginWrites).toBe(0);
  });

  it('keeps the all-plugins value current for older versions', () => {
    startCollabSync(mine, true);
    exchange();
    setEntry('a', { v: 1 });
    setEntry('b', ['x']);
    exchange();
    expect(peerLegacy()).toEqual({ a: { v: 1 }, b: ['x'] });
  });

  it('takes, by plugin, what an older version changes', () => {
    usePluginDataStore.getState().setAll({ a: 1 });
    startCollabSync(mine, true);
    exchange();

    olderPeerWrites({ a: 1, b: 2 });
    exchange();
    expect(store()).toEqual({ a: 1, b: 2 });
    // Passed on by plugin for this version's collaborators.
    exchange();
    expect(peerPlugins().get('b')).toBe('2');

    setEntry('a', 3);
    exchange();
    expect(peerLegacy()).toEqual({ a: 3, b: 2 });

    olderPeerWrites({ a: 3 });
    exchange();
    expect(store()).toEqual({ a: 3 });
    exchange();
    expect(peerPlugins().has('b')).toBe(false);
  });

  it('a guest takes a newer host’s data by plugin', () => {
    peerPlugins().set('a', '{"v":1}');
    peerPlugins().set('b', '"two"');
    peer.getMap<string>('metadata').set('pluginData', '{"a":{"v":1},"b":"two"}');
    exchange();
    usePluginDataStore.getState().setAll({ local: true });
    startCollabSync(mine, false);
    expect(store()).toEqual({ a: { v: 1 }, b: 'two' });
  });

  it('a guest takes an older host’s data whole, and shares it by plugin', () => {
    olderPeerWrites({ x: { n: 1 } });
    exchange();
    startCollabSync(mine, false);
    expect(store()).toEqual({ x: { n: 1 } });
    exchange();
    expect(peerPlugins().get('x')).toBe('{"n":1}');

    // A later change by this guest does not drop what came from the host.
    setEntry('y', 2);
    exchange();
    expect([...peerPlugins().keys()].sort()).toEqual(['x', 'y']);
  });

  it('keeps this copy’s entry when a collaborator’s is unreadable', () => {
    usePluginDataStore.getState().setAll({ a: 1 });
    startCollabSync(mine, true);
    exchange();
    peerPlugins().set('a', '{not json');
    exchange();
    expect(store()).toEqual({ a: 1 });
  });
});
