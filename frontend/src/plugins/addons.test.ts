/**
 * Add-ons: opt-in plugins stay off — contributing nothing to the app — until
 * the writer turns them on, and the choice is remembered on the device.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ADDON_PREFERENCE_PREFIX, PluginRegistry, ENABLED_ADDONS_KEY, type OpenDraftPlugin } from './registry';

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
    expect(localStorage.getItem(ADDON_PREFERENCE_PREFIX + 'assistant')).toBe('true');

    const onActivate = vi.fn();
    const next = new PluginRegistry();
    next.register(addOn({ onActivate }));
    expect(next.isActive('assistant')).toBe(true);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('applies changed server defaults only where the writer has no saved choice', async () => {
    function open(defaultEnabled: boolean, onActivate = vi.fn()) {
      const registry = new PluginRegistry();
      registry.setRuntimeAddOnDefaults(new Map([['assistant', defaultEnabled], ['unchanged', defaultEnabled]]));
      // Nothing leaves the device and there is nothing to ask: a default may start it.
      registry.register(addOn({ optIn: undefined, privacy: undefined, onActivate }));
      registry.register({ id: 'unchanged', name: 'Unchanged', version: '1.0.0' });
      return registry;
    }
    const onActivate = vi.fn();
    const first = open(true, onActivate);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(contributions(first)).toEqual(EVERYTHING);
    await first.disableAddOn('assistant');
    const second = open(true);
    expect(second.isAddOnEnabled('assistant')).toBe(false);
    await second.enableAddOn('assistant');
    const third = open(false);
    expect(third.isAddOnEnabled('assistant')).toBe(true);
    expect(third.isAddOnEnabled('unchanged')).toBe(false);
  });

  it('keeps legacy enabled add-ons and records an explicit choice to turn them off', async () => {
    localStorage.setItem(ENABLED_ADDONS_KEY, JSON.stringify(['assistant']));
    const first = new PluginRegistry();
    first.register(addOn());
    expect(first.isAddOnEnabled('assistant')).toBe(true);
    await first.disableAddOn('assistant');
    const next = new PluginRegistry();
    next.register(addOn());
    expect(next.isAddOnEnabled('assistant')).toBe(false);
  });

  it('stay off when turning on fails, and say why', async () => {
    const registry = new PluginRegistry();
    registry.register(addOn({ onActivate: () => { throw new Error('no server'); } }));
    await expect(registry.enableAddOn('assistant')).rejects.toThrow('AI Assistant could not be turned on: no server');
    expect(registry.isActive('assistant')).toBe(false);
    expect(localStorage.getItem(ADDON_PREFERENCE_PREFIX + 'assistant')).toBeNull();
  });

  it('are off even when their own clean-up fails, and pass on the request to forget settings', async () => {
    const onDeactivate = vi.fn(() => { throw new Error('locked'); });
    const registry = new PluginRegistry();
    registry.register(addOn({ onDeactivate }));
    await registry.enableAddOn('assistant');
    await expect(registry.disableAddOn('assistant', { forgetSettings: true })).rejects.toThrow(/is off, but/);
    expect(onDeactivate).toHaveBeenCalledWith({ forgetSettings: true });
    expect(registry.isActive('assistant')).toBe(false);
    expect(localStorage.getItem(ADDON_PREFERENCE_PREFIX + 'assistant')).toBe('false');
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

  it('are never started by a default when they say what leaves the device or have settings', async () => {
    const onActivate = vi.fn();
    const registry = new PluginRegistry();
    registry.setRuntimeAddOnDefaults(new Map<string, boolean | null>([
      ['assistant', true], ['keyed', true], ['translated', true], ['plain', null],
    ]));
    registry.register(addOn({ onActivate }));
    registry.register(addOn({ id: 'keyed', privacy: undefined, settings: () => null, onActivate }));
    registry.register(addOn({ id: 'translated', privacy: undefined, privacyKey: 'x.privacy', onActivate }));
    // A deployed plain plugin with a privacy statement and no default stays off too.
    registry.register({ id: 'plain', name: 'Plain', version: '1', privacy: 'Sends text away.', onActivate });
    await Promise.resolve();
    for (const id of ['assistant', 'keyed', 'translated', 'plain']) {
      expect(registry.isAddOnEnabled(id), id).toBe(false);
      expect(registry.isAddOnSuggested(id), id).toBe(true);
    }
    expect(onActivate).not.toHaveBeenCalled();
    expect(contributions(registry)).toEqual(NOTHING);
    expect(localStorage.getItem(ADDON_PREFERENCE_PREFIX + 'assistant')).toBeNull();

    // The writer turns it on themselves; that choice is remembered as usual.
    await registry.enableAddOn('assistant');
    expect(registry.isAddOnSuggested('assistant')).toBe(false);
    const next = new PluginRegistry();
    next.setRuntimeAddOnDefaults(new Map([['assistant', true]]));
    next.register(addOn());
    expect(next.isAddOnEnabled('assistant')).toBe(true);
  });

  it('may be started by a default when their privacy statement says nothing leaves the device', async () => {
    const onActivate = vi.fn();
    const registry = new PluginRegistry();
    registry.setRuntimeAddOnDefaults(new Map<string, boolean | null>([['local', true], ['local-keyed', true]]));
    registry.register(addOn({ id: 'local', privacy: 'Makes no network requests.', staysOnDevice: true, onActivate }));
    // Settings still have to be asked for, so this one waits for the writer.
    registry.register(addOn({ id: 'local-keyed', staysOnDevice: true, settings: () => null }));
    await Promise.resolve();
    expect(registry.isAddOnEnabled('local')).toBe(true);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(registry.isAddOnEnabled('local-keyed')).toBe(false);
    expect(registry.isAddOnSuggested('local-keyed')).toBe(true);
  });

  it('keep a deployed plain plugin on when neither the admin nor its manifest set a default', () => {
    const registry = new PluginRegistry();
    registry.setRuntimeAddOnDefaults(new Map<string, boolean | null>([['plain', null], ['own-opt-in', null], ['admin-off', false]]));
    registry.register({ id: 'plain', name: 'Plain', version: '1' });
    registry.register({ id: 'own-opt-in', name: 'Own', version: '1', optIn: true });
    registry.register({ id: 'admin-off', name: 'Off', version: '1' });
    expect(registry.getAddOns().map((p) => p.id)).toEqual(['admin-off', 'own-opt-in', 'plain']);
    expect(registry.isActive('plain')).toBe(true);
    expect(registry.isActive('own-opt-in')).toBe(false);
    expect(registry.isActive('admin-off')).toBe(false);
  });

  it('are left off, contributing nothing, when onActivate fails as they start', async () => {
    localStorage.setItem(ADDON_PREFERENCE_PREFIX + 'assistant', 'true');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const registry = new PluginRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.register(addOn({ onActivate: async () => { throw new Error('no server'); } }));
    await vi.waitFor(() => expect(registry.isAddOnEnabled('assistant')).toBe(false));
    expect(contributions(registry)).toEqual(NOTHING);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('could not start'), expect.any(Error));
    // The writer's choice is kept: it tries again next time.
    expect(localStorage.getItem(ADDON_PREFERENCE_PREFIX + 'assistant')).toBe('true');
    error.mockRestore();
  });

  it('refuse an add-on that is not installed', async () => {
    const registry = new PluginRegistry();
    await expect(registry.enableAddOn('missing')).rejects.toThrow(/No add-on called "missing"/);
  });
});
