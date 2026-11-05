import { describe, expect, it } from 'vitest';
import { buildLanguageOptions } from './languageOptions';
import { LANGUAGES } from '../i18n/languages';

describe('buildLanguageOptions', () => {
  it('starts with the device entry, named after the language the device resolves to', () => {
    const opts = buildLanguageOptions((name) => `Device language (${name})`, ['fr-CA', 'en']);
    expect(opts[0]).toEqual({ value: 'system', label: 'Device language (Français)' });
  });

  it('falls back to English when the device language is not shipped', () => {
    const opts = buildLanguageOptions((name) => name, ['ja-JP']);
    expect(opts[0].label).toBe('English');
  });

  it('lists every shipped language by its own name, with lang and dir', () => {
    const opts = buildLanguageOptions((n) => n, ['en']).slice(1);
    // Every language, English first and then A-Z by English name, so 19 are easy to scan.
    expect(opts.map((o) => o.value).sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
    const english = LANGUAGES.filter((l) => l.code !== 'en').map((l) => l.englishName);
    expect(opts[0].value).toBe('en');
    expect(opts.slice(1).map((o) => LANGUAGES.find((l) => l.code === o.value)?.englishName)).toEqual([...english].sort());
    const ar = opts.find((o) => o.value === 'ar');
    expect(ar).toMatchObject({ label: 'العربية', lang: 'ar', dir: 'rtl' });
    const es = opts.find((o) => o.value === 'es');
    expect(es).toMatchObject({ label: 'Español', lang: 'es', dir: 'ltr' });
  });
});
