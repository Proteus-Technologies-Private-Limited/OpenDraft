import { useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { spellChecker } from '../editor/spellchecker';
import { BUILTIN, CATALOG } from '../editor/languageCatalog';
import { useEditorStore } from '../stores/editorStore';
import { canDisableLanguage, setScriptLanguageEnabled } from '../editor/spellcheckLanguages';
import { showToast } from '../components/Toast';
import { t } from '../i18n';

const subscribe = (notify: () => void) => spellChecker.onChange(notify);
const snapshot = () => JSON.stringify({
  loaded: spellChecker.getLoadedLanguages(),
  enabled: spellChecker.getEnabledLanguages(),
});

/** The same engines and per-script enabled set used by Dictionary Settings. */
export function useSpellcheckLanguages(editor: Editor | null) {
  const state = useSyncExternalStore(subscribe, snapshot);
  const { loaded, enabled } = JSON.parse(state) as {
    loaded: { code: string; label: string }[];
    enabled: string[];
  };
  const [installing, setInstalling] = useState<string | null>(null);
  const pending = useRef(false);
  const loadedCodes = new Set(loaded.map((language) => language.code));
  // Keep unavailable enabled codes removable, including unknown/custom codes.
  const languages = new Map([BUILTIN, ...CATALOG, ...loaded].map(language => [language.code, language]));
  for (const code of enabled) if (!languages.has(code)) languages.set(code, { code, label: code });

  const toggle = async (code: string) => {
    if (pending.current || !editor || editor.isDestroyed) return;
    const on = !spellChecker.getEnabledLanguages().includes(code);
    pending.current = true;
    if (on && !spellChecker.getLoadedLanguages().some(language => language.code === code)) setInstalling(code);
    try {
      const result = await setScriptLanguageEnabled(code, on, {
        install: useEditorStore.getState().installLanguage,
        isCurrent: () => !editor.isDestroyed,
      });
      if (result.status === 'failed') showToast(result.error || t('settings:dictionaryConfig.installFailed'), 'error');
      else if (result.status === 'enabled') useEditorStore.getState().setSpellCheckEnabled(true);
      else if (result.status === 'installed') {
        const label = languages.get(code)?.label ?? code;
        showToast(`${label} — ${t('settings:dictionaryConfig.installed')}`, 'info');
      }
    } catch (error) {
      console.error('Spellcheck language installation failed', code, error);
      showToast(t('settings:dictionaryConfig.installFailed'), 'error');
    } finally {
      pending.current = false;
      setInstalling(null);
    }
  };

  return [...languages.values()].map(({ code, label }) => {
    const active = enabled.includes(code);
    const status = code === installing ? t('settings:dictionaryConfig.installing')
      : !loadedCodes.has(code) && code !== BUILTIN.code
        ? t(active ? 'settings:dictionaryConfig.notInstalled' : 'settings:dictionaryConfig.install') : '';
    return {
      label: `${active ? '✓ ' : ''}${label}${status ? ` — ${status}` : ''}`,
      checked: active,
      disabled: !editor || installing !== null || (active && !canDisableLanguage(code, enabled, loadedCodes)),
      action: () => { void toggle(code); },
    };
  });
}
