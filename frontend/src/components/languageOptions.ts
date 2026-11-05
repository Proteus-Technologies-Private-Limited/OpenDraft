import {
  LANGUAGES,
  detectDeviceLanguage,
  languageInfo,
  type LanguageCode,
  type LanguagePreference,
} from '../i18n/languages';

export interface LanguageOption {
  value: LanguagePreference;
  label: string;
  /** BCP-47 code of the label's own language, so the browser picks the right font and shaping. */
  lang?: LanguageCode;
  dir?: 'ltr' | 'rtl';
}

/**
 * The entries of Settings -> Language: first "follow the device", then every
 * shipped language under its own name (an autonym is never translated, so a
 * writer who cannot read the current language can still find theirs).
 *
 * `systemLabel` turns the device language's own name into the first entry's
 * text (it comes from the translations, so this stays free of them).
 */
export function buildLanguageOptions(
  systemLabel: (deviceLanguageName: string) => string,
  deviceTags?: readonly string[],
): LanguageOption[] {
  let deviceName = languageInfo('en').nativeName;
  try {
    deviceName = languageInfo(detectDeviceLanguage(deviceTags)).nativeName;
  } catch (err) {
    console.warn('[settings] could not detect the device language', err);
  }
  return [
    { value: 'system', label: systemLabel(deviceName) },
    ...LANGUAGES.map((l) => ({ value: l.code, label: l.nativeName, lang: l.code, dir: l.dir })),
  ];
}
