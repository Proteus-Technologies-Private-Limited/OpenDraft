/**
 * Runtime plugins: the server's plugin folders load at start-up, and nothing
 * a plugin or the server does wrong can stop the app from starting.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pluginRegistry } from './registry';
import { loadRuntimePlugins, parsePluginList, type RuntimePluginInfo } from './runtimeLoader';
import { globalNameFor, SHARED_MODULES } from './runtimeHost';

const entry = (id: string, extra: Partial<RuntimePluginInfo> = {}) => ({
  id, name: id, version: '1.0.0', apiVersion: 1, defaultEnabled: false, script: `/plugins/${id}/index.js`, style: null, ...extra,
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
  for (const id of ['rt-one', 'rt-two', 'rt-bad', 'rt-built-in', 'rt-new']) pluginRegistry.unregister(id);
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
