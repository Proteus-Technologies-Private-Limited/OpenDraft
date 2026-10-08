/**
 * Auto-save preferences (issue #135).
 *
 * The defaults are what every existing install already does — library scripts
 * auto-save, files opened from disk do not — so upgrading changes nothing. The
 * interval feeds setInterval directly, so it is clamped: a corrupted value must
 * never turn into a timer that fires continuously.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY_LIBRARY = 'opendraft:autoSaveLibrary';
const KEY_FILES = 'opendraft:autoSaveFiles';
const KEY_INTERVAL = 'opendraft:autoSaveIntervalSeconds';

async function freshStore() {
  vi.resetModules();
  const mod = await import('./settingsStore');
  return mod.useSettingsStore;
}

beforeEach(() => {
  localStorage.removeItem(KEY_LIBRARY);
  localStorage.removeItem(KEY_FILES);
  localStorage.removeItem(KEY_INTERVAL);
});

describe('auto-save settings', () => {
  it('keeps the existing behaviour by default', async () => {
    const store = await freshStore();
    expect(store.getState().autoSaveLibrary).toBe(true);
    expect(store.getState().autoSaveFiles).toBe(false);
    expect(store.getState().autoSaveIntervalSeconds).toBe(30);
  });

  it('remembers the writer\'s choices across a restart', async () => {
    let store = await freshStore();
    store.getState().setAutoSaveLibrary(false);
    store.getState().setAutoSaveFiles(true);
    store.getState().setAutoSaveIntervalSeconds(120);

    store = await freshStore();
    expect(store.getState().autoSaveLibrary).toBe(false);
    expect(store.getState().autoSaveFiles).toBe(true);
    expect(store.getState().autoSaveIntervalSeconds).toBe(120);
  });

  it('clamps the interval it is given', async () => {
    const store = await freshStore();
    store.getState().setAutoSaveIntervalSeconds(0);
    expect(store.getState().autoSaveIntervalSeconds).toBe(5);
    store.getState().setAutoSaveIntervalSeconds(1_000_000);
    expect(store.getState().autoSaveIntervalSeconds).toBe(3600);
  });

  it('ignores a stored interval that is not a number', async () => {
    localStorage.setItem(KEY_INTERVAL, 'soon');
    const store = await freshStore();
    expect(store.getState().autoSaveIntervalSeconds).toBe(30);
  });
});
