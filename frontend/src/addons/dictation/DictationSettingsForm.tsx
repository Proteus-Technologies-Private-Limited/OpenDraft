import { useEffect, useState } from 'react';
import type { PluginSettingsProps } from '../../plugins/registry';
import { availableEngines, ENGINE_NAMES, ENGINE_PRIVACY, localCaptureProblem } from './capabilities';
import { loadSettings, saveSettings, type Engine } from './settings';
export default function DictationSettingsForm({ registerSave }: PluginSettingsProps) {
  const engines = availableEngines();
  const [settings, setSettings] = useState(() => {
    const saved = loadSettings();
    return { ...saved, engine: engines.includes(saved.engine) ? saved.engine : engines[0] ?? 'local' };
  });
  const [error, setError] = useState('');
  useEffect(() => {
    registerSave(() => {
      if (!availableEngines().includes(settings.engine)) { setError('No supported recognition engine is available on this platform.'); return false; }
      try { saveSettings(settings); return true; }
      catch (err) { setError(`Could not save dictation settings: ${String(err)}`); return false; }
    });
  }, [settings, registerSave]);
  const languages: Record<string, string> = { en: 'English', pl: 'Polish', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', ja: 'Japanese' };
  return <div className="dictation-settings">
    <label style={{ display: 'block' }}>Recognition engine <select aria-label="Recognition engine" value={settings.engine} onChange={e => setSettings({ ...settings, engine: e.target.value as Engine })}>
      {engines.map(engine => <option key={engine} value={engine}>{ENGINE_NAMES[engine]}{engine !== 'local' ? ' (voice may leave device)' : ''}</option>)}
    </select></label>
    {engines.length ? <p>{ENGINE_PRIVACY[settings.engine]}</p> : <p role="alert">{localCaptureProblem() ?? 'No supported speech engine is available in this browser.'}</p>}
    <label style={{ display: 'block', marginTop: 12 }}>Language <select aria-label="Language" value={settings.language} onChange={e => setSettings({ ...settings, language: e.target.value })}>
      {Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select></label>
    <label style={{ display: 'block', marginTop: 12 }}><input type="checkbox" checked={settings.commands} onChange={e => setSettings({ ...settings, commands: e.target.checked })} /> Interpret English voice commands</label>
    <p>Commands are optional. Review every transcript before inserting it. Settings stay on this device.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
