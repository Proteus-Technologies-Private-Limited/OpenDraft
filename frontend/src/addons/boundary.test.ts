/**
 * Every core add-on goes through the plugin architecture: it is an opt-in
 * plugin registered from addons/index.ts, and no other part of the app reaches
 * into an add-on directly — an add-on wired straight into the editor, toolbar
 * or menus could not be turned off.
 */
import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CORE_ADDONS, addOnProblem, registerCoreAddOns } from './index';
import { pluginRegistry, type OpenDraftPlugin } from '../plugins/registry';

const SRC = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

describe('core add-ons', () => {
  it('are all opt-in, described, and say what leaves the device', () => {
    for (const plugin of CORE_ADDONS) {
      expect(addOnProblem(plugin), plugin.id).toBeNull();
    }
  });

  it('are only reached through the plugin registry', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (rel.startsWith('addons/') || rel === 'App.tsx') continue;
      const text = readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*\/addons(\/|['"])|import\s+['"][^'"]*\/addons(\/|['"])/.test(text)) offenders.push(rel);
    }
    expect(offenders, 'import the add-on into addons/index.ts and use registry extension points instead').toEqual([]);
  });

  it('refuse to register a plugin that is not opt-in', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const alwaysOn: OpenDraftPlugin = {
      id: 'always-on-assistant', name: 'Assistant', version: '1.0.0',
      description: 'Chat.', privacy: 'Sends text to a server.',
    };
    registerCoreAddOns([alwaysOn]);
    expect(pluginRegistry.getAll().some((p) => p.id === 'always-on-assistant')).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not marked optIn'));
    error.mockRestore();
  });
});
