/**
 * The import, export and report extension points: a plugin's formats join the
 * built-in import paths, and a plugin can never take over a built-in format.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { pluginRegistry, type OpenDraftPlugin } from './registry';
import {
  binaryImportExtensions,
  importAccept,
  importExtensions,
  importFormatLabel,
  isBinaryImportExtension,
  isImportableExtension,
  parseScreenplayImport,
} from '../utils/importScreenplay';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'action', content: [{ type: 'text', text }] }] });

const plugin: OpenDraftPlugin = {
  id: 'test-formats',
  name: 'Test formats',
  version: '1.0.0',
  importers: [
    {
      id: 'mmsw',
      label: 'Movie Magic Screenwriter (.mmsw)',
      extensions: ['MMSW'],
      binary: true,
      parse: async (filename, data) => ({
        doc: doc(`${filename}:${(data as ArrayBuffer).byteLength}`),
        title: 'From plugin',
        warnings: ['note'],
      }),
    },
    {
      id: 'hijack',
      label: 'Not Fountain',
      extensions: ['fountain'],
      parse: async () => ({ doc: doc('hijacked') }),
    },
  ],
  exporters: [{ id: 'csv', label: 'Scenes (.csv)', extension: 'csv', export: async () => 'a,b' }],
  reports: [{ id: 'r', label: 'My Report', build: () => ({ title: 'T', columns: ['A'], rows: [[1]] }) }],
};

afterEach(() => pluginRegistry.unregister(plugin.id));

describe('plugin importers', () => {
  it('add their extensions to every import path', () => {
    expect(isImportableExtension('mmsw')).toBe(false);
    pluginRegistry.register(plugin);
    expect(importExtensions()).toContain('mmsw');
    expect(isImportableExtension('mmsw')).toBe(true);
    expect(isBinaryImportExtension('mmsw')).toBe(true);
    expect(binaryImportExtensions()).toEqual(expect.arrayContaining(['fadein', 'pdf', 'mmsw']));
    expect(importAccept()).toContain('.mmsw');
    expect(importFormatLabel('mmsw')).toBe('Movie Magic Screenwriter (.mmsw)');
  });

  it('are handed the file and their result is used as the import', async () => {
    pluginRegistry.register(plugin);
    const out = await parseScreenplayImport('Script.mmsw', new ArrayBuffer(7), { hydrateStores: false });
    expect(out.title).toBe('From plugin');
    expect(out.warnings).toEqual(['note']);
    expect(out.formatLabel).toBe('Movie Magic Screenwriter (.mmsw)');
    expect(out.doc.content?.[0]?.content?.[0]?.text).toBe('Script.mmsw:7');
  });

  it('cannot replace a built-in format', async () => {
    pluginRegistry.register(plugin);
    expect(importExtensions().filter((e) => e === 'fountain')).toHaveLength(1);
    expect(importFormatLabel('fountain')).toBe('Fountain (.fountain)');
    const out = await parseScreenplayImport('a.fountain', 'INT. HOUSE - DAY\n\nReal.', { hydrateStores: false });
    expect(JSON.stringify(out.doc)).not.toContain('hijacked');
    expect(JSON.stringify(out.doc)).toContain('Real.');
  });

  it('are gone once the plugin is unregistered', () => {
    pluginRegistry.register(plugin);
    pluginRegistry.unregister(plugin.id);
    expect(isImportableExtension('mmsw')).toBe(false);
  });
});

describe('plugin exporters and reports', () => {
  it('are listed in registration order', () => {
    pluginRegistry.register(plugin);
    pluginRegistry.register({ id: 'second', name: 'Second', version: '1', reports: [{ id: 'r2', label: 'Second Report', build: () => ({ title: 'S', columns: [], rows: [] }) }] });
    expect(pluginRegistry.getExporters().map((e) => e.id)).toEqual(['csv']);
    expect(pluginRegistry.getReports().map((r) => r.label)).toEqual(['My Report', 'Second Report']);
    pluginRegistry.unregister('second');
  });

  it('tell subscribers when a plugin arrives, so the menus can redraw', () => {
    let calls = 0;
    const off = pluginRegistry.subscribe(() => { calls++; });
    pluginRegistry.register(plugin);
    off();
    expect(calls).toBe(1);
  });
});
