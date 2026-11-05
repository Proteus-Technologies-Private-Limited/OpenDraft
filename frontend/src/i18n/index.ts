/**
 * OpenDraft's interface translation.
 *
 *   import { useTranslation } from 'react-i18next';   // in components
 *   const { t } = useTranslation('menu');  t('file.save')
 *
 *   import { t } from '../i18n';                      // outside React, at call time
 *   showToast(t('messages:save.failed'))
 *
 * Never call `t()` at module scope: it would run once, in whatever language was
 * active at import, and never follow a language change.
 */
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resources, NAMESPACES } from './resources';
import {
  DEFAULT_LANGUAGE,
  languageInfo,
  readLanguagePreference,
  resolveLanguage,
  saveLanguagePreference,
  type LanguageCode,
  type LanguagePreference,
} from './languages';

export * from './languages';
export { resources, NAMESPACES } from './resources';

// Every non-English namespace file, as lazy loaders. Vite turns each into its
// own chunk inside the build, so a language costs nothing until it is chosen —
// and still works offline, because the chunks ship inside the app.
const loaders = import.meta.glob('../locales/*/*.json', { import: 'default' }) as Record<
  string,
  () => Promise<Record<string, unknown>>
>;

const warned = new Set<string>();

let preference: LanguagePreference = 'system';
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.warn('[i18n] a language listener threw', err);
    }
  });
}

/** Put the language and direction on <html> — the browser's own hint for fonts, hyphenation and spell-check. */
export function applyDocumentLanguage(code: LanguageCode, root: HTMLElement | undefined = typeof document !== 'undefined' ? document.documentElement : undefined): void {
  if (!root) return;
  const info = languageInfo(code);
  root.setAttribute('lang', info.code);
  root.setAttribute('dir', info.dir);
}

/** Fetch every namespace of a language into i18next. English is already there. */
export async function loadLanguage(code: LanguageCode): Promise<void> {
  if (code === DEFAULT_LANGUAGE) return;
  await Promise.all(
    NAMESPACES.map(async (ns) => {
      if (i18next.hasResourceBundle(code, ns)) return;
      const load = loaders[`../locales/${code}/${ns}.json`];
      if (!load) {
        // A namespace without a file for this language: English fills in.
        console.warn(`[i18n] no ${code} translation file for "${ns}"; falling back to English`);
        return;
      }
      i18next.addResourceBundle(code, ns, await load(), true, true);
    }),
  );
}

/**
 * Start i18next with English and the language the writer chose (or their
 * device uses). Never rejects: a language that cannot be loaded leaves the app
 * in English, which is a working app.
 */
export async function initI18n(): Promise<void> {
  preference = readLanguagePreference();
  const wanted = resolveLanguage(preference);

  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources: { en: resources },
      lng: DEFAULT_LANGUAGE,
      fallbackLng: DEFAULT_LANGUAGE,
      supportedLngs: false,
      ns: NAMESPACES,
      defaultNS: 'common',
      // React escapes what it renders; escaping here as well would show &amp;.
      interpolation: { escapeValue: false },
      // The translations are in memory before the first render, never awaited per use.
      react: { useSuspense: false },
      returnNull: false,
      // One warning per missing key, development only — in production a missing
      // key quietly shows English.
      saveMissing: false,
      parseMissingKeyHandler: (key: string) => {
        if (import.meta.env?.DEV && !warned.has(key)) {
          warned.add(key);
          console.warn(`[i18n] missing translation key: ${key}`);
        }
        return key;
      },
    });
  }

  await switchTo(wanted);
}

/**
 * The macOS menu bar is native, so only Rust can word it. Tell it the language.
 * Desktop app only; a failure is logged and changes nothing the writer can see
 * beyond three menu titles staying as they were.
 */
async function syncNativeMenu(code: LanguageCode): Promise<void> {
  try {
    const { isDesktopTauri } = await import('../services/platform');
    if (!isDesktopTauri()) return;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_native_menu_language', { lang: code });
  } catch (err) {
    console.warn('[i18n] could not set the native menu language', err);
  }
}

async function switchTo(code: LanguageCode): Promise<void> {
  try {
    await loadLanguage(code);
    await i18next.changeLanguage(code);
    applyDocumentLanguage(code);
    void syncNativeMenu(code);
  } catch (err) {
    console.error(`[i18n] could not switch to "${code}", staying in English`, err);
    try {
      await i18next.changeLanguage(DEFAULT_LANGUAGE);
      applyDocumentLanguage(DEFAULT_LANGUAGE);
    } catch (inner) {
      console.error('[i18n] could not even fall back to English', inner);
    }
  }
  notify();
}

/** Change the interface language (or `system` to follow the device) and remember it. */
export async function setLanguage(pref: LanguagePreference): Promise<void> {
  preference = pref;
  saveLanguagePreference(pref);
  await switchTo(resolveLanguage(pref));
}

/**
 * Let a plugin (OpenDraft-Pro, an add-on) bring its own words. The namespace
 * should be the plugin's id, so it can never collide with the app's own; keys
 * are then reached as `t('my-plugin:menu.export')`. A language the plugin does
 * not provide shows its English.
 *
 *   addPluginResources('my-plugin', { en: { export: 'Export' }, es: { export: 'Exportar' } });
 */
export function addPluginResources(
  namespace: string,
  bundles: Partial<Record<LanguageCode, Record<string, unknown>>>,
): void {
  for (const [code, bundle] of Object.entries(bundles)) {
    if (!bundle) continue;
    try {
      i18next.addResourceBundle(code, namespace, bundle, true, true);
    } catch (err) {
      console.warn(`[i18n] could not add "${namespace}" for ${code}`, err);
    }
  }
}

/** What the writer chose — `system` or a language. */
export function getLanguagePreference(): LanguagePreference {
  return preference;
}

/** The language on screen right now. */
export function getLanguage(): LanguageCode {
  return languageInfo(i18next.language || DEFAULT_LANGUAGE).code;
}

export function subscribeLanguage(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `t` for code that is not a component. Call it when the text is needed, not at import. */
export const t = i18next.t.bind(i18next);

export { i18next };
