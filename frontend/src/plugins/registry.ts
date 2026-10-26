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

// ── Plugin types ──

export type MenuSection = 'File' | 'Edit' | 'Format' | 'View' | 'Production' | 'Tools' | 'Help';

export interface PluginContext {
  editor: Editor | null;
}

export interface PluginMenuChildEntry {
  id: string;
  label: string;
  action?: (ctx: PluginContext) => void;
  shortcut?: string;
  disabled?: boolean | ((ctx: PluginContext) => boolean);
  separator?: boolean;
  icon?: string;
}

export interface PluginMenuEntry {
  id: string;
  section: MenuSection;
  label: string;
  action?: (ctx: PluginContext) => void;
  shortcut?: string;
  order?: number;
  disabled?: boolean | ((ctx: PluginContext) => boolean);
  separator?: boolean;
  children?: PluginMenuChildEntry[];
  icon?: string;
}

export interface PluginPanelEntry {
  id: string;
  slot: 'right-sidebar' | 'bottom-panel' | 'toolbar' | 'status-bar';
  component: React.ComponentType<any>;
  label: string;
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
  /** Shown in the file dialog and in messages, e.g. "WriterDuet (.wdz)". */
  label: string;
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
  /** One line shown under the label in the report list. */
  description?: string;
  build: (ctx: PluginDocumentContext) => ReportTable | Promise<ReportTable>;
}

export interface OpenDraftPlugin {
  id: string;
  name: string;
  version: string;
  menuItems?: PluginMenuEntry[];
  panels?: PluginPanelEntry[];
  routes?: PluginRouteEntry[];
  editorExtensions?: any[];
  importers?: PluginImporter[];
  exporters?: PluginExporter[];
  reports?: PluginReport[];
  init?: (ctx: PluginContext) => Promise<void>;
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

class PluginRegistry {
  private _plugins: Map<string, OpenDraftPlugin> = new Map();
  private _listeners: Array<() => void> = [];
  private _upgradeHandler: (() => void) | null = null;
  private _grammarProviders: Map<string, GrammarProvider> = new Map();
  private _grammarListeners: Array<() => void> = [];

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

  /** Register a plugin. Replaces any existing plugin with the same id. */
  register(plugin: OpenDraftPlugin): void {
    this._plugins.set(plugin.id, plugin);
    this._notify();
  }

  /** Unregister a plugin by id. Calls destroy() if defined. */
  unregister(id: string): void {
    const plugin = this._plugins.get(id);
    if (plugin?.destroy) plugin.destroy();
    this._plugins.delete(id);
    this._notify();
  }

  /** Get all registered plugins. */
  getAll(): OpenDraftPlugin[] {
    return Array.from(this._plugins.values());
  }

  /** Get menu items for a specific menu section, sorted by order. */
  getMenuItems(section: MenuSection): PluginMenuEntry[] {
    const items: PluginMenuEntry[] = [];
    for (const plugin of this._plugins.values()) {
      if (plugin.menuItems) {
        items.push(...plugin.menuItems.filter((m) => m.section === section));
      }
    }
    return items.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  /** Get panels registered for a specific slot, sorted by order. */
  getPanels(slot: string): PluginPanelEntry[] {
    const panels: PluginPanelEntry[] = [];
    for (const plugin of this._plugins.values()) {
      if (plugin.panels) {
        panels.push(...plugin.panels.filter((p) => p.slot === slot));
      }
    }
    return panels.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  }

  /** Get plugin routes that ADD new paths (not overrides of built-ins). */
  getRoutes(): PluginRouteEntry[] {
    const routes: PluginRouteEntry[] = [];
    for (const plugin of this._plugins.values()) {
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
    for (const plugin of this._plugins.values()) {
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
    for (const plugin of this._plugins.values()) {
      if (plugin.editorExtensions) extensions.push(...plugin.editorExtensions);
    }
    return extensions;
  }

  /** Every plugin importer, in registration order. */
  getImporters(): PluginImporter[] {
    const importers: PluginImporter[] = [];
    for (const plugin of this._plugins.values()) {
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
    for (const plugin of this._plugins.values()) {
      if (plugin.exporters) exporters.push(...plugin.exporters);
    }
    return exporters;
  }

  /** Every plugin report, in registration order. */
  getReports(): PluginReport[] {
    const reports: PluginReport[] = [];
    for (const plugin of this._plugins.values()) {
      if (plugin.reports) reports.push(...plugin.reports);
    }
    return reports;
  }

  /** Initialize all plugins. Call once after the editor is ready. */
  async initAll(ctx: PluginContext): Promise<void> {
    for (const plugin of this._plugins.values()) {
      if (plugin.init) {
        try {
          await plugin.init(ctx);
        } catch (err) {
          console.error(`Plugin ${plugin.id} init failed:`, err);
        }
      }
    }
  }

  /** Subscribe to registry changes (plugin added/removed). Returns unsubscribe. */
  subscribe(listener: () => void): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  private _notify(): void {
    for (const listener of this._listeners) listener();
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
    return Array.from(this._grammarProviders.entries()).map(([name, provider]) => ({ name, provider }));
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
