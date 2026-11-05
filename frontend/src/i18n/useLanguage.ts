import { useSyncExternalStore } from 'react';
import {
  getLanguage,
  getLanguagePreference,
  languageInfo,
  setLanguage,
  subscribeLanguage,
  type LanguageInfo,
  type LanguagePreference,
} from './index';

export interface UseLanguage {
  /** The language on screen. */
  info: LanguageInfo;
  /** What the writer chose — `system` or a language. */
  preference: LanguagePreference;
  /** Reading direction of the interface. */
  dir: 'ltr' | 'rtl';
  isRtl: boolean;
  setLanguage: (pref: LanguagePreference) => Promise<void>;
}

/** Re-renders when the interface language changes. */
export function useLanguage(): UseLanguage {
  const code = useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
  const preference = useSyncExternalStore(subscribeLanguage, getLanguagePreference, getLanguagePreference);
  const info = languageInfo(code);
  return { info, preference, dir: info.dir, isRtl: info.dir === 'rtl', setLanguage };
}
