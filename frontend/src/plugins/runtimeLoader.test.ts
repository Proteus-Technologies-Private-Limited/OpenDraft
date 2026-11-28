/**
 * Runtime plugins: the server's plugin folders load at start-up, and nothing
 * a plugin or the server does wrong can stop the app from starting.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pluginRegistry } from './registry';
import { loadRuntimePlugins, parsePluginList, type RuntimePluginInfo } from './runtimeLoader';
import { globalNameFor, SHARED_MODULES } from './runtimeHost';

const entry = (id: string, extra: Partial<RuntimePluginInfo> = {}) => ({
  id, name: id, version: '1.0.0', apiVersion: 1, defaultEnabled: false as boolean | null, script: `/plugins/${id}/index.js`, style: null, ...extra,
});

/** Stand in for the browser loading a plugin's script: the script hands over its function. */
function scripts(bodies: Record<string, () => void>) {
  return async (plugin: RuntimePluginInfo) => {
    const body = bodies[plugin.id];
    if (!body) return false;
    (globalThis.__OPENDRAFT_PLUGIN_QUEUE__ as { push: (e: [string, () => void]) => number }).push([plugin.id, body]);
    return true;
  };
}

/** Just enough of a document for the loader's style sheets (the tests run without a DOM). */
interface FakeLink { rel: string; disabled: boolean; dataset: Record<string, string>; remove: () => void }
function fakeDocument() {
  const links: FakeLink[] = [];
  const doc = {
    head: { appendChild: (link: FakeLink) => { links.push(link); return link; } },
    createElement: (): FakeLink => {
      const link: FakeLink = { rel: '', disabled: false, dataset: {}, remove: () => { const i = links.indexOf(link); if (i >= 0) links.splice(i, 1); } };
      return link;
    },
    querySelectorAll: (selector: string) => {
      expect(selector).toBe('link[data-opendraft-plugin="style"]');
      return links.filter((l) => l.dataset.opendraftPlugin === 'style');
    },
  };
  vi.stubGlobal('document', doc);
  return {
    doc,
    sheet: (id: string) => links.find((l) => l.dataset.opendraftPluginId === id) ?? null,
  };
}

const registerAs = (id: string) => () => pluginRegistry.register({ id, name: id, version: '1.0.0' });

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  for (const id of ['rt-one', 'rt-two', 'rt-three', 'rt-bad', 'rt-built-in', 'rt-new', 'rt-silent', 'rt-missing', 'rt-slow']) pluginRegistry.unregister(id);
  vi.unstubAllGlobals();
  warn.mockRestore();
  error.mockRestore();
  info.mockRestore();
});

describe('loadRuntimePlugins', () => {
  it('automatically lists deployed plugins as add-ons and applies each server default', async () => {
    const loaded = await loadRuntimePlugins({
      fetchList: async () => [entry('rt-one', { defaultEnabled: true }), entry('rt-two')],
      addFiles: scripts({ 'rt-one': registerAs('rt-one'), 'rt-two': registerAs('rt-two') }),
    });
    expect(loaded).toEqual(['rt-one', 'rt-two']);
    expect(pluginRegistry.getAddOns().map((p) => p.id)).toEqual(['rt-one', 'rt-two']);
    expect(pluginRegistry.isActive('rt-one')).toBe(true);
    expect(pluginRegistry.isActive('rt-two')).toBe(false);
  });

  it('keeps a deployed plugin on when neither the admin nor its manifest chose a default', async () => {
    await loadRuntimePlugins({
      fetchList: async () => [entry('rt-one', { defaultEnabled: null }), entry('rt-two', { defaultEnabled: undefined as unknown as null })],
      addFiles: scripts({ 'rt-one': registerAs('rt-one'), 'rt-two': registerAs('rt-two') }),
    });
    expect(pluginRegistry.isActive('rt-one')).toBe(true);
    expect(pluginRegistry.isActive('rt-two')).toBe(true);
  });

  it('removes the style sheet of a plugin whose script fails or does not register, and follows the add-on on and off', async () => {
    const { doc, sheet } = fakeDocument();
    const addFiles = async (plugin: RuntimePluginInfo) => {
      const link = doc.createElement();
      link.rel = 'stylesheet';
      link.dataset.opendraftPlugin = 'style';
      link.dataset.opendraftPluginId = plugin.id;
      doc.head.appendChild(link);
      if (plugin.id === 'rt-missing') return false; // the script failed to load
      if (plugin.id === 'rt-slow') return null; // still loading when time ran out
      if (plugin.id === 'rt-bad') throw new Error('network');
      return scripts({ 'rt-one': registerAs('rt-one'), 'rt-two': registerAs('rt-two'), 'rt-silent': () => {} })(plugin);
    };
    const loaded = await loadRuntimePlugins({
      fetchList: async () => ['rt-one', 'rt-two', 'rt-silent', 'rt-missing', 'rt-bad', 'rt-slow']
        .map((id) => entry(id, { defaultEnabled: id !== 'rt-two' })),
      addFiles,
    });
    expect(loaded).toEqual(['rt-one', 'rt-two']);
    expect(sheet('rt-silent')).toBeNull();
    expect(sheet('rt-missing')).toBeNull();
    expect(sheet('rt-bad')).toBeNull();
    expect(sheet('rt-one')?.disabled).toBe(false);
    // An add-on that is off keeps its sheet, switched off, so turning it on needs no reload.
    expect(sheet('rt-two')?.disabled).toBe(true);
    await pluginRegistry.enableAddOn('rt-two');
    expect(sheet('rt-two')?.disabled).toBe(false);
    await pluginRegistry.disableAddOn('rt-two');
    expect(sheet('rt-two')?.disabled).toBe(true);
    // A script still loading keeps its sheet, off until it registers.
    expect(sheet('rt-slow')?.disabled).toBe(true);
    pluginRegistry.register({ id: 'rt-slow', name: 'slow', version: '1' });
    expect(sheet('rt-slow')?.disabled).toBe(false);
  });

  it('skips a plugin that throws, and still starts the others', async () => {
    const loaded = await loadRuntimePlugins({
      fetchList: async () => [entry('rt-bad'), entry('rt-one')],
      addFiles: scripts({ 'rt-bad': () => { throw new Error('boom'); }, 'rt-one': registerAs('rt-one') }),
    });
    expect(loaded).toEqual(['rt-one']);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('rt-bad failed to start'), expect.any(Error));
  });

  it('leaves a plugin that is already built into the app alone', async () => {
    pluginRegistry.register({ id: 'rt-built-in', name: 'built in', version: '9' });
    const body = vi.fn();
    const loaded = await loadRuntimePlugins({ fetchList: async () => [entry('rt-built-in')], addFiles: scripts({ 'rt-built-in': body }) });
    expect(loaded).toEqual([]);
    expect(body).not.toHaveBeenCalled();
    expect(pluginRegistry.getAll().find((p) => p.id === 'rt-built-in')?.version).toBe('9');
  });

  it('skips a plugin that needs a newer plugin API', async () => {
    const body = vi.fn();
    const loaded = await loadRuntimePlugins({ fetchList: async () => [entry('rt-new', { apiVersion: 99 })], addFiles: scripts({ 'rt-new': body }) });
    expect(loaded).toEqual([]);
    expect(body).not.toHaveBeenCalled();
  });

  it('starts nothing, quietly, when the server has no list or fails', async () => {
    expect(await loadRuntimePlugins({ fetchList: async () => ({ detail: 'Not found' }) })).toEqual([]);
    expect(await loadRuntimePlugins({ fetchList: async () => { throw new Error('connection refused'); } })).toEqual([]);
  });

  it('does not wait for a server that never answers', async () => {
    const t0 = Date.now();
    const loaded = await loadRuntimePlugins({
      budgetMs: 200,
      fetchList: (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    });
    expect(loaded).toEqual([]);
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});

describe('parsePluginList', () => {
  it('keeps only well-formed entries', () => {
    expect(parsePluginList([entry('ok-one'), { id: 'Bad Id', script: '/x.js' }, { id: 'no-script' }, null, 'x']).map((p) => p.id)).toEqual(['ok-one']);
  });

  it('keeps a boolean default and reads anything else as no default', () => {
    const list = parsePluginList([entry('a', { defaultEnabled: true }), entry('b', { defaultEnabled: false }), entry('c', { defaultEnabled: null }),
      { id: 'd', script: '/d.js', defaultEnabled: 'yes' }, { id: 'e', script: '/e.js' }]);
    expect(list.map((p) => p.defaultEnabled)).toEqual([true, false, null, null, null]);
  });
});

describe('the shared modules', () => {
  it('are published as ES-module-like globals under the documented names', async () => {
    await loadRuntimePlugins({ fetchList: async () => [entry('rt-one')], addFiles: scripts({ 'rt-one': registerAs('rt-one') }) });
    const g = globalThis as Record<string, unknown>;
    expect(globalNameFor('@tiptap/pm/state')).toBe('__ODP__tiptap_pm_state');
    for (const specifier of Object.keys(SHARED_MODULES)) {
      const mod = g[globalNameFor(specifier)] as Record<string, unknown>;
      expect(mod?.__esModule, specifier).toBe(true);
    }
    expect(typeof (g[globalNameFor('react')] as { useState?: unknown }).useState).toBe('function');
    expect(typeof (g[globalNameFor('@core/plugins/registry')] as { pluginRegistry?: unknown }).pluginRegistry).toBe('object');
  });
});
