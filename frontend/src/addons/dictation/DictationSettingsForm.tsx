import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginSettingsProps } from '../../plugins/registry';
import { availableEngines, engineName, enginePrivacy, localCaptureProblem } from './capabilities';
import { loadSettings, saveSettings, type Engine } from './settings';
export default function DictationSettingsForm({ registerSave }: PluginSettingsProps) {
  const { t } = useTranslation('addons');
  const engines = availableEngines();
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings();
    return { ...saved, engine: engines.includes(saved.engine) ? saved.engine : engines[0] ?? 'local' };
  });
  const [error, setError] = useState('');
  useEffect(() => {
    registerSave(() => {
      if (!availableEngines().includes(settings.engine)) { setError(t('dictation.settings.noEngine')); return false; }
      try { saveSettings(settings); return true; }
      catch (err) { setError(t('dictation.settings.saveFailed', { error: String(err) })); return false; }
    });
  }, [settings, registerSave, t]);
  const languages: Record<string, string> = {
    en: t('dictation.languages.en'), pl: t('dictation.languages.pl'), fr: t('dictation.languages.fr'),
    de: t('dictation.languages.de'), es: t('dictation.languages.es'), it: t('dictation.languages.it'),
    pt: t('dictation.languages.pt'), ja: t('dictation.languages.ja'),
  };
  return <div className="dictation-settings">
    <label style={{ display: 'block' }}>{t('dictation.settings.engine')} <select aria-label={t('dictation.settings.engine')} value={settings.engine} onChange={e => setSettings({ ...settings, engine: e.target.value as Engine })}>
      {engines.map(engine => <option key={engine} value={engine}>{engine !== 'local' ? t('dictation.settings.engineMayLeave', { name: engineName(engine) }) : engineName(engine)}</option>)}
    </select></label>
    {engines.length ? <p>{enginePrivacy(settings.engine)}</p> : <p role="alert">{localCaptureProblem() ?? t('dictation.settings.noEngineBrowser')}</p>}
    <label style={{ display: 'block', marginTop: 12 }}>{t('dictation.settings.language')} <select aria-label={t('dictation.settings.language')} value={settings.language} onChange={e => setSettings({ ...settings, language: e.target.value })}>
      {Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select></label>
    <label style={{ display: 'block', marginTop: 12 }}><input type="checkbox" checked={settings.commands} onChange={e => setSettings({ ...settings, commands: e.target.checked })} /> {t('dictation.settings.commands')}</label>
    <p>{t('dictation.settings.commandsHint')}</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
