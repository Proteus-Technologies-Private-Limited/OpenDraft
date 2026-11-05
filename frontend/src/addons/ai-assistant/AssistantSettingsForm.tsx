/**
 * Shown when the writer turns the assistant on, and from Settings → Add-ons.
 *
 * OpenDraft shows this under the add-on's description and privacy statement and
 * supplies its own Turn On / Save and Cancel buttons. `registerSave` hands core
 * the function that validates and stores what is typed here; returning false
 * keeps the dialog open with the message on screen.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { t as translate } from '../../i18n';
import type { PluginSettingsProps } from '../../plugins/registry';
import { listModels, DEFAULT_UNSLOTH_URL } from './client';
import {
  DEFAULT_COMPATIBLE_URL,
  loadSettings,
  saveSettings,
  type AssistantSettings,
} from './settingsStore';
import './assistant.css';

function checkAddress(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return translate('addons:assistant.settings.addressMissing');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return translate('addons:assistant.settings.addressProtocol');
  }
  return null;
}

const AssistantSettingsForm: React.FC<PluginSettingsProps> = ({ registerSave }) => {
  const { t } = useTranslation('addons');
  const [settings, setSettings] = useState<AssistantSettings>(loadSettings);
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState('');
  const [testing, setTesting] = useState(false);

  // Core calls this when the writer presses Turn On or Save.
  useEffect(() => {
    registerSave(() => {
      const addressProblem = checkAddress(settings.baseUrl);
      if (addressProblem) {
        setError(addressProblem);
        return false;
      }
      if (!settings.model.trim()) {
        setError(t('assistant.settings.modelMissing'));
        return false;
      }
      try {
        saveSettings({
          ...settings,
          baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
          model: settings.model.trim(),
          apiKey: settings.apiKey.trim(),
        });
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    });
  }, [settings, registerSave, t]);

  const field = (key: 'baseUrl' | 'model' | 'apiKey') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setError('');
      setTestResult('');
      setSettings((s) => ({ ...s, [key]: e.target.value }));
    };

  const testConnection = async () => {
    const addressProblem = checkAddress(settings.baseUrl);
    if (addressProblem) {
      setError(addressProblem);
      return;
    }
    setTesting(true);
    setError('');
    setTestResult('');
    try {
      const found = await listModels(settings);
      setTestResult(
        found.length > 0
          ? t('assistant.settings.reached', { models: `${found.slice(0, 8).join(', ')}${found.length > 8 ? '…' : ''}` })
          : t('assistant.settings.noModels'),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <div className="settings-row">
        <label htmlFor="ai-provider">{t('assistant.settings.serverType')}</label>
        <select
          id="ai-provider"
          className="settings-input"
          value={settings.provider}
          onChange={(e) => {
            const provider = e.target.value === 'openai' ? 'openai' : 'ollama';
            setError('');
            setTestResult('');
            setSettings((s) => ({
              ...s,
              provider,
              baseUrl: provider === 'ollama'
                ? 'http://localhost:11434'
                : (s.provider === 'ollama' ? DEFAULT_UNSLOTH_URL : s.baseUrl) || DEFAULT_COMPATIBLE_URL,
            }));
          }}
        >
          <option value="ollama">{t('assistant.settings.ollama')}</option>
          <option value="openai">{t('assistant.settings.openai')}</option>
        </select>
        <div className="settings-hint">
          {t('assistant.settings.addressExamples')}
        </div>
      </div>
      <div className="settings-row">
        <label htmlFor="ai-base-url">{t('assistant.settings.serverAddress')}</label>
        <input
          id="ai-base-url"
          className="settings-input"
          value={settings.baseUrl}
          onChange={field('baseUrl')}
          placeholder="http://localhost:11434"
        />
        <div className="settings-hint">
          {t('assistant.settings.desktopNote')}
        </div>
      </div>
      <div className="settings-row">
        <label htmlFor="ai-model">{t('assistant.settings.model')}</label>
        <input
          id="ai-model"
          className="settings-input"
          value={settings.model}
          onChange={field('model')}
          placeholder="qwen2.5"
        />
        <div className="settings-hint">
          {t('assistant.settings.modelHint')}
        </div>
      </div>
      <div className="settings-row">
        <label htmlFor="ai-key">{t('assistant.settings.apiKey')}</label>
        <input
          id="ai-key"
          className="settings-input"
          type="password"
          autoComplete="off"
          value={settings.apiKey}
          onChange={field('apiKey')}
          placeholder={t('assistant.settings.optional')}
        />
      </div>
      <div className="settings-row">
        <button type="button" className="ai-test-button" onClick={testConnection} disabled={testing}>
          {testing ? t('assistant.settings.testing') : t('assistant.settings.test')}
        </button>
        {testResult && <div className="settings-hint">{testResult}</div>}
      </div>
      {error && <p className="addon-error" role="alert">{error}</p>}
    </div>
  );
};

export default AssistantSettingsForm;
