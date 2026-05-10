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

import type { Editor } from '@tiptap/core';

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
}

export interface OpenDraftPlugin {
  id: string;
  name: string;
  version: string;
  menuItems?: PluginMenuEntry[];
  panels?: PluginPanelEntry[];
  routes?: PluginRouteEntry[];
  editorExtensions?: any[];
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

  /** Get all plugin routes. */
  getRoutes(): PluginRouteEntry[] {
    const routes: PluginRouteEntry[] = [];
    for (const plugin of this._plugins.values()) {
      if (plugin.routes) routes.push(...plugin.routes);
    }
    return routes;
  }

  /** Get all editor extensions from plugins. */
  getEditorExtensions(): any[] {
    const extensions: any[] = [];
    for (const plugin of this._plugins.values()) {
      if (plugin.editorExtensions) extensions.push(...plugin.editorExtensions);
    }
    return extensions;
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
