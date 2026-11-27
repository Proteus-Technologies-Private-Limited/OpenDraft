/**
 * Load the runtime plugins the server offers (web app only).
 *
 * The server lists the plugin folders it has at `/api/plugins`
 * (backend/app/frontend_plugins.py). For each, the loader adds its style sheet
 * and script. A plugin's script runs none of its own code when it loads: its
 * build wraps it so loading only hands the app a function —
 *
 *   (globalThis.__OPENDRAFT_PLUGIN_QUEUE__ ||= []).push(['od-sidekick', function () { … }]);
 *
 * — which the loader then runs inside try/catch. So a plugin that throws,
 * or reaches for a shared module this app does not have, is logged and skipped,
 * and the app starts as if it were not there. The same goes for a server
 * without the endpoint, a slow one, or a script that fails to load.
 *
 * A plugin's style sheet is added before its script runs. If the script fails
 * to load, or loads without registering a plugin under its id, the sheet is
 * removed again. A registered add-on that is off keeps its sheet, disabled, so
 * turning it on needs no reload; the sheet follows the add-on on and off.
 *
 * The desktop and mobile apps have no server: they include plugins at build
 * time (frontend/vite.plugins.ts), and this does nothing there.
 */
import { getApiBase } from '../config';
import { isTauri } from '../services/platform';
import { pluginRegistry } from './registry';
import { installRuntimeHost, RUNTIME_PLUGIN_API_VERSION } from './runtimeHost';

export interface RuntimePluginInfo {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  /**
   * The admin's or the manifest's default, or null when neither set one: a
   * plain plugin then starts on (as before deployed plugins became add-ons)
   * and an opt-in one off. Either way an add-on that declares what leaves the
   * device, or has settings, waits for the writer (see registry.ts).
   */
  defaultEnabled: boolean | null;
  /** URL of the script, from the server root. */
  script: string;
  /** URL of the style sheet, or null. */
  style: string | null;
}

type QueuedPlugin = [id: string, run: () => void];

interface PluginQueue {
  push: (...entries: QueuedPlugin[]) => number;
}

declare global {
  var __OPENDRAFT_PLUGIN_QUEUE__: PluginQueue | QueuedPlugin[] | undefined;
  interface Window {
    /** Set while plugin scripts load, so index.html's start-up error screen ignores them. */
    __odLoadingPlugins?: boolean;
  }
}

/** How long start-up waits for the list and the scripts, at most. */
export const RUNTIME_PLUGIN_BUDGET_MS = 4000;

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The server's list, keeping only well-formed entries. */
export function parsePluginList(raw: unknown): RuntimePluginInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: RuntimePluginInfo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== 'string' || !ID.test(p.id) || typeof p.script !== 'string' || !p.script) {
      console.warn('[plugins] ignoring a malformed entry from the server', item);
      continue;
    }
    out.push({
      id: p.id,
      name: typeof p.name === 'string' ? p.name : p.id,
      version: typeof p.version === 'string' ? p.version : '',
      apiVersion: typeof p.apiVersion === 'number' ? p.apiVersion : 0,
      defaultEnabled: typeof p.defaultEnabled === 'boolean' ? p.defaultEnabled : null,
      script: p.script,
      style: typeof p.style === 'string' && p.style ? p.style : null,
    });
  }
  return out;
}

/** Run one queued plugin, containing anything it throws. Returns whether it ran cleanly. */
export function runQueuedPlugin([id, run]: QueuedPlugin): boolean {
  if (typeof run !== 'function') {
    console.error(`[plugins] ${id}: its script did not hand over a function; skipped`);
    return false;
  }
  if (pluginRegistry.getAll().some((p) => p.id === id)) {
    console.info(`[plugins] ${id} is already built into this app; the server's copy was not loaded`);
    return false;
  }
  try {
    run();
    return true;
  } catch (err) {
    console.error(`[plugins] ${id} failed to start and was skipped`, err);
    return false;
  }
}

/** Make the queue run plugins as their scripts hand them over, and drain any already waiting. */
function installQueue(): void {
  const existing = globalThis.__OPENDRAFT_PLUGIN_QUEUE__;
  const waiting = Array.isArray(existing) ? existing : [];
  globalThis.__OPENDRAFT_PLUGIN_QUEUE__ = {
    push: (...entries: QueuedPlugin[]) => {
      for (const entry of entries) runQueuedPlugin(entry);
      return 0;
    },
  };
  for (const entry of waiting) runQueuedPlugin(entry);
}

function serverRoot(): string {
  return getApiBase().replace(/\/api\/?$/, '');
}

function styleSheetsOf(id: string): HTMLLinkElement[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLLinkElement>('link[data-opendraft-plugin="style"]'))
    .filter((link) => link.dataset.opendraftPluginId === id);
}

/** Take a plugin's style sheet off the page: its script never started a plugin. */
export function removePluginStyle(id: string): void {
  for (const link of styleSheetsOf(id)) link.remove();
}

/** Apply each runtime plugin's sheet only while the plugin is active (an add-on that is on). */
function syncPluginStyles(ids: readonly string[]): void {
  for (const id of ids) {
    const active = pluginRegistry.isActive(id);
    for (const link of styleSheetsOf(id)) link.disabled = !active;
  }
}

let styleSync: (() => void) | null = null;

function watchPluginStyles(ids: readonly string[]): void {
  styleSync?.();
  syncPluginStyles(ids);
  styleSync = pluginRegistry.subscribe(() => syncPluginStyles(ids));
}

function addStyle(id: string, url: string): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.opendraftPlugin = 'style';
  link.dataset.opendraftPluginId = id;
  link.onerror = () => console.warn(`[plugins] could not load the style sheet ${url}`);
  document.head.appendChild(link);
}

/** Resolves true once the script ran, false if it failed, null if it is still loading when time runs out. */
function addScript(url: string, timeoutMs: number, onFailed: () => void): Promise<boolean | null> {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = false; // run in the server's order
    script.dataset.opendraftPlugin = 'script';
    const timer = setTimeout(() => {
      console.warn(`[plugins] ${url} is taking long to load; the app starts without waiting for it`);
      resolve(null);
    }, timeoutMs);
    script.onload = () => { clearTimeout(timer); resolve(true); };
    script.onerror = () => {
      clearTimeout(timer);
      console.error(`[plugins] could not load ${url}`);
      onFailed();
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

export interface LoadOptions {
  /** The list, as the server gives it (a test passes its own). */
  fetchList?: (signal: AbortSignal) => Promise<unknown>;
  /**
   * Add the plugin's files to the page (a test passes its own). Resolves true
   * once the script ran, false if it failed, null if it is still loading.
   */
  addFiles?: (plugin: RuntimePluginInfo, url: (path: string) => string, timeoutMs: number) => Promise<boolean | null>;
  budgetMs?: number;
}

async function defaultFetchList(signal: AbortSignal): Promise<unknown> {
  const res = await fetch(`${getApiBase()}/plugins`, { signal, credentials: 'omit' });
  // A server from before runtime plugins answers 404 (or the SPA): no plugins.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return [];
  return res.json();
}

async function defaultAddFiles(plugin: RuntimePluginInfo, url: (path: string) => string, timeoutMs: number): Promise<boolean | null> {
  if (plugin.style) addStyle(plugin.id, url(plugin.style));
  // Also when the script fails after the start-up budget ran out.
  return addScript(url(plugin.script), timeoutMs, () => removePluginStyle(plugin.id));
}

/**
 * Load every runtime plugin the server offers. Never throws and never takes
 * longer than the budget; returns the ids of the plugins that started.
 */
export async function loadRuntimePlugins(options: LoadOptions = {}): Promise<string[]> {
  if (isTauri()) return [];
  const { fetchList = defaultFetchList, addFiles = defaultAddFiles, budgetMs = RUNTIME_PLUGIN_BUDGET_MS } = options;
  const started = Date.now();
  const left = () => Math.max(0, budgetMs - (Date.now() - started));

  let plugins: RuntimePluginInfo[];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(2000, budgetMs));
  try {
    plugins = parsePluginList(await fetchList(controller.signal));
  } catch (err) {
    if ((err as Error)?.name !== 'AbortError') console.warn('[plugins] could not ask the server for plugins', err);
    return [];
  } finally {
    clearTimeout(timer);
  }
  if (plugins.length === 0) return [];

  const root = serverRoot();
  const url = (p: string) => (/^https?:\/\//.test(p) ? p : `${root}${p.startsWith('/') ? '' : '/'}${p}`);

  const before = new Set(pluginRegistry.getAll().map((p) => p.id));
  const usable = plugins.filter((plugin) => {
    if (plugin.apiVersion < 1 || plugin.apiVersion > RUNTIME_PLUGIN_API_VERSION) {
      console.warn(`[plugins] ${plugin.id} needs plugin API ${plugin.apiVersion}; this app offers ${RUNTIME_PLUGIN_API_VERSION}`);
      return false;
    }
    if (before.has(plugin.id)) {
      console.info(`[plugins] ${plugin.id} is already built into this app; the server's copy was not loaded`);
      return false;
    }
    return true;
  });
  pluginRegistry.setRuntimeAddOnDefaults(new Map(usable.map((plugin) => [plugin.id, plugin.defaultEnabled])));
  installRuntimeHost();
  installQueue();

  if (typeof window !== 'undefined') window.__odLoadingPlugins = true;
  /** Plugins whose script ran (true) or failed (false); a script still loading has no entry. */
  const outcome = new Map<string, boolean>();
  try {
    await Promise.all(usable.map(async (plugin) => {
      try {
        const ran = await addFiles(plugin, url, left());
        if (ran !== null) outcome.set(plugin.id, ran);
      } catch (err) {
        outcome.set(plugin.id, false);
        console.error(`[plugins] could not load ${plugin.id}`, err);
      }
    }));
  } finally {
    if (typeof window !== 'undefined') window.__odLoadingPlugins = false;
  }

  const registered = (id: string) => pluginRegistry.getAll().some((p) => p.id === id);
  const loaded = usable.map((p) => p.id).filter(registered);
  for (const plugin of usable) {
    if (loaded.includes(plugin.id)) continue;
    if (outcome.get(plugin.id) === true) {
      console.warn(`[plugins] ${plugin.id} loaded but did not register a plugin under that id; its style sheet was removed`);
      removePluginStyle(plugin.id);
    } else if (outcome.get(plugin.id) === false) {
      removePluginStyle(plugin.id);
    }
    // No outcome: the script missed the start-up budget and may still register;
    // its sheet stays, disabled until it does (and removed if it fails).
  }
  watchPluginStyles(usable.map((p) => p.id));
  if (loaded.length) console.info(`[plugins] started ${loaded.join(', ')} from the server`);
  return loaded;
}
