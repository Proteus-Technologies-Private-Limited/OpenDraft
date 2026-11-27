/**
 * Build-time plugins: compile plugins that live in other repositories into
 * this build of the app — web, desktop and mobile alike.
 *
 * Set OPENDRAFT_PLUGINS to one or more plugin entry modules (separated by the
 * platform's path delimiter, `:` on macOS/Linux and `;` on Windows; absolute,
 * or relative to frontend/). Each entry registers its plugin with
 * `pluginRegistry.register()` when imported. main.tsx imports them all, first,
 * through the `virtual:opendraft-plugins` module, so every plugin is in the
 * registry before the app renders:
 *
 *   OPENDRAFT_PLUGINS=../../OD-Sidekick/src/register.ts npm run build
 *   OPENDRAFT_PLUGINS=$PWD/../OD-Sidekick/src/register.ts frontend/node_modules/.bin/tauri build
 *
 * Unset — every normal build — the virtual module is empty and the app is
 * exactly as before.
 *
 * The plugin's code is compiled in, never fetched at run time, so it is part
 * of the reviewed binary (App Store guideline 2.5.2 forbids downloading code).
 *
 * A plugin imports `@core/…` for core's modules, and its package imports
 * (`react`, `@tiptap/pm/state`, `react-i18next` …) are resolved from this
 * app's node_modules, as if core had imported them: one copy of React and of
 * ProseMirror in the bundle, whatever the plugin's own folder holds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, type Plugin } from 'vite';

const FRONTEND = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(FRONTEND, 'src');
const VIRTUAL_ID = 'virtual:opendraft-plugins';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

/** The plugin entry files OPENDRAFT_PLUGINS names, checked to exist. */
export function buildTimePluginEntries(value = process.env.OPENDRAFT_PLUGINS): string[] {
  const entries = (value ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(FRONTEND, entry));
  const missing = entries.filter((entry) => !fs.existsSync(entry));
  if (missing.length) {
    throw new Error(`OPENDRAFT_PLUGINS names a plugin entry that does not exist: ${missing.join(', ')}`);
  }
  return entries;
}

/** The folder a plugin lives in: the nearest one above its entry with a package.json. */
function pluginRoot(entry: string): string {
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return path.dirname(entry);
}

function isBareImport(source: string): boolean {
  return !/^(\.|\/|\\|\0|[a-zA-Z]:|virtual:|node:)/.test(source) && !source.startsWith('@core/');
}

/**
 * A test for "is this module one of the plugins' own files (not one of their
 * node_modules)?".
 *
 * Vite's module ids always use `/`, but `path.resolve` gives `\` on Windows,
 * so both sides go through Vite's `normalizePath` (`normalize`, swappable for
 * tests) and are compared with `/`.
 */
export function pluginFileMatcher(
  roots: string[],
  normalize: (p: string) => string = normalizePath,
): (file: string) => boolean {
  const prefixes = roots.map((root) => normalize(root).replace(/\/+$/, '') + '/');
  return (file: string) => {
    const id = normalize(file);
    return prefixes.some((prefix) => id.startsWith(prefix)) && !id.includes('/node_modules/');
  };
}

export function buildTimePlugins(entries = buildTimePluginEntries()): Plugin {
  const roots = [...new Set(entries.map(pluginRoot))].filter((root) => !FRONTEND.startsWith(root + path.sep) && root !== FRONTEND);
  const inPlugin = pluginFileMatcher(roots);
  const coreImporter = path.join(SRC, 'main.tsx');

  return {
    name: 'opendraft:build-time-plugins',
    enforce: 'pre',
    config() {
      if (!entries.length) return;
      // Plugin folders sit outside frontend/; the dev server may serve them.
      return { server: { fs: { allow: [FRONTEND, ...roots] } } };
    },
    configResolved(config) {
      if (entries.length) {
        config.logger.info(`OpenDraft: building with ${entries.length} plugin${entries.length === 1 ? '' : 's'}: ${entries.join(', ')}`);
      }
    },
    async resolveId(source, importer, options) {
      if (source === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
      if (!importer || !entries.length) return null;
      const from = importer.split('?')[0];
      if (!inPlugin(from)) return null;
      if (source.startsWith('@core/')) {
        return this.resolve(path.join(SRC, source.slice('@core/'.length)), importer, { ...options, skipSelf: true });
      }
      if (!isBareImport(source)) return null;
      const resolved = await this.resolve(source, coreImporter, { ...options, skipSelf: true });
      if (!resolved) this.warn(`"${source}", imported by the plugin file ${from}, is not installed in OpenDraft.`);
      return resolved;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return null;
      if (!entries.length) return '// No build-time plugins (OPENDRAFT_PLUGINS is not set).\nexport {};\n';
      return `${entries.map((entry) => `import ${JSON.stringify(normalizePath(entry))};`).join('\n')}\nexport {};\n`;
    },
  };
}
