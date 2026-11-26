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

function addStyle(url: string): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.opendraftPlugin = 'style';
  link.onerror = () => console.warn(`[plugins] could not load the style sheet ${url}`);
  document.head.appendChild(link);
}

function addScript(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = false; // run in the server's order
    script.dataset.opendraftPlugin = 'script';
    const timer = setTimeout(() => {
      console.warn(`[plugins] ${url} is taking long to load; the app starts without waiting for it`);
      resolve(false);
    }, timeoutMs);
    script.onload = () => { clearTimeout(timer); resolve(true); };
    script.onerror = () => {
      clearTimeout(timer);
      console.error(`[plugins] could not load ${url}`);
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

export interface LoadOptions {
  /** The list, as the server gives it (a test passes its own). */
  fetchList?: (signal: AbortSignal) => Promise<unknown>;
  /** Add the plugin's files to the page (a test passes its own). */
  addFiles?: (plugin: RuntimePluginInfo, url: (path: string) => string, timeoutMs: number) => Promise<boolean>;
  budgetMs?: number;
}

async function defaultFetchList(signal: AbortSignal): Promise<unknown> {
  const res = await fetch(`${getApiBase()}/plugins`, { signal, credentials: 'omit' });
  // A server from before runtime plugins answers 404 (or the SPA): no plugins.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return [];
  return res.json();
}

async function defaultAddFiles(plugin: RuntimePluginInfo, url: (path: string) => string, timeoutMs: number): Promise<boolean> {
  if (plugin.style) addStyle(url(plugin.style));
  return addScript(url(plugin.script), timeoutMs);
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

  installRuntimeHost();
  installQueue();
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

  if (typeof window !== 'undefined') window.__odLoadingPlugins = true;
  try {
    await Promise.all(usable.map(async (plugin) => {
      try {
        await addFiles(plugin, url, left());
      } catch (err) {
        console.error(`[plugins] could not load ${plugin.id}`, err);
      }
    }));
  } finally {
    if (typeof window !== 'undefined') window.__odLoadingPlugins = false;
  }

  const loaded = usable.map((p) => p.id).filter((id) => pluginRegistry.getAll().some((p) => p.id === id));
  for (const plugin of usable) {
    if (!loaded.includes(plugin.id)) console.warn(`[plugins] ${plugin.id} loaded but did not register a plugin under that id`);
  }
  if (loaded.length) console.info(`[plugins] started ${loaded.join(', ')} from the server`);
  return loaded;
}
