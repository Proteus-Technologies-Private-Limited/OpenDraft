/**
 * Plugins register before the app starts i18next, and i18next.init() replaces
 * its resource store — so words a plugin adds early must be held and applied
 * once it is ready, not silently dropped.
 */
import { describe, it, expect } from 'vitest';
import { addPluginResources, i18next, initI18n } from './index';

describe('addPluginResources before i18next starts', () => {
  it('holds the words and applies them when the app starts i18next', async () => {
    // The suite's setup has started i18next; stand in for the moment before.
    const started = i18next.isInitialized;
    i18next.isInitialized = false;
    try {
      addPluginResources('early-plugin', { en: { hello: 'Hello from a plugin' } });
    } finally {
      i18next.isInitialized = started;
    }
    expect(i18next.exists('early-plugin:hello')).toBe(false);

    await initI18n();
    // getResource: the app's typed t() only accepts its own keys.
    expect(i18next.exists('early-plugin:hello')).toBe(true);
    expect(i18next.getResource('en', 'early-plugin', 'hello')).toBe('Hello from a plugin');
  });
});
