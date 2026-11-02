import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, forgetSettings, loadSettings, saveSettings } from './settings';
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
});
afterEach(() => vi.unstubAllGlobals());
it('defaults to local and remembers device-only preferences until forgotten', () => {
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  const choices = { engine: 'browser' as const, language: 'pl', commands: true };
  saveSettings(choices); expect(loadSettings()).toEqual(choices);
  forgetSettings(); expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});
it('recovers from malformed stored preferences', () => {
  localStorage.setItem('opendraft:addon:dictation', 'null');
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  localStorage.setItem('opendraft:addon:dictation', '{"engine":"remote","language":42,"commands":"true"}');
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});
