import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SMARTTYPE_LISTS } from '../utils/smartTypeLists';

const KEY = 'opendraft:smartTypeLists';
const freshStore = async () => {
  vi.resetModules();
  return (await import('./settingsStore')).useSettingsStore;
};
beforeEach(() => localStorage.removeItem(KEY));
afterEach(() => { vi.restoreAllMocks(); localStorage.removeItem(KEY); });

describe('saved SmartType lists', () => {
  it('keeps existing installs on the shipped vocabulary', async () => {
    expect((await freshStore()).getState().smartTypeLists).toEqual(DEFAULT_SMARTTYPE_LISTS);
  });

  it('remembers edits, ordering and empty lists after a restart', async () => {
    const store = await freshStore();
    store.getState().setSmartTypeLists({
      ...DEFAULT_SMARTTYPE_LISTS, times: ['noon', 'MAGIC HOUR'], characterExtensions: [],
    });
    const restored = (await freshStore()).getState().smartTypeLists;
    expect(restored.times).toEqual(['NOON', 'MAGIC HOUR']);
    expect(restored.characterExtensions).toEqual([]);
  });

  it('recovers from malformed JSON and partially malformed data', async () => {
    localStorage.setItem(KEY, '{bad');
    expect((await freshStore()).getState().smartTypeLists).toEqual(DEFAULT_SMARTTYPE_LISTS);
    localStorage.setItem(KEY, JSON.stringify({ times: ['NOON'], transitions: 123 }));
    expect((await freshStore()).getState().smartTypeLists).toEqual({ ...DEFAULT_SMARTTYPE_LISTS, times: ['NOON'] });
  });

  it('leaves the saved vocabulary active when storage fails', async () => {
    const store = await freshStore();
    const before = store.getState().smartTypeLists;
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    expect(() => store.getState().setSmartTypeLists({ ...before, times: ['NOON'] })).toThrow('Storage full');
    expect(store.getState().smartTypeLists).toBe(before);
  });
});
