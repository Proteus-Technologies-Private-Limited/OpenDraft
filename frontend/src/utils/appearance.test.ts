import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearance,
  readAppearance,
  saveAppearance,
  themeOf,
  type Appearance,
} from './appearance';

function fakeRoot() {
  const attrs: Record<string, string> = {};
  return { attrs, setAttribute: (k: string, v: string) => { attrs[k] = v; } };
}

describe('appearance', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it.each<Appearance>(['light', 'dark', 'dark-pages'])('remembers %s', (a) => {
    saveAppearance(a);
    expect(readAppearance()).toBe(a);
  });

  it('reads what older versions saved', () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'light');
    expect(readAppearance()).toBe('light');
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'dark');
    expect(readAppearance()).toBe('dark');
  });

  it('falls back to dark for a missing or unknown value', () => {
    expect(readAppearance()).toBe('dark');
    localStorage.setItem(APPEARANCE_STORAGE_KEY, 'sepia');
    expect(readAppearance()).toBe('dark');
  });

  it('keeps data-theme light/dark so existing rules still match', () => {
    const root = fakeRoot();
    applyAppearance('dark-pages', root);
    expect(root.attrs).toEqual({ 'data-theme': 'dark', 'data-dark-pages': 'on' });
    applyAppearance('light', root);
    expect(root.attrs).toEqual({ 'data-theme': 'light', 'data-dark-pages': 'off' });
    applyAppearance('dark', root);
    expect(root.attrs).toEqual({ 'data-theme': 'dark', 'data-dark-pages': 'off' });
    expect(themeOf('dark-pages')).toBe('dark');
  });

  it('survives storage that throws', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => saveAppearance('light')).not.toThrow();
    expect(readAppearance()).toBe('dark');
  });
});
