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

export interface PluginMenuEntry {
  id: string;
  section: MenuSection;
  label: string;
  action: (ctx: PluginContext) => void;
  shortcut?: string;
  order?: number;
  disabled?: boolean | ((ctx: PluginContext) => boolean);
  separator?: boolean;
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

// ── Registry implementation ──

class PluginRegistry {
  private _plugins: Map<string, OpenDraftPlugin> = new Map();
  private _listeners: Array<() => void> = [];

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
}

export const pluginRegistry = new PluginRegistry();
