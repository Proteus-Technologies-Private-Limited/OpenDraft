/**
 * Plugin init: it runs once per plugin, the first time a script's editor is
 * ready while the plugin is active, and the context it gets keeps reading
 * whichever editor is open.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { PluginRegistry, ENABLED_ADDONS_KEY, type OpenDraftPlugin, type PluginContext } from './registry';

const editorA = { id: 'a' } as unknown as Editor;
const editorB = { id: 'b' } as unknown as Editor;

function plugin(init: OpenDraftPlugin['init'], overrides: Partial<OpenDraftPlugin> = {}): OpenDraftPlugin {
  return { id: 'p', name: 'P', version: '1.0.0', init, ...overrides };
}

beforeEach(() => {
  localStorage.removeItem(ENABLED_ADDONS_KEY);
});

describe('plugin init', () => {
  it('waits for an editor, then runs once', async () => {
    const registry = new PluginRegistry();
    const init = vi.fn();
    registry.register(plugin(init));
    await Promise.resolve();
    expect(init).not.toHaveBeenCalled();

    await registry.setEditor(editorA);
    expect(init).toHaveBeenCalledTimes(1);

    registry.releaseEditor(editorA);
    await registry.setEditor(editorB);
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('runs straight away for a plugin registered while a script is open', async () => {
    const registry = new PluginRegistry();
    await registry.setEditor(editorA);
    const init = vi.fn();
    registry.register(plugin(init));
    await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1));
  });

  it('hands over a context that follows the open editor', async () => {
    const registry = new PluginRegistry();
    let kept: PluginContext | null = null;
    registry.register(plugin((ctx) => { kept = ctx; }));
    await registry.setEditor(editorA);
    expect(kept!.editor).toBe(editorA);

    registry.releaseEditor(editorA);
    expect(kept!.editor).toBeNull();

    await registry.setEditor(editorB);
    expect(kept!.editor).toBe(editorB);
  });

  it('ignores a release from an editor that is no longer the open one', async () => {
    const registry = new PluginRegistry();
    await registry.setEditor(editorA);
    await registry.setEditor(editorB);
    registry.releaseEditor(editorA);
    expect(registry.getEditor()).toBe(editorB);
  });

  it('runs an add-on\'s init only once the writer turns it on', async () => {
    const registry = new PluginRegistry();
    const init = vi.fn();
    registry.register(plugin(init, { id: 'addon', optIn: true }));
    await registry.setEditor(editorA);
    expect(init).not.toHaveBeenCalled();

    await registry.enableAddOn('addon');
    expect(init).toHaveBeenCalledTimes(1);
  });

  it('keeps starting the other plugins when one init throws', async () => {
    const registry = new PluginRegistry();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    registry.register(plugin(() => { throw new Error('boom'); }, { id: 'bad' }));
    registry.register(plugin(second, { id: 'good' }));
    await registry.setEditor(editorA);
    expect(second).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('runs init again for a plugin re-registered under the same id', async () => {
    const registry = new PluginRegistry();
    await registry.setEditor(editorA);
    const first = vi.fn();
    const second = vi.fn();
    registry.register(plugin(first));
    await vi.waitFor(() => expect(first).toHaveBeenCalledTimes(1));
    registry.register(plugin(second));
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1));
  });

  it('keeps initAll working as a way to report the editor', async () => {
    const registry = new PluginRegistry();
    const init = vi.fn();
    registry.register(plugin(init));
    await registry.initAll({ editor: editorA });
    expect(init).toHaveBeenCalledTimes(1);
    expect(registry.getEditor()).toBe(editorA);
  });
});
