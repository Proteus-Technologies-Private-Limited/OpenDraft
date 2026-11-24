import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ tauri: true, mobile: false }));
const tauriWindow = vi.hoisted(() => ({ availableMonitors: vi.fn(async () => [{ name: 'Display' }]) }));
vi.mock('./platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform')>()),
  isTauri: () => platform.tauri,
  isMobileTauri: () => platform.mobile,
}));
vi.mock('@tauri-apps/api/window', () => tauriWindow);

import { availableMonitorsOnDesktop, canQueryMonitors } from './desktopWindowApi';

afterEach(() => {
  tauriWindow.availableMonitors.mockClear();
  platform.tauri = true;
  platform.mobile = false;
});

describe('monitor queries', () => {
  it('are never sent from the phone and tablet apps', async () => {
    platform.mobile = true;
    expect(canQueryMonitors()).toBe(false);
    await expect(availableMonitorsOnDesktop()).resolves.toEqual([]);
    expect(tauriWindow.availableMonitors).not.toHaveBeenCalled();
  });

  it('are not sent from a browser, which has no Tauri to answer them', async () => {
    platform.tauri = false;
    await expect(availableMonitorsOnDesktop()).resolves.toEqual([]);
    expect(tauriWindow.availableMonitors).not.toHaveBeenCalled();
  });

  it('are answered in the desktop app', async () => {
    await expect(availableMonitorsOnDesktop()).resolves.toEqual([{ name: 'Display' }]);
    expect(tauriWindow.availableMonitors).toHaveBeenCalledTimes(1);
  });
});

describe('desktop-only window queries in the app', () => {
  // One of these on iOS aborts the app (tao asserts the main thread; Tauri
  // answers on a worker). They may only be called from desktopWindowApi.ts.
  const DESKTOP_ONLY = /\b(availableMonitors|currentMonitor|primaryMonitor|monitorFromPoint|cursorPosition)\b/;

  it('go only through desktopWindowApi.ts, which skips them on phones and tablets', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name === 'desktopWindowApi.ts') continue;
        const code = readFileSync(path, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
        code.split('\n').forEach((line, i) => {
          if (DESKTOP_ONLY.test(line)) offenders.push(`${path.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
        });
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
