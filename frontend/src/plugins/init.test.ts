/**
 * Plugin init: it runs once per plugin, the first time a script's editor is
 * ready while the plugin is active, and the context it gets keeps reading
 * whichever editor is open.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { PluginRegistry, ADDON_PREFERENCE_PREFIX, type OpenDraftPlugin, type PluginContext } from './registry';

const editorA = { id: 'a' } as unknown as Editor;
const editorB = { id: 'b' } as unknown as Editor;

function plugin(init: OpenDraftPlugin['init'], overrides: Partial<OpenDraftPlugin> = {}): OpenDraftPlugin {
  return { id: 'p', name: 'P', version: '1.0.0', init, ...overrides };
}

beforeEach(() => {
  localStorage.clear();
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

  it('runs an add-on\'s init only after its onActivate has finished, and not at all if it fails', async () => {
    localStorage.setItem(ADDON_PREFERENCE_PREFIX + 'slow', 'true');
    localStorage.setItem(ADDON_PREFERENCE_PREFIX + 'fails', 'true');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = new PluginRegistry();
    await registry.setEditor(editorA);
    let finish!: () => void;
    const order: string[] = [];
    const slowInit = vi.fn(() => { order.push('init'); });
    registry.register(plugin(slowInit, {
      id: 'slow', optIn: true,
      onActivate: () => new Promise<void>((resolve) => { finish = () => { order.push('activated'); resolve(); }; }),
    }));
    const failedInit = vi.fn();
    registry.register(plugin(failedInit, { id: 'fails', optIn: true, onActivate: async () => { throw new Error('no'); } }));
    await registry.setEditor(editorA);
    expect(slowInit).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(slowInit).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['activated', 'init']);
    await vi.waitFor(() => expect(registry.isAddOnEnabled('fails')).toBe(false));
    await registry.setEditor(editorA);
    expect(failedInit).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('undoes an add-on\'s init when it is turned off, and runs it again when turned back on', async () => {
    const registry = new PluginRegistry();
    const init = vi.fn();
    const destroy = vi.fn(() => { throw new Error('messy'); });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.register(plugin(init, { id: 'addon', optIn: true, destroy }));
    await registry.setEditor(editorA);
    await registry.enableAddOn('addon');
    expect(init).toHaveBeenCalledTimes(1);

    await registry.disableAddOn('addon');
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(registry.isActive('addon')).toBe(false);

    await registry.enableAddOn('addon');
    expect(init).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it('does not call destroy when an add-on whose init never ran is turned off', async () => {
    const registry = new PluginRegistry();
    const destroy = vi.fn();
    registry.register(plugin(vi.fn(), { id: 'addon', optIn: true, destroy }));
    await registry.enableAddOn('addon');
    await registry.disableAddOn('addon');
    expect(destroy).not.toHaveBeenCalled();
  });

  it('destroys the plugin it replaces under the same id', async () => {
    const registry = new PluginRegistry();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const firstDestroy = vi.fn(() => { throw new Error('messy'); });
    registry.register(plugin(vi.fn(), { destroy: firstDestroy }));
    const secondDestroy = vi.fn();
    registry.register(plugin(vi.fn(), { destroy: secondDestroy }));
    expect(firstDestroy).toHaveBeenCalledTimes(1);
    expect(secondDestroy).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('replaced'), expect.any(Error));
    error.mockRestore();
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
