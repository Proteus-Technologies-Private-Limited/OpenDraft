/**
 * OpenDraft Plugin Registry
 *
 * Provides a central registration point for plugins to add menu items,
 * sidebar panels, routes, and editor extensions. The core app renders
 * registered items alongside its built-in features.
 *
 * Usage (from a plugin):
 *   import { pluginRegistry } from './plugins/registry';
 *   pluginRegistry.register({ id: 'my-plugin', name: 'My Plugin', ... });
 */

import type { Editor, JSONContent } from '@tiptap/core';
import type { ReactNode } from 'react';
import { i18next } from '../i18n';
import { usePluginDataStore } from '../stores/pluginDataStore';
import { toStorableEntry } from '../utils/pluginData';

/**
 * The words a plugin shows. A plugin that brought its own translations
 * (`addPluginResources`) names a key such as `my-plugin:export.label`; a plugin
 * without one — or a key with no entry — shows its plain English `label`.
 * Call it when rendering, never at import time, so it follows the language.
 */
export function resolvePluginText(key: string | undefined, fallback: string): string {
  if (!key) return fallback;
  try {
    // exists() first: the app's missing-key handler would otherwise hand back the key itself.
    if (!i18next.isInitialized || !i18next.exists(key)) return fallback;
    const out: unknown = i18next.t(key, { defaultValue: fallback });
    return typeof out === 'string' && out ? out : fallback;
  } catch (err) {
    console.warn(`[plugins] could not translate "${key}"`, err);
    return fallback;
  }
}

// ── Plugin types ──

export type MenuSection = 'File' | 'Edit' | 'Format' | 'View' | 'Production' | 'Tools' | 'Help';

export interface PluginContext {
  /**
   * The screenplay editor. In the context `init` receives this always reads
   * the editor open right now — keep the context and read `ctx.editor` when
   * you need it; it is null while no script is open.
   */
  editor: Editor | null;
}

export interface PluginMenuChildEntry {
  id: string;
  label: string;
  /** Translation key, e.g. `my-plugin:menu.export`; `label` is the English default. */
  labelKey?: string;
  action?: (ctx: PluginContext) => void;
  shortcut?: string;
  disabled?: boolean | ((ctx: PluginContext) => boolean);
  /** Omit for a command; a boolean (including false) exposes a checked menu item. */
  checked?: boolean | ((ctx: PluginContext) => boolean);
  /** With `checked`, announce a mutually exclusive option instead of a checkbox. */
  radio?: boolean;
  separator?: boolean;
  children?: PluginMenuChildEntry[];
  icon?: ReactNode;
}

export interface PluginMenuEntry {
  id: string;
  section: MenuSection;
  label: string;
  /** Translation key, e.g. `my-plugin:menu.export`; `label` is the English default. */
  labelKey?: string;
  action?: (ctx: PluginContext) => void;
  shortcut?: string;
  order?: number;
  disabled?: boolean | ((ctx: PluginContext) => boolean);
  /** Omit for a command; a boolean (including false) exposes a checked menu item. */
  checked?: boolean | ((ctx: PluginContext) => boolean);
  /** With `checked`, announce a mutually exclusive option instead of a checkbox. */
  radio?: boolean;
  separator?: boolean;
  children?: PluginMenuChildEntry[];
  icon?: ReactNode;
}

export interface PluginPanelProps {
  editor: Editor | null;
}

export interface PluginPanelEntry {
  id: string;
  /**
   * `right-sidebar`: a vertical tab beside the script. `bottom-panel`: a tab
   * under the script that opens the panel above the status bar. `toolbar`: an
   * item the writer can place on the toolbar. `status-bar`: drawn at the end
   * of the status bar. Every slot passes `{ editor }`.
   */
  slot: 'right-sidebar' | 'bottom-panel' | 'toolbar' | 'status-bar';
  component: React.ComponentType<any>;
  label: string;
  /** Translation key; `label` is the English default. */
  labelKey?: string;
  icon?: string;
  order?: number;
}

export interface PluginRouteEntry {
  path: string;
  component: React.ComponentType<any>;
  /** When true, the registry treats this entry as a REPLACEMENT for a
   *  built-in route at the same `path` instead of an additional route.
   *  Used by Pro to swap `ProjectView` → `ProProjectView` without
   *  forking the App shell. Override entries are excluded from
   *  `getRoutes()` (additions) and surfaced via `getRouteOverride(path)`
   *  so core's App can look them up while rendering its built-in
   *  `<Route>` table. */
  override?: boolean;
}

// ── Importers, exporters and reports ──
//
// Three places a plugin can join the core's own file and analytics flows
// instead of adding a menu item that duplicates them: File → Import reads a
// plugin's formats wherever it reads the built-in ones, File → Export lists a
// plugin's formats beside FDX and PDF, and Tools → Analytics → Reports lists
// a plugin's reports beside the built-in ones, with the same CSV and PDF export.

/** What a plugin importer hands back: the same shape a built-in parser does. */
export interface PluginImportResult {
  /** ProseMirror document for editor.commands.setContent(). */
  doc: JSONContent;
  /** Title the file carries, or empty to fall back on the file name. */
  title?: string;
  /** Non-fatal notes worth surfacing to the writer. */
  warnings?: string[];
}

export interface PluginImporter {
  id: string;
  /** Shown in the file dialog and in messages, e.g. "Movie Magic Screenwriter (.mmsw)". */
  label: string;
  /** Translation key; `label` is the English default. */
  labelKey?: string;
  /** Lower-case extensions without the dot. A built-in format always wins. */
  extensions: string[];
  /**
   * Read the file as bytes (an ArrayBuffer) rather than as UTF-8 text. Any
   * archive or binary format must say so — decoding one as text corrupts it.
   */
  binary?: boolean;
  parse: (filename: string, data: string | ArrayBuffer) => Promise<PluginImportResult>;
}

/** Everything an exporter or report is given about the open script. */
export interface PluginDocumentContext {
  editor: Editor | null;
  /** The script as the editor holds it. */
  doc: JSONContent;
  /** The script's title, for file names and headings. */
  title: string;
}

export interface PluginExporter {
  id: string;
  /** The File → Export menu label, e.g. "Movie Magic Scheduling (.sex)". */
  label: string;
  /** Translation key; `label` is the English default. */
  labelKey?: string;
  /** Extension of the file written, without the dot. */
  extension: string;
  /** Name of the file-dialog filter. Defaults to the label. */
  filterName?: string;
  export: (ctx: PluginDocumentContext) => Promise<Uint8Array | string>;
}

/** A report as a table: what the Reports dialog shows and exports. */
export interface ReportTable {
  title: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  /** One line under the title — totals, or what the report counts. */
  summary?: string;
}

export interface PluginReport {
  id: string;
  label: string;
  /** Translation key; `label` is the English default. */
  labelKey?: string;
  /** One line shown under the label in the report list. */
  description?: string;
  build: (ctx: PluginDocumentContext) => ReportTable | Promise<ReportTable>;
}

// ── Scene actions ──
//
// Scene Details shows everything a scene holds: who is in it and what they
// wear, where it is set and how the place looks, and its shots. A plugin can
// act on that — make a clip for a shot from those references, say — with a
// button under the scene or on each shot, and can show what it made (a clip's
// thumbnail) beside the shot. Core only gathers the references; making
// anything from them is the plugin's job.

/** An image reference: a project asset, by id. */
export interface PluginSceneImage {
  assetId: string;
  /** What it shows: "Night", "Chef whites", "ANNA". */
  label: string;
}

/** One character as a scene presents them. */
export interface PluginSceneCastMember {
  name: string;
  /** Dialogue blocks in the scene; 0 for someone there without speaking. */
  lines: number;
  /** The character's own images (main first). */
  images: PluginSceneImage[];
  /** Costumes worn in the scene, in order, with when each change happens. */
  costumes: Array<{ id: string; name: string; when: string; image: PluginSceneImage | null }>;
}

/** Everything Scene Details knows about a scene. */
export interface PluginSceneBrief {
  /** Place in the scene list, from 0. */
  index: number;
  /** The heading's stable id, when something has given it one. */
  uid: string | null;
  heading: string;
  number: string | null;
  synopsis: string;
  location: {
    name: string;
    type: 'interior' | 'exterior' | 'both';
    description: string;
    /** The look the scene shows, or null. */
    look: { id: string; name: string; image: PluginSceneImage | null } | null;
    /** What is different about the place in this scene. */
    setting: string;
    images: PluginSceneImage[];
  } | null;
  cast: PluginSceneCastMember[];
  shots: PluginSceneShot[];
}

/** A shot line, with the references Scene Details lists beside it. */
export interface PluginSceneShot {
  /** Place among the scene's shots, from 0. */
  index: number;
  text: string;
  /** The characters the shot names, each with the costume it shows. */
  characters: Array<{ name: string; costume: { id: string; name: string; image: PluginSceneImage | null } | null }>;
}

export interface PluginSceneActionContext {
  editor: Editor | null;
  projectId: string;
  scene: PluginSceneBrief;
  /** The shot, for an action shown on each shot. */
  shot?: PluginSceneShot;
}

export interface PluginSceneAction {
  id: string;
  /** Button text, e.g. "Make clip". */
  label: string;
  /** Translation key; `label` is the English default. */
  labelKey?: string;
  /** Shown once under the scene, or on every shot. */
  target: 'scene' | 'shot';
  run: (ctx: PluginSceneActionContext) => void | Promise<void>;
  /** Hide the button for a scene or shot it cannot act on. */
  available?: (ctx: PluginSceneActionContext) => boolean;
  /** Drawn beside the shot (or under the scene) — a clip's thumbnail, its state. */
  preview?: React.ComponentType<PluginSceneActionContext>;
}

// ── Add-ons: plugins the writer chooses to turn on ──
//
// Plugins marked `optIn` and plugins deployed on the web server are managed in
// Settings → Add-ons. An off add-on contributes no menu items, panels, editor
// extensions, importers, exporters or reports.

/** What an add-on's settings screen is given. */
export interface PluginSettingsProps {
  /**
   * `activate`: shown as the writer turns the add-on on; cancelling leaves it
   * off. `edit`: opened later from Settings → Add-ons while it is on.
   */
  mode: 'activate' | 'edit';
  /**
   * Hand core the function that checks and stores the settings. Core calls it
   * when the writer presses Turn On or Save. Return false — after showing your
   * own message — to keep the dialog open. Call this again whenever the
   * function changes (e.g. from an effect that depends on the form's values).
   */
  registerSave: (save: () => boolean | Promise<boolean>) => void;
}

export interface PluginDeactivateContext {
  /** The writer asked for the add-on's stored settings (keys, addresses) to be deleted. */
  forgetSettings: boolean;
}

export interface OpenDraftPlugin {
  id: string;
  name: string;
  /** Translation key for `name`; `name` is the English default. */
  nameKey?: string;
  version: string;
  /** One or two sentences, shown in Settings → Add-ons. */
  description?: string;
  /** Translation key for `description`. */
  descriptionKey?: string;
  /**
   * An add-on: listed in Settings → Add-ons. Its
   * menu items, panels, editor extensions, importers, exporters and reports
   * are withheld while it is off. Editor extensions take effect the next time
   * a script is opened.
   */
  optIn?: boolean;
  /** Initial state of a bundled add-on. A saved user preference takes priority. */
  defaultEnabled?: boolean;
  /**
   * Plain statement of what leaves the device and where it goes, shown before
   * the writer turns the add-on on. Expected for any add-on that uses the
   * network, e.g. "Sends the text you ask about to the AI server you choose."
   */
  privacy?: string;
  /** Translation key for `privacy`. */
  privacyKey?: string;
  /** Settings screen, shown when the add-on is turned on and from Settings → Add-ons. */
  settings?: React.ComponentType<PluginSettingsProps>;
  /**
   * Called each time an add-on starts working: when the writer turns it on,
   * and when it is registered while already turned on (e.g. at start-up).
   */
  onActivate?: () => void | Promise<void>;
  /** Called when the writer turns the add-on off. */
  onDeactivate?: (ctx: PluginDeactivateContext) => void | Promise<void>;
  menuItems?: PluginMenuEntry[];
  panels?: PluginPanelEntry[];
  routes?: PluginRouteEntry[];
  editorExtensions?: any[];
  importers?: PluginImporter[];
  exporters?: PluginExporter[];
  reports?: PluginReport[];
  /** Buttons Scene Details shows under a scene or on each of its shots. */
  sceneActions?: PluginSceneAction[];
  /**
   * Grammar / writing-suggestion providers, by name. Merged with those added
   * through `registerGrammarProvider`; an add-on's are withheld while it is off.
   */
  grammarProviders?: Record<string, GrammarProvider>;
  /**
   * Runs once, the first time a script's editor is ready while the plugin is
   * active (for an add-on: once it is on). Registered after that, or turned on
   * later, it runs straight away if a script is open. `ctx.editor` follows the
   * editor that is open, so keep `ctx` rather than the editor itself. A throw
   * is logged and does not stop other plugins.
   */
  init?: (ctx: PluginContext) => void | Promise<void>;
  /** Called when the plugin is unregistered. */
  destroy?: () => void;
}

// ── Grammar / writing-suggestion providers ──
//
// Plugins (including OpenDraft-Pro) can register grammar providers that
// supply additional issues — e.g. a cloud LLM or LanguageTool integration —
// alongside the local rule-based provider that ships with core.

export type GrammarSeverity = 'style' | 'grammar';

export interface GrammarIssue {
  /** ProseMirror doc position of the issue start. */
  from: number;
  /** ProseMirror doc position of the issue end. */
  to: number;
  /** Human-readable explanation of the issue. */
  message: string;
  /** Stable identifier for the rule that fired (e.g. "passive", "lt:CONFUSION_RULE"). */
  ruleId: string;
  /** Category — drives underline color and rule grouping. */
  severity: GrammarSeverity;
  /** Optional one-click replacements. */
  suggestions?: string[];
  /** Source provider name (filled in by the registry). */
  source?: string;
}

export type GrammarProvider = (
  text: string,
  baseOffset: number,
  signal: AbortSignal,
) => Promise<GrammarIssue[]>;

export interface RegisteredGrammarProvider {
  name: string;
  provider: GrammarProvider;
}

// ── Registry implementation ──

/** Legacy list of add-ons the writer turned on before defaults were configurable. */
export const ENABLED_ADDONS_KEY = 'opendraft:addons:enabled';
export const ADDON_PREFERENCE_PREFIX = 'opendraft:addons:preference:';

function readLegacyEnabledAddOns(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(ENABLED_ADDONS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[add-ons] ignoring a malformed list of enabled add-ons');
      return new Set();
    }
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch (err) {
    console.warn('[add-ons] could not read the legacy list of enabled add-ons', err);
    return new Set();
  }
}

function readAddOnPreference(id: string): boolean | undefined {
  try {
    const value = globalThis.localStorage?.getItem(ADDON_PREFERENCE_PREFIX + id);
    if (value === 'true' || value === 'false') return value === 'true';
  } catch (err) {
    console.warn(`[add-ons] could not read the preference for ${id}`, err);
  }
}

function writeAddOnPreference(id: string, enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(ADDON_PREFERENCE_PREFIX + id, String(enabled));
  } catch (err) {
    console.warn('[add-ons] could not remember the enabled add-ons; the choice lasts until the app closes', err);
  }
}

export class PluginRegistry {
  private _plugins: Map<string, OpenDraftPlugin> = new Map();
  private _listeners: Array<() => void> = [];
  private _revision = 0;
  private _upgradeHandler: (() => void) | null = null;
  private _grammarProviders: Map<string, GrammarProvider> = new Map();
  private _grammarListeners: Array<() => void> = [];
  private _enabledAddOns = new Set<string>();
  private _legacyEnabledAddOns: Set<string> | null = null;
  private _runtimeAddOnDefaults: ReadonlyMap<string, boolean> = new Map();
  /** The editor open right now, as reported by the screenplay editor. */
  private _editor: Editor | null = null;
  /** Plugins whose `init` has run (or is running). */
  private _initialised: Set<string> = new Set();
  /** The context every `init` receives: `editor` reads the live editor. */
  private readonly _context: PluginContext;

  constructor() {
    const current = (): Editor | null => this._editor;
    this._context = {
      get editor() { return current(); },
    };
  }

  /** Plugins whose contributions reach the app. */
  private _active(): OpenDraftPlugin[] {
    return Array.from(this._plugins.values()).filter((p) => !p.optIn || this.isAddOnEnabled(p.id));
  }

  private async _runActivate(plugin: OpenDraftPlugin): Promise<void> {
    if (!plugin.onActivate) return;
    await plugin.onActivate();
  }

  /**
   * Pro registers a callback that opens its tier-picker / checkout flow.
   * Core calls it from QuotaExceededDialog when the user clicks "Upgrade".
   * If no handler is registered, core hides the Upgrade button.
   */
  registerUpgradeHandler(handler: () => void): void {
    this._upgradeHandler = handler;
  }

  getUpgradeHandler(): (() => void) | null {
    return this._upgradeHandler;
  }

  /** Called before loading deployed plugins, which are all managed as add-ons. */
  setRuntimeAddOnDefaults(defaults: ReadonlyMap<string, boolean>): void {
    this._runtimeAddOnDefaults = defaults;
  }

  /** Register a plugin. Replaces any existing plugin with the same id. */
  register(plugin: OpenDraftPlugin): void {
    const runtimeDefault = this._runtimeAddOnDefaults.get(plugin.id);
    if (runtimeDefault !== undefined && !plugin.optIn) plugin = { ...plugin, optIn: true };
    this._plugins.set(plugin.id, plugin);
    // A replacement under the same id is a new plugin: its own init runs.
    this._initialised.delete(plugin.id);
    this._enabledAddOns.delete(plugin.id);
    if (plugin.optIn && this._startsEnabled(plugin.id, runtimeDefault ?? plugin.defaultEnabled ?? false)) {
      this._enabledAddOns.add(plugin.id);
      this._runActivate(plugin).catch((err) => {
        console.error(`[add-ons] ${plugin.id} could not start`, err);
      });
    }
    this._notify(plugin);
    void this._initPending();
  }

  // ── Add-ons ──

  private _startsEnabled(id: string, defaultEnabled: boolean): boolean {
    const preference = readAddOnPreference(id);
    if (preference !== undefined) return preference;
    this._legacyEnabledAddOns ??= readLegacyEnabledAddOns();
    return this._legacyEnabledAddOns.has(id) || defaultEnabled;
  }

  /** Every add-on, on or off, sorted by name — for Settings → Add-ons. */
  getAddOns(): OpenDraftPlugin[] {
    return Array.from(this._plugins.values())
      .filter((p) => p.optIn)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Whether the add-on is on. */
  isAddOnEnabled(id: string): boolean {
    return this._enabledAddOns.has(id);
  }

  /** Whether a registered plugin's contributions reach the app right now. */
  isActive(id: string): boolean {
    const plugin = this._plugins.get(id);
    return !!plugin && (!plugin.optIn || this.isAddOnEnabled(id));
  }

  /**
   * Turn an add-on on. The choice is remembered on this device. If the
   * add-on's `onActivate` throws, it is left off and the error is rethrown
   * for the caller to show.
   */
  async enableAddOn(id: string): Promise<void> {
    const plugin = this._plugins.get(id);
    if (!plugin) throw new Error(`No add-on called "${id}" is installed.`);
    if (!plugin.optIn) throw new Error(`"${plugin.name}" is part of the app and cannot be turned on or off.`);
    if (this.isAddOnEnabled(id)) return;
    this._enabledAddOns.add(id);
    try {
      await this._runActivate(plugin);
    } catch (err) {
      this._enabledAddOns.delete(id);
      console.error(`[add-ons] ${id} could not be turned on`, err);
      this._notify(plugin);
      throw new Error(`${plugin.name} could not be turned on: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (this._plugins.get(id) !== plugin || !this.isAddOnEnabled(id)) return;
    writeAddOnPreference(id, true);
    this._notify(plugin);
    await this._initPending();
  }

  /**
   * Turn an add-on off. Its contributions are withdrawn at once, even if its
   * own `onDeactivate` fails — an add-on the writer turned off never keeps
   * running.
   */
  async disableAddOn(id: string, ctx: PluginDeactivateContext = { forgetSettings: false }): Promise<void> {
    const plugin = this._plugins.get(id);
    if (!this._enabledAddOns.delete(id)) return;
    writeAddOnPreference(id, false);
    this._notify(plugin);
    if (!plugin?.onDeactivate) return;
    try {
      await plugin.onDeactivate(ctx);
    } catch (err) {
      console.error(`[add-ons] ${id} reported an error while turning off`, err);
      throw new Error(
        `${plugin.name} is off, but it could not finish cleaning up: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Unregister a plugin by id. Calls destroy() if defined. */
  unregister(id: string): void {
    const plugin = this._plugins.get(id);
    if (plugin?.destroy) {
      try {
        plugin.destroy();
      } catch (err) {
        console.error(`[plugins] ${id} reported an error while being removed`, err);
      }
    }
    this._plugins.delete(id);
    this._enabledAddOns.delete(id);
    this._initialised.delete(id);
    this._notify(plugin);
  }

  /** Get all registered plugins. */
  getAll(): OpenDraftPlugin[] {
    return Array.from(this._plugins.values());
  }

  /** Get menu items for a specific menu section, sorted by order. */
  getMenuItems(section: MenuSection): PluginMenuEntry[] {
    const items: PluginMenuEntry[] = [];
    for (const plugin of this._active()) {
      if (plugin.menuItems) {
        items.push(...plugin.menuItems.filter((m) => m.section === section));
      }
    }
    return items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  /** Get panels registered for a specific slot, sorted by order. */
  getPanels(slot: string): PluginPanelEntry[] {
    const panels: PluginPanelEntry[] = [];
    for (const plugin of this._active()) {
      if (plugin.panels) {
        panels.push(...plugin.panels.filter((p) => p.slot === slot));
      }
    }
    return panels.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  /** Get plugin routes that ADD new paths (not overrides of built-ins). */
  getRoutes(): PluginRouteEntry[] {
    const routes: PluginRouteEntry[] = [];
    for (const plugin of this._active()) {
      if (plugin.routes) {
        routes.push(...plugin.routes.filter((r) => !r.override));
      }
    }
    return routes;
  }

  /** Look up an override for a built-in route path. Returns the
   *  registered component, or null if no plugin overrides this path.
   *  Last-registered wins on conflicts. */
  getRouteOverride(path: string): React.ComponentType<any> | null {
    let component: React.ComponentType<any> | null = null;
    for (const plugin of this._active()) {
      if (!plugin.routes) continue;
      for (const r of plugin.routes) {
        if (r.override && r.path === path) component = r.component;
      }
    }
    return component;
  }

  /** Get all editor extensions from plugins. */
  getEditorExtensions(): any[] {
    const extensions: any[] = [];
    for (const plugin of this._active()) {
      if (plugin.editorExtensions) extensions.push(...plugin.editorExtensions);
    }
    return extensions;
  }

  /** Every plugin importer, in registration order. */
  getImporters(): PluginImporter[] {
    const importers: PluginImporter[] = [];
    for (const plugin of this._active()) {
      if (plugin.importers) importers.push(...plugin.importers);
    }
    return importers;
  }

  /** The importer that reads `ext` (no dot, any case), or null. First registered wins. */
  getImporterFor(ext: string): PluginImporter | null {
    const wanted = ext.toLowerCase();
    return this.getImporters().find((i) => i.extensions.some((e) => e.toLowerCase() === wanted)) ?? null;
  }

  /** Every plugin exporter, in registration order. */
  getExporters(): PluginExporter[] {
    const exporters: PluginExporter[] = [];
    for (const plugin of this._active()) {
      if (plugin.exporters) exporters.push(...plugin.exporters);
    }
    return exporters;
  }

  /** Every plugin report, in registration order. */
  getReports(): PluginReport[] {
    const reports: PluginReport[] = [];
    for (const plugin of this._active()) {
      if (plugin.reports) reports.push(...plugin.reports);
    }
    return reports;
  }

  /** Every plugin scene action, in registration order. */
  getSceneActions(): PluginSceneAction[] {
    const actions: PluginSceneAction[] = [];
    for (const plugin of this._active()) {
      if (plugin.sceneActions) actions.push(...plugin.sceneActions);
    }
    return actions;
  }

  // ── The open editor and plugin init ──

  /**
   * The screenplay editor calls this when its editor is ready, and with null
   * when it goes away. The first time there is an editor, every active
   * plugin's `init` runs.
   */
  setEditor(editor: Editor | null): Promise<void> {
    this._editor = editor;
    return this._initPending();
  }

  /** Forget `editor` if it is still the open one (an unmounting editor calls this). */
  releaseEditor(editor: Editor): void {
    if (this._editor === editor) this._editor = null;
  }

  /** The editor open right now, or null. */
  getEditor(): Editor | null {
    return this._editor;
  }

  /** Run `init` for every active plugin with an editor at hand. Same as `setEditor(ctx.editor)`. */
  initAll(ctx: PluginContext): Promise<void> {
    return this.setEditor(ctx.editor);
  }

  /** Run `init` for active plugins that have not had it yet, once an editor exists. */
  private async _initPending(): Promise<void> {
    if (!this._editor) return;
    for (const plugin of this._active()) {
      if (!plugin.init || this._initialised.has(plugin.id)) continue;
      // The script closed while an earlier init ran: the rest wait for the next one.
      if (!this._editor) return;
      this._initialised.add(plugin.id);
      try {
        await plugin.init(this._context);
      } catch (err) {
        console.error(`[plugins] ${plugin.id} could not start`, err);
      }
    }
  }

  /** Subscribe to registry changes (plugin added/removed). Returns unsubscribe. */
  subscribe = (listener: () => void): (() => void) => {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  };

  getRevision = (): number => this._revision;

  private _notify(changed?: OpenDraftPlugin): void {
    this._revision += 1;
    for (const listener of this._listeners) listener();
    // A plugin with grammar providers coming or going (or such an add-on
    // turned on or off) changes the providers too: the editor rescans.
    if (changed?.grammarProviders && Object.keys(changed.grammarProviders).length > 0) {
      this._notifyGrammar();
    }
  }

  // ── Document data ──
  //
  // Each plugin can keep one JSON value inside the open script, under its own
  // id. It is saved and reopened with the script, carried through .odraft,
  // backups, FDX and Fountain, and synced to collaborators. Core keeps an
  // entry even while its plugin is off or not installed, so a script never
  // loses a plugin's data by being opened without it.

  /**
   * The value `pluginId` keeps in the open script, or undefined. Treat it as
   * read-only: change it through `setDocumentData`.
   */
  getDocumentData<T = unknown>(pluginId: string): T | undefined {
    return usePluginDataStore.getState().data[pluginId] as T | undefined;
  }

  /**
   * Keep `value` in the open script under `pluginId` (undefined removes it).
   * The value is stored as a JSON copy and the script is marked for saving.
   * Throws, with a message fit to show, when the value is not JSON or is over
   * the size limit (2 MB serialized).
   */
  setDocumentData(pluginId: string, value: unknown): void {
    if (!pluginId) throw new Error('setDocumentData needs the plugin id.');
    const entry = value === undefined ? undefined : toStorableEntry(pluginId, value);
    usePluginDataStore.getState().setEntry(pluginId, entry);
  }

  /**
   * Listen for any change to the open script's plugin data — a plugin's own
   * writes, a script opened or imported, a collaborator's edit. Returns
   * unsubscribe. Read the new value with `getDocumentData`.
   */
  subscribeDocumentData(listener: () => void): () => void {
    return usePluginDataStore.subscribe((state, prev) => {
      if (state.data === prev.data) return;
      try {
        listener();
      } catch (err) {
        console.error('[plugins] a document-data listener failed', err);
      }
    });
  }

  // ── Grammar providers ──

  /** Register a grammar provider. Replaces any existing provider with the same name. */
  registerGrammarProvider(name: string, provider: GrammarProvider): void {
    this._grammarProviders.set(name, provider);
    this._notifyGrammar();
  }

  /** Remove a grammar provider by name. */
  unregisterGrammarProvider(name: string): void {
    this._grammarProviders.delete(name);
    this._notifyGrammar();
  }

  /** Get all registered grammar providers, in insertion order. */
  getGrammarProviders(): RegisteredGrammarProvider[] {
    const providers = new Map(this._grammarProviders);
    for (const plugin of this._active()) {
      for (const [name, provider] of Object.entries(plugin.grammarProviders ?? {})) {
        // One registered by name directly wins, as it always has.
        if (!providers.has(name)) providers.set(name, provider);
      }
    }
    return Array.from(providers.entries()).map(([name, provider]) => ({ name, provider }));
  }

  /** Subscribe to grammar provider registry changes. Returns unsubscribe. */
  subscribeGrammar(listener: () => void): () => void {
    this._grammarListeners.push(listener);
    return () => {
      this._grammarListeners = this._grammarListeners.filter((l) => l !== listener);
    };
  }

  private _notifyGrammar(): void {
    for (const listener of this._grammarListeners) listener();
  }
}

export const pluginRegistry = new PluginRegistry();
