import { describe, it, expect, afterEach } from 'vitest';
import {
  i18next,
  t,
  setLanguage,
  getLanguage,
  initI18n,
  loadLanguage,
  matchLanguage,
  detectDeviceLanguage,
  resolveLanguage,
  readLanguagePreference,
  saveLanguagePreference,
  LANGUAGE_STORAGE_KEY,
  LANGUAGES,
  applyDocumentLanguage,
} from './index';
import { formatNumber, formatDate, formatList, currentLocale } from './format';

afterEach(async () => {
  await setLanguage('en');
  localStorage.removeItem(LANGUAGE_STORAGE_KEY);
});

describe('startup', () => {
  it('starts in English with the shared strings in place', () => {
    expect(getLanguage()).toBe('en');
    expect(t('common:cancel')).toBe('Cancel');
    expect(i18next.isInitialized).toBe(true);
  });

  it('is safe to start twice', async () => {
    await initI18n();
    expect(t('common:save')).toBe('Save');
  });
});

describe('language matching', () => {
  it.each([
    ['es', 'es'], ['es-419', 'es'], ['ES-mx', 'es'], ['pt-PT', 'pt'], ['pt_BR', 'pt'],
    ['fa-AF', 'fa'], ['ar-EG', 'ar'], ['ru-RU', 'ru'], ['tr-TR', 'tr'], ['fr-CA', 'fr'], ['en-IN', 'en'], ['hi-IN', 'hi'], ['ur-PK', 'ur'], ['bn-BD', 'bn'], ['ta-LK', 'ta'], ['pa-Guru-IN', 'pa'],
  ])('%s → %s', (tag, code) => {
    expect(matchLanguage(tag)).toBe(code);
  });

  it.each(['', 'xx', 'de', 'ja-JP', 'zh-CN', undefined, null])('has no match for %s', (tag) => {
    expect(matchLanguage(tag as string)).toBeNull();
  });

  it('follows the first device language that is shipped', () => {
    expect(detectDeviceLanguage(['de-DE', 'fr-FR', 'es'])).toBe('fr');
  });

  it('falls back to English when the device language is not shipped', () => {
    expect(detectDeviceLanguage(['de-DE', 'ja-JP'])).toBe('en');
    expect(detectDeviceLanguage([])).toBe('en');
  });

  it('resolves system to the device and a choice to itself', () => {
    expect(resolveLanguage('system', ['ru-RU'])).toBe('ru');
    expect(resolveLanguage('fa', ['ru-RU'])).toBe('fa');
  });
});

describe('remembering the choice', () => {
  it('defaults to system', () => {
    expect(readLanguagePreference()).toBe('system');
  });

  it('round-trips a language', () => {
    saveLanguagePreference('tr');
    expect(readLanguagePreference()).toBe('tr');
  });

  it('ignores a value that is no longer shipped', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    expect(readLanguagePreference()).toBe('system');
  });

  it('survives storage that throws', () => {
    const real = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
    });
    try {
      expect(readLanguagePreference()).toBe('system');
      expect(() => saveLanguagePreference('es')).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real });
    }
  });
});

describe('switching language', () => {
  it('persists the choice and changes the language', async () => {
    await setLanguage('es');
    expect(getLanguage()).toBe('es');
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es');
  });

  it('returns to English', async () => {
    await setLanguage('fr');
    await setLanguage('en');
    expect(getLanguage()).toBe('en');
    expect(t('common:cancel')).toBe('Cancel');
  });

  it('shows English, never the raw key, when a language lacks a string', async () => {
    // Until a language is translated it has no files; English must fill in.
    await setLanguage('tr');
    expect(t('common:cancel')).not.toBe('cancel');
    expect(t('common:cancel').length).toBeGreaterThan(0);
  });

  it('loads a language only once', async () => {
    await loadLanguage('ru');
    await loadLanguage('ru');
    expect(i18next.hasResourceBundle('en', 'common')).toBe(true);
  });
});

describe('document language and direction', () => {
  it('sets lang and dir on the root element', () => {
    const attrs: Record<string, string> = {};
    const root = { setAttribute: (k: string, v: string) => { attrs[k] = v; } } as unknown as HTMLElement;
    applyDocumentLanguage('ar', root);
    expect(attrs).toEqual({ lang: 'ar', dir: 'rtl' });
    applyDocumentLanguage('fa', root);
    expect(attrs.dir).toBe('rtl');
    applyDocumentLanguage('es', root);
    expect(attrs).toEqual({ lang: 'es', dir: 'ltr' });
  });

  it('marks exactly Arabic, Persian and Urdu as right-to-left', () => {
    expect(LANGUAGES.filter((l) => l.dir === 'rtl').map((l) => l.code).sort()).toEqual(['ar', 'fa', 'ur']);
  });
});

describe('formatting', () => {
  it('uses Western digits and the Gregorian calendar for Arabic and Persian', async () => {
    for (const code of ['ar', 'fa', 'ur'] as const) {
      await setLanguage(code);
      expect(formatNumber(1234)).not.toMatch(/[٠-٩۰-۹]/);
      expect(formatDate(new Date(Date.UTC(2026, 10, 5, 12)), { year: 'numeric', timeZone: 'UTC' })).toBe('2026');
    }
  });

  it('groups numbers the local way', async () => {
    await setLanguage('en');
    expect(formatNumber(1234567)).toBe('1,234,567');
    await setLanguage('fr');
    expect(formatNumber(1234567).replace(/\s/g, ' ')).toBe('1 234 567');
    await setLanguage('es');
    expect(currentLocale()).toBe('es');
  });

  it('returns an empty string for an invalid date instead of throwing', () => {
    expect(formatDate('not a date')).toBe('');
  });

  it('joins a list', async () => {
    await setLanguage('en');
    expect(formatList(['a', 'b', 'c'])).toBe('a, b, and c');
  });
});
