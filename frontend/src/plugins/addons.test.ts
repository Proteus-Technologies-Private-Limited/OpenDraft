/**
 * Add-ons: opt-in plugins stay off — contributing nothing to the app — until
 * the writer turns them on, and the choice is remembered on the device.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PluginRegistry, ENABLED_ADDONS_KEY, type OpenDraftPlugin } from './registry';

const doc = { type: 'doc', content: [] };

function addOn(overrides: Partial<OpenDraftPlugin> = {}): OpenDraftPlugin {
  return {
    id: 'assistant',
    name: 'AI Assistant',
    version: '1.0.0',
    optIn: true,
    description: 'Chat about your script.',
    privacy: 'Sends the text you ask about to the AI server you choose.',
    menuItems: [{ id: 'ask', section: 'Tools', label: 'Ask the Assistant' }],
    panels: [{ id: 'chat', slot: 'right-sidebar', label: 'Assistant', component: () => null }],
    routes: [{ path: '/assistant', component: () => null }],
    editorExtensions: [{ name: 'assistantMarks' }],
    importers: [{ id: 'chatlog', label: 'Chat log', extensions: ['chatlog'], parse: async () => ({ doc }) }],
    exporters: [{ id: 'prompt', label: 'Prompt', extension: 'txt', export: async () => '' }],
    reports: [{ id: 'usage', label: 'Usage', build: () => ({ title: 'Usage', columns: [], rows: [] }) }],
    ...overrides,
  };
}

/** What every contribution getter returns, so one assertion covers them all. */
function contributions(registry: PluginRegistry) {
  return {
    menu: registry.getMenuItems('Tools').length,
    panels: registry.getPanels('right-sidebar').length,
    routes: registry.getRoutes().length,
    extensions: registry.getEditorExtensions().length,
    importers: registry.getImporters().length,
    importerFor: registry.getImporterFor('chatlog') !== null,
    exporters: registry.getExporters().length,
    reports: registry.getReports().length,
  };
}

const NOTHING = { menu: 0, panels: 0, routes: 0, extensions: 0, importers: 0, importerFor: false, exporters: 0, reports: 0 };
const EVERYTHING = { menu: 1, panels: 1, routes: 1, extensions: 1, importers: 1, importerFor: true, exporters: 1, reports: 1 };

beforeEach(() => {
  localStorage.clear();
});

describe('add-ons', () => {
  it('contribute nothing until the writer turns them on', () => {
    const registry = new PluginRegistry();
    registry.register(addOn());
    expect(contributions(registry)).toEqual(NOTHING);
    expect(registry.isActive('assistant')).toBe(false);
    // Still listed, so Settings → Add-ons can offer it.
    expect(registry.getAddOns().map((p) => p.id)).toEqual(['assistant']);
  });

  it('contribute everything once turned on, and nothing again once turned off', async () => {
    const registry = new PluginRegistry();
    registry.register(addOn());
    await registry.enableAddOn('assistant');
    expect(contributions(registry)).toEqual(EVERYTHING);
    expect(registry.isActive('assistant')).toBe(true);
    await registry.disableAddOn('assistant');
    expect(contributions(registry)).toEqual(NOTHING);
  });

  it('leave ordinary plugins exactly as they were', () => {
    const registry = new PluginRegistry();
    registry.register(addOn({ id: 'pro-feature', optIn: undefined }));
    expect(contributions(registry)).toEqual(EVERYTHING);
    expect(registry.getAddOns()).toEqual([]);
    return expect(registry.enableAddOn('pro-feature')).rejects.toThrow(/part of the app/);
  });

  it('remember the choice on the device, and start the add-on again at registration', async () => {
    const first = new PluginRegistry();
    first.register(addOn());
    await first.enableAddOn('assistant');
    expect(JSON.parse(localStorage.getItem(ENABLED_ADDONS_KEY)!)).toEqual(['assistant']);

    const onActivate = vi.fn();
    const next = new PluginRegistry();
    next.register(addOn({ onActivate }));
    expect(next.isActive('assistant')).toBe(true);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('stay off when turning on fails, and say why', async () => {
    const registry = new PluginRegistry();
    registry.register(addOn({ onActivate: () => { throw new Error('no server'); } }));
    await expect(registry.enableAddOn('assistant')).rejects.toThrow('AI Assistant could not be turned on: no server');
    expect(registry.isActive('assistant')).toBe(false);
    expect(localStorage.getItem(ENABLED_ADDONS_KEY)).toBeNull();
  });

  it('are off even when their own clean-up fails, and pass on the request to forget settings', async () => {
    const onDeactivate = vi.fn(() => { throw new Error('locked'); });
    const registry = new PluginRegistry();
    registry.register(addOn({ onDeactivate }));
    await registry.enableAddOn('assistant');
    await expect(registry.disableAddOn('assistant', { forgetSettings: true })).rejects.toThrow(/is off, but/);
    expect(onDeactivate).toHaveBeenCalledWith({ forgetSettings: true });
    expect(registry.isActive('assistant')).toBe(false);
    expect(JSON.parse(localStorage.getItem(ENABLED_ADDONS_KEY)!)).toEqual([]);
  });

  it('start off when the remembered list is unreadable', () => {
    localStorage.setItem(ENABLED_ADDONS_KEY, '{not json');
    const registry = new PluginRegistry();
    registry.register(addOn());
    expect(registry.isActive('assistant')).toBe(false);
  });

  it('tell subscribers when an add-on is turned on or off', async () => {
    const registry = new PluginRegistry();
    registry.register(addOn());
    const listener = vi.fn();
    registry.subscribe(listener);
    await registry.enableAddOn('assistant');
    await registry.disableAddOn('assistant');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('withhold their grammar providers while off, and tell the editor to rescan when that changes', async () => {
    const registry = new PluginRegistry();
    const provider = async () => [];
    registry.register(addOn({ grammarProviders: { 'ai-style': provider } }));
    const rescan = vi.fn();
    registry.subscribeGrammar(rescan);
    expect(registry.getGrammarProviders()).toEqual([]);
    await registry.enableAddOn('assistant');
    expect(registry.getGrammarProviders()).toEqual([{ name: 'ai-style', provider }]);
    await registry.disableAddOn('assistant');
    expect(registry.getGrammarProviders()).toEqual([]);
    expect(rescan).toHaveBeenCalledTimes(2);
  });

  it('do not make the editor rescan grammar for plugins without grammar providers', async () => {
    const registry = new PluginRegistry();
    registry.register(addOn());
    const rescan = vi.fn();
    registry.subscribeGrammar(rescan);
    await registry.enableAddOn('assistant');
    expect(rescan).not.toHaveBeenCalled();
  });

  it('refuse an add-on that is not installed', async () => {
    const registry = new PluginRegistry();
    await expect(registry.enableAddOn('missing')).rejects.toThrow(/No add-on called "missing"/);
  });
});
