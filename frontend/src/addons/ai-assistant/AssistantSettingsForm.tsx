/**
 * Shown when the writer turns the assistant on, and from Settings → Add-ons.
 *
 * OpenDraft shows this under the add-on's description and privacy statement and
 * supplies its own Turn On / Save and Cancel buttons. `registerSave` hands core
 * the function that validates and stores what is typed here; returning false
 * keeps the dialog open with the message on screen.
 */
import React, { useEffect, useState } from 'react';
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
    return 'Enter the server address, e.g. http://localhost:11434';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'The address must start with http:// or https://';
  }
  return null;
}

const AssistantSettingsForm: React.FC<PluginSettingsProps> = ({ registerSave }) => {
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
        setError('Enter the name of the model to use.');
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
  }, [settings, registerSave]);

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
          ? `Reached the server. Models: ${found.slice(0, 8).join(', ')}${found.length > 8 ? '…' : ''}`
          : 'Reached the server, but it reported no models. Load one first.',
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
        <label htmlFor="ai-provider">Server type</label>
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
          <option value="ollama">Ollama (its own API)</option>
          <option value="openai">OpenAI-compatible (Unsloth Studio, LM Studio, llama.cpp…)</option>
        </select>
        <div className="settings-hint">
          Ollama: http://localhost:11434 · Unsloth Studio: http://localhost:8080/v1 ·
          LM Studio: http://localhost:1234/v1
        </div>
      </div>
      <div className="settings-row">
        <label htmlFor="ai-base-url">Server address</label>
        <input
          id="ai-base-url"
          className="settings-input"
          value={settings.baseUrl}
          onChange={field('baseUrl')}
          placeholder="http://localhost:11434"
        />
      </div>
      <div className="settings-row">
        <label htmlFor="ai-model">Model</label>
        <input
          id="ai-model"
          className="settings-input"
          value={settings.model}
          onChange={field('model')}
          placeholder="qwen2.5"
        />
        <div className="settings-hint">
          For reliable results use an instruct model of 7B or more; small models often
          misattribute a line or drop actions.
        </div>
      </div>
      <div className="settings-row">
        <label htmlFor="ai-key">API key (only if your server needs one)</label>
        <input
          id="ai-key"
          className="settings-input"
          type="password"
          autoComplete="off"
          value={settings.apiKey}
          onChange={field('apiKey')}
          placeholder="optional"
        />
      </div>
      <div className="settings-row">
        <button type="button" className="ai-test-button" onClick={testConnection} disabled={testing}>
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        {testResult && <div className="settings-hint">{testResult}</div>}
      </div>
      {error && <p className="addon-error" role="alert">{error}</p>}
    </div>
  );
};

export default AssistantSettingsForm;
