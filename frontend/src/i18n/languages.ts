/**
 * The interface languages OpenDraft ships, and how one is chosen.
 *
 * This is the language of the APP — menus, dialogs, messages. It has nothing
 * to do with the language a script is written in (see LanguageSelector.tsx,
 * which sets a dialogue line's own `lang`), and it never touches screenplay
 * vocabulary such as INT./EXT., CONT'D or (MORE): those belong to the format
 * and stay as they are in every interface language and in every export.
 *
 * Adding a language: add an entry below, add `locales/<code>/*.json` (one file
 * per namespace in `locales/en`), nothing else. `npm run i18n:check` tells you
 * what is missing.
 */

export type LanguageCode = 'en' | 'es' | 'fr' | 'pt' | 'ru' | 'tr' | 'ar' | 'fa';

export interface LanguageInfo {
  code: LanguageCode;
  /** The language's own name for itself — what a speaker looks for in the list. */
  nativeName: string;
  englishName: string;
  /** Reading direction of the interface. */
  dir: 'ltr' | 'rtl';
  /**
   * BCP-47 tag handed to `Intl` for dates, numbers and sorting.
   *
   * Arabic and Persian are pinned to the Gregorian calendar and Western
   * digits. The script itself, its page numbers and every file name use those,
   * and a version-history time in Persian-calendar Eastern-Arabic numerals
   * sitting beside "Page 12" reads as two different documents.
   */
  intlLocale: string;
}

export const DEFAULT_LANGUAGE: LanguageCode = 'en';

/** Picker order: English first, then by English name. */
export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', dir: 'ltr', intlLocale: 'en' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', dir: 'rtl', intlLocale: 'ar-u-ca-gregory-nu-latn' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', dir: 'ltr', intlLocale: 'fr' },
  { code: 'fa', nativeName: 'فارسی', englishName: 'Persian', dir: 'rtl', intlLocale: 'fa-u-ca-gregory-nu-latn' },
  // Brazilian Portuguese: the app's Portuguese-speaking users are almost all in Brazil.
  { code: 'pt', nativeName: 'Português (Brasil)', englishName: 'Portuguese (Brazil)', dir: 'ltr', intlLocale: 'pt-BR' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', dir: 'ltr', intlLocale: 'ru' },
  // Neutral Latin-American Spanish: "tú", no "vosotros" — read the same in Madrid and Mexico City.
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', dir: 'ltr', intlLocale: 'es' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', dir: 'ltr', intlLocale: 'tr' },
];

export const LANGUAGE_CODES: readonly LanguageCode[] = LANGUAGES.map((l) => l.code);

/** The saved choice: a language, or `system` to follow the device. */
export type LanguagePreference = LanguageCode | 'system';

export const LANGUAGE_STORAGE_KEY = 'opendraft:language';

export function isLanguageCode(v: unknown): v is LanguageCode {
  return typeof v === 'string' && (LANGUAGE_CODES as readonly string[]).includes(v);
}

export function isLanguagePreference(v: unknown): v is LanguagePreference {
  return v === 'system' || isLanguageCode(v);
}

export function languageInfo(code: string): LanguageInfo {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

/**
 * Map a BCP-47 tag from the device ("pt-PT", "fa_AF", "es-419") to a shipped
 * language, or null when there is none. Region and script never matter here:
 * every Portuguese goes to the Brazilian text, every Spanish to the neutral one.
 */
export function matchLanguage(tag: string | null | undefined): LanguageCode | null {
  if (!tag || typeof tag !== 'string') return null;
  const base = tag.trim().toLowerCase().split(/[-_]/)[0];
  return isLanguageCode(base) ? base : null;
}

/** The first of the device's preferred languages that OpenDraft ships. */
export function detectDeviceLanguage(
  tags: readonly string[] | undefined = typeof navigator !== 'undefined'
    ? (navigator.languages?.length ? navigator.languages : [navigator.language])
    : [],
): LanguageCode {
  for (const tag of tags ?? []) {
    const hit = matchLanguage(tag);
    if (hit) return hit;
  }
  return DEFAULT_LANGUAGE;
}

/** Turn the saved preference into the language to actually show. */
export function resolveLanguage(
  pref: LanguagePreference,
  deviceTags?: readonly string[],
): LanguageCode {
  return pref === 'system' ? detectDeviceLanguage(deviceTags) : pref;
}

/** The remembered choice; `system` when none, unreadable or no longer shipped. */
export function readLanguagePreference(): LanguagePreference {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguagePreference(saved) ? saved : 'system';
  } catch (err) {
    console.warn('[i18n] could not read the saved language', err);
    return 'system';
  }
}

/** Remember the choice. A storage failure is logged; the switch still happens. */
export function saveLanguagePreference(pref: LanguagePreference): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, pref);
  } catch (err) {
    console.warn('[i18n] could not save the language', err);
  }
}
