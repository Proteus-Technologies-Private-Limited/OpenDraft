import { useRef, useState, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/react';
import { spellChecker } from '../editor/spellchecker';
import { BUILTIN, CATALOG } from '../editor/languageCatalog';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
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
  // Include custom URL dictionaries as well as every catalog language.
  const languages = new Map([BUILTIN, ...CATALOG, ...loaded].map((language) => [language.code, language]));

  const toggle = async (code: string) => {
    if (pending.current || !editor || editor.isDestroyed) return;
    if (!loadedCodes.has(code)) {
      pending.current = true;
      setInstalling(code);
      const scriptId = useProjectStore.getState().currentScriptId;
      const { documentOrigin, importedSource } = useEditorStore.getState();
      try {
        const result = await useEditorStore.getState().installLanguage(code);
        if (!result.ok) {
          showToast(result.error || t('settings:dictionaryConfig.installFailed'), 'error');
          return;
        }
        // A download may finish after the writer opens a different script.
        const current = useEditorStore.getState();
        if (editor.isDestroyed || useProjectStore.getState().currentScriptId !== scriptId
          || current.documentOrigin !== documentOrigin || current.importedSource !== importedSource) return;
      } catch (error) {
        console.error('Spellcheck language installation failed', code, error);
        showToast(t('settings:dictionaryConfig.installFailed'), 'error');
        return;
      } finally {
        pending.current = false;
        setInstalling(null);
      }
    }
    const current = spellChecker.getEnabledLanguages();
    const active = loadedCodes.has(code) && current.includes(code);
    if (active && current.length === 1) return;
    spellChecker.setEnabledLanguages(active ? current.filter((language) => language !== code) : [...new Set([...current, code])]);
    if (!active) useEditorStore.getState().setSpellCheckEnabled(true);
  };

  return [...languages.values()].map(({ code, label }) => {
    const active = enabled.includes(code);
    const status = code === installing ? t('settings:dictionaryConfig.installing')
      : !loadedCodes.has(code) && code !== BUILTIN.code ? t('settings:dictionaryConfig.install') : '';
    return {
      label: `${active ? '✓ ' : ''}${label}${status ? ` — ${status}` : ''}`,
      disabled: !editor || installing !== null || (active && loadedCodes.has(code) && enabled.length === 1),
      action: () => { void toggle(code); },
    };
  });
}
