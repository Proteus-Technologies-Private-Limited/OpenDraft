/**
 * vite.plugins.ts: which modules count as a build-time plugin's own files
 * (and so get `@core/…` and package imports resolved from core).
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTimePluginEntries, buildTimePlugins, pluginFileMatcher } from '../../vite.plugins';

/** What Vite's normalizePath does on Windows: backslashes to `/`, then posix-normalized. */
const windowsNormalize = (p: string) => path.posix.normalize(p.replace(/\\/g, '/'));

describe('build-time plugin files', () => {
  it('matches Vite’s forward-slash ids against a Windows root', () => {
    const inPlugin = pluginFileMatcher(['C:\\work\\OD-Sidekick'], windowsNormalize);
    expect(inPlugin('C:/work/OD-Sidekick/src/register.ts')).toBe(true);
    expect(inPlugin('C:\\work\\OD-Sidekick\\src\\panel.tsx')).toBe(true);
    expect(inPlugin('C:/work/OD-Sidekick-other/src/x.ts')).toBe(false);
    expect(inPlugin('C:/work/OpenDraft/frontend/src/main.tsx')).toBe(false);
    expect(inPlugin('C:/work/OD-Sidekick/node_modules/react/index.js')).toBe(false);
  });

  it('matches POSIX paths as before', () => {
    const inPlugin = pluginFileMatcher(['/work/OD-Sidekick/']);
    expect(inPlugin('/work/OD-Sidekick/src/register.ts')).toBe(true);
    expect(inPlugin('/work/OD-Sidekick')).toBe(false);
    expect(inPlugin('/work/OD-SidekickX/src/a.ts')).toBe(false);
  });

  it('builds as before when OPENDRAFT_PLUGINS is unset', async () => {
    expect(buildTimePluginEntries('')).toEqual([]);
    const plugin = buildTimePlugins([]);
    const load = plugin.load as (id: string) => string | null;
    expect(load('\0virtual:opendraft-plugins')).toContain('export {};');
    expect(load('\0virtual:opendraft-plugins')).not.toContain('import ');
    const resolveId = plugin.resolveId as (s: string, i?: string, o?: object) => Promise<unknown>;
    expect(await resolveId.call({}, '@core/plugins/registry', '/anywhere/x.ts', {})).toBeNull();
  });
});
