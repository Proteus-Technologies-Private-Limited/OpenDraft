import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refreshPanelDisplays, withPanelIn, withoutPanel, type PanelWindowEntry } from './panelPopoutStore';

const platform = vi.hoisted(() => ({ tauri: true, mobile: false }));
const tauriWindow = vi.hoisted(() => ({
  availableMonitors: vi.fn(async () => []),
  getCurrentWindow: vi.fn(() => ({
    outerPosition: async () => ({ x: 0, y: 0 }),
    outerSize: async () => ({ width: 800, height: 600 }),
    innerPosition: async () => ({ x: 0, y: 0 }),
    scaleFactor: async () => 1,
  })),
}));
vi.mock('../services/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/platform')>()),
  isTauri: () => platform.tauri,
  isMobileTauri: () => platform.mobile,
}));
vi.mock('@tauri-apps/api/window', () => tauriWindow);
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));

describe('reading the displays for panel windows', () => {
  beforeEach(() => {
    tauriWindow.availableMonitors.mockClear();
    tauriWindow.getCurrentWindow.mockClear();
  });

  it('never asks for the monitors in the phone and tablet apps', async () => {
    // On iOS that query aborted the app at launch: tao's MonitorHandle
    // asserts the main thread and Tauri answers it on a worker (2.16.0).
    platform.tauri = true;
    platform.mobile = true;
    await refreshPanelDisplays();
    expect(tauriWindow.availableMonitors).not.toHaveBeenCalled();
    expect(tauriWindow.getCurrentWindow).not.toHaveBeenCalled();
  });

  it('still reads them in the desktop app', async () => {
    platform.tauri = true;
    platform.mobile = false;
    await refreshPanelDisplays();
    expect(tauriWindow.availableMonitors).toHaveBeenCalledTimes(1);
  });
});

/** The grouping rules. Opening and closing the real windows is covered by the
 * browser test (test-script/panel-popout/regressions.py). */
const entry = (panels: string[], active = panels[0]): PanelWindowEntry => ({
  window: {} as Window, root: {} as HTMLElement, panels, active, boundsKey: panels[0],
});

describe('grouping panels into windows', () => {
  it('adds a panel to a window as its last tab, showing', () => {
    const r = withPanelIn({ a: entry(['scenes']) }, { scenes: 'a' }, 'notes', 'a');
    expect(r.windows.a).toMatchObject({ panels: ['scenes', 'notes'], active: 'notes' });
    expect(r.placed).toEqual({ scenes: 'a', notes: 'a' });
    expect(r.emptied).toBeNull();
  });

  it('moving a panel already there only shows it', () => {
    const r = withPanelIn({ a: entry(['scenes', 'notes'], 'notes') }, { scenes: 'a', notes: 'a' }, 'scenes', 'a');
    expect(r.windows.a).toMatchObject({ panels: ['scenes', 'notes'], active: 'scenes' });
  });

  it('a window left empty by a move is reported, to be closed', () => {
    const windows = { a: entry(['scenes']), b: entry(['notes']) };
    const r = withPanelIn(windows, { scenes: 'a', notes: 'b' }, 'notes', 'a');
    expect(r.emptied).toBe('b');
    expect(r.windows.a.panels).toEqual(['scenes', 'notes']);
    expect(r.placed).toEqual({ scenes: 'a', notes: 'a' });
  });

  it('a panel taken out of a shared window leaves the rest, showing its neighbour', () => {
    const windows = { a: entry(['scenes', 'notes', 'tags'], 'notes') };
    const placed = { scenes: 'a', notes: 'a', tags: 'a' };
    const r = withoutPanel(windows, placed, 'notes');
    expect(r.windows.a).toMatchObject({ panels: ['scenes', 'tags'], active: 'scenes' });
    expect(r.placed).toEqual({ scenes: 'a', tags: 'a' });
    expect(r.emptied).toBeNull();
    // A tab not showing leaves the one showing alone.
    expect(withoutPanel(windows, placed, 'tags').windows.a.active).toBe('notes');
    // The first tab passes the window to the next.
    expect(withoutPanel({ a: entry(['scenes', 'notes']) }, { scenes: 'a', notes: 'a' }, 'scenes').windows.a.active).toBe('notes');
  });

  it('the last panel out empties its window', () => {
    const r = withoutPanel({ a: entry(['scenes']) }, { scenes: 'a' }, 'scenes');
    expect(r.emptied).toBe('a');
    expect(r.placed).toEqual({});
  });

  it('a panel in no window changes nothing', () => {
    const windows = { a: entry(['scenes']) };
    const placed = { scenes: 'a' };
    const r = withoutPanel(windows, placed, 'notes');
    expect(r.windows).toBe(windows);
    expect(r.placed).toBe(placed);
    expect(withPanelIn(windows, placed, 'notes', 'missing').windows).toBe(windows);
  });
});
