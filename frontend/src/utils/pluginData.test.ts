/**
 * Plugin document data: a plugin's JSON kept in the script survives saving,
 * reopening, .odraft, FDX and Fountain, and an entry is never lost because
 * its plugin is missing.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import { PluginRegistry } from '../plugins/registry';
import { usePluginDataStore } from '../stores/pluginDataStore';
import {
  extractFountainPluginData,
  normalizePluginData,
  pluginDataFountainBlock,
  readFdxPluginData,
  toStorableEntry,
  MAX_PLUGIN_DATA_BYTES,
} from './pluginData';
import { exportFDX } from './fdxExporter';
import { exportFountain } from './fountainExporter';
import { parseScreenplayImport } from './importScreenplay';
import { hydrateEditorStoresFromContent } from './hydrateStores';
import { SAVE_METADATA_KEYS, stripSaveMetadata } from './saveContent';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDOMParser;
  }
});

beforeEach(() => {
  usePluginDataStore.getState().setAll({});
});

const doc = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. KITCHEN - NIGHT' }] },
    { type: 'action', content: [{ type: 'text', text: 'Anna waits.' }] },
  ],
};

/** Awkward on purpose: XML specials, a boneyard closer, quotes, unicode, nesting. */
const tricky = {
  tasks: [
    { id: 't1', subject: 'Fix <b>this</b> & "that"', note: 'ends with */ and /* opens', done: false },
    { id: 't2', subject: 'Café — naïve ✓', excerpt: { type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }] }] } },
  ],
  version: 1,
};

describe('registry document data', () => {
  it('stores a JSON copy under the plugin id and tells listeners', () => {
    const registry = new PluginRegistry();
    const heard = vi.fn();
    const stop = registry.subscribeDocumentData(heard);
    const value = { items: [1, 2] };
    registry.setDocumentData('sidekick', value);
    value.items.push(3);
    expect(registry.getDocumentData('sidekick')).toEqual({ items: [1, 2] });
    expect(heard).toHaveBeenCalledTimes(1);
    registry.setDocumentData('sidekick', undefined);
    expect(registry.getDocumentData('sidekick')).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it('leaves other plugins\' entries alone', () => {
    const registry = new PluginRegistry();
    usePluginDataStore.getState().setAll({ 'not-installed': { kept: true } });
    registry.setDocumentData('sidekick', { a: 1 });
    expect(usePluginDataStore.getState().data).toEqual({ 'not-installed': { kept: true }, sidekick: { a: 1 } });
  });

  it('refuses values that are not JSON or too large, with a message', () => {
    const registry = new PluginRegistry();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => registry.setDocumentData('p', cyclic)).toThrow(/cannot be saved/);
    expect(() => registry.setDocumentData('p', () => 1)).toThrow(/not JSON/);
    expect(() => toStorableEntry('p', 'x'.repeat(MAX_PLUGIN_DATA_BYTES + 1))).toThrow(/too large/);
    expect(registry.getDocumentData('p')).toBeUndefined();
  });
});

describe('normalizePluginData', () => {
  it('accepts an object or its JSON string and nothing else', () => {
    expect(normalizePluginData({ a: 1 })).toEqual({ a: 1 });
    expect(normalizePluginData('{"a":{"b":2}}')).toEqual({ a: { b: 2 } });
    expect(normalizePluginData(undefined)).toEqual({});
    expect(normalizePluginData([1])).toEqual({});
    expect(normalizePluginData(42)).toEqual({});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizePluginData('{not json')).toEqual({});
    warn.mockRestore();
  });
});

describe('saved payload', () => {
  it('separates _pluginData from the document', () => {
    expect(SAVE_METADATA_KEYS).toContain('_pluginData');
    const { pmDoc, metadata } = stripSaveMetadata({ ...doc, _pluginData: { sidekick: tricky } });
    expect(pmDoc).toEqual(doc);
    expect(metadata._pluginData).toEqual({ sidekick: tricky });
  });

  it('restores it when an .odraft-style payload is opened, and clears it for one without', () => {
    hydrateEditorStoresFromContent({ ...doc, _notes: [], _pluginData: { sidekick: tricky } });
    expect(usePluginDataStore.getState().data).toEqual({ sidekick: tricky });
    hydrateEditorStoresFromContent({ ...doc, _notes: [] });
    expect(usePluginDataStore.getState().data).toEqual({});
  });
});

describe('FDX', () => {
  // parseFDXFull is built on querySelector, which this suite's XML parser
  // lacks (see lineSpacing.test.ts), so the reader it calls is used directly.
  const readBack = (xml: string) => readFdxPluginData(new XmlDOMParser().parseFromString(xml, 'text/xml') as unknown as Document);

  it('round-trips every plugin\'s data exactly', () => {
    const data = { sidekick: tricky, other: [1, 'two', null] };
    const xml = exportFDX(doc, 'T', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { pluginData: data });
    expect(xml).toContain('<OpenDraftPluginData>');
    expect(xml.indexOf('<OpenDraftPluginData>')).toBeGreaterThan(xml.indexOf('</Content>'));
    expect(readBack(xml)).toEqual(data);
  });

  it('writes nothing when there is no plugin data, and reads none from other apps\' files', () => {
    const xml = exportFDX(doc, 'T');
    expect(xml).not.toContain('OpenDraftPluginData');
    expect(readBack(xml)).toEqual({});
  });

  it('skips one plugin\'s unreadable entry without losing the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const xml = '<FinalDraft><OpenDraftPluginData><Plugin Id="bad">{oops</Plugin><Plugin Id="good">[1]</Plugin></OpenDraftPluginData></FinalDraft>';
    expect(readBack(xml)).toEqual({ good: [1] });
    warn.mockRestore();
  });
});

describe('Fountain', () => {
  it('round-trips the data in a boneyard block, leaving the script as it was', async () => {
    const plain = exportFountain(doc);
    const withData = exportFountain(doc, { pluginData: { sidekick: tricky } });
    expect(withData.startsWith(plain)).toBe(true);
    expect(withData).toContain('/* OpenDraft plugin data');

    const imported = await parseScreenplayImport('draft.fountain', withData);
    expect(usePluginDataStore.getState().data).toEqual({ sidekick: tricky });
    expect(imported.metadata?._pluginData).toEqual({ sidekick: tricky });
    const plainImport = await parseScreenplayImport('plain.fountain', plain);
    expect(plainImport.doc).toEqual(imported.doc);
  });

  it('keeps a "*/" inside the data from closing the block early', () => {
    const block = pluginDataFountainBlock({ p: { s: 'a */ b' } });
    expect(block.indexOf('*/')).toBe(block.length - 2);
    expect(extractFountainPluginData(`Action.\n\n${block}\n`).data).toEqual({ p: { s: 'a */ b' } });
  });

  it('clears the previous script\'s data when a plain Fountain file is imported', async () => {
    usePluginDataStore.getState().setAll({ sidekick: tricky });
    await parseScreenplayImport('plain.fountain', exportFountain(doc));
    expect(usePluginDataStore.getState().data).toEqual({});
  });
});
