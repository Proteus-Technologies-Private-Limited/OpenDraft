/**
 * Where Table Read gets its voices (issue #131): the voices installed on the
 * device, or an AI voice provider with its key and model.
 *
 * Shown in Settings, and as the dialog Table Read opens when it needs a
 * choice — in a browser the first time, anywhere when AI voices are chosen
 * but no provider is set up.
 */
import React, { useState } from 'react';
import {
  AI_PROVIDERS, ELEVENLABS_MODELS, GEMINI_MODELS, OPENAI_MODELS,
  isAiProviderConfigured, providerIsRemote, useVoiceSettingsStore, type AiProviderId,
} from '../stores/voiceSettingsStore';
import { isTauri, openExternal } from '../services/platform';
import { aiEngine, availableEngineKinds, selectedEngineKind } from '../services/tts/engines';
import { primeAudioPlayback } from '../services/tts/aiEngine';
import { resetEngine } from '../services/tts/player';
import { showToast } from './Toast';
import Select from './Select';

const SAMPLE = 'This is how the script will sound in a table read.';

/**
 * Shown wherever a provider that sends the script off the device is chosen
 * (issue #131). The writer owns the decision; OpenDraft makes no promise
 * about what a third party does with the text.
 */
export const ConfidentialityWarning: React.FC<{ provider: string; gemini?: boolean }> = ({ provider, gemini }) => (
  <div className="voice-provider-warning" role="alert">
    <strong>Confidentiality warning.</strong> AI voices send the text of your script to {provider}{' '}
    to be spoken. This may breach your data security or confidentiality obligations — an NDA, a
    studio&rsquo;s policy, or your own rules for unreleased work. OpenDraft does not guarantee the
    confidentiality of anything sent to a third-party provider.
    {gemini && ' On Gemini’s free tier, Google may use what you send to improve its products, and human reviewers may read it.'}
  </div>
);

const VoiceProviderSettings: React.FC<{ autoFocus?: boolean }> = ({ autoFocus }) => {
  const s = useVoiceSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const inApp = isTauri();
  const provider = AI_PROVIDERS.find((p) => p.id === s.aiProvider);
  const configured = isAiProviderConfigured(s);
  const offersSystem = availableEngineKinds().includes('system');
  const selected = selectedEngineKind(s);

  // Any change here invalidates the engine the panel is holding.
  const changed = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setTestResult(null);
    resetEngine();
  };

  const test = async () => {
    primeAudioPlayback();
    setTesting(true);
    setTestResult(null);
    try {
      const engine = aiEngine();
      const voices = await engine.listVoices();
      const ac = new AbortController();
      await engine.speak(SAMPLE, { voiceId: voices[0]?.id ?? null, rate: 1, pitch: 1, signal: ac.signal });
      setTestResult({ ok: true, message: `Working — ${voices.length} voice${voices.length === 1 ? '' : 's'} available.` });
    } catch (err) {
      console.warn('[tableRead] provider test failed:', err);
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="voice-provider-settings">
      {offersSystem && (
        <div className="settings-row">
          <label className="voice-provider-radio">
            <input
              type="radio"
              name="table-read-engine"
              checked={selected === 'system'}
              onChange={() => changed(s.setEnginePreference)('system')}
            />{' '}
            Use the voices installed on this {inApp ? 'device' : 'computer'}
          </label>
          <label className="voice-provider-radio">
            <input
              type="radio"
              name="table-read-engine"
              checked={selected === 'ai'}
              onChange={() => changed(s.setEnginePreference)('ai')}
            />{' '}
            Use an AI voice provider
          </label>
          <div className="settings-hint">
            Installed voices are free{inApp ? ' and work offline' : ''}. AI voices sound more
            natural, need an account with the provider, and are billed by them.
            {!inApp && ' Which installed voices you get depends on the browser; some also add online voices of their own (Chrome’s “Google” voices), which send the text to that company to be spoken.'}
          </div>
        </div>
      )}

      {selected === 'ai' && (
        <>
          <div className="settings-row">
            <label htmlFor="voice-provider">Provider</label>
            <Select
              id="voice-provider"
              value={s.aiProvider}
              autoFocus={autoFocus}
              onChange={(e) => changed(s.setAiProvider)(e.target.value as AiProviderId | '')}
            >
              <option value="">Choose a provider…</option>
              {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </div>

          {provider && (
            <div className="settings-hint voice-provider-cost">{provider.cost}</div>
          )}

          {/* Anything but Kokoro sends the script's text off this device. */}
          {provider ? providerIsRemote(provider.id) && <ConfidentialityWarning provider={provider.id === 'openai-compatible' ? 'your speech server' : provider.label} gemini={provider.id === 'gemini'} />
            : <ConfidentialityWarning provider="the provider you choose" />}

          {provider?.local && (
            <div className="voice-provider-local" role="note">
              Kokoro runs inside {inApp ? 'the app' : 'this browser'} on this device; your script is not
              sent to any AI provider. The first read downloads the voice model from Hugging Face and keeps
              it for next time: about 330 MB where the device&rsquo;s graphics chip can run it (WebGPU),
              which reads fast, or about 90 MB otherwise, which is slower than speech and pauses between lines.
            </div>
          )}

          {provider && !provider.local && (
            <div className="settings-row">
              <label htmlFor="voice-provider-key">
                API key{provider.keyOptional ? ' (if your server needs one)' : ''}
              </label>
              <div className="voice-provider-key-row">
                <input
                  id="voice-provider-key"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={provider.keyHint}
                  value={s.apiKeys[provider.id] ?? ''}
                  onChange={(e) => changed((v: string) => s.setApiKey(provider.id, v))(e.target.value)}
                />
                <button type="button" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Hide' : 'Show'}</button>
              </div>
              {provider.keyUrl && (
                <div className="settings-hint">
                  <a
                    href={provider.keyUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      openExternal(provider.keyUrl!).catch((err) => showToast(`Could not open the link: ${err}`, 'error'));
                    }}
                  >
                    {provider.id === 'azure' ? 'Create a Speech resource in the Azure portal' : `Get an API key from ${provider.label}`}
                  </a>
                </div>
              )}
              <div className="settings-hint">
                The key is kept only {inApp ? 'on this device' : 'in this browser'} and sent only to{' '}
                {provider.id === 'openai-compatible' ? 'your server' : provider.label}.
              </div>
            </div>
          )}

          {s.aiProvider === 'gemini' && (
            <div className="settings-row">
              <label htmlFor="voice-gemini-model">Model</label>
              <Select id="voice-gemini-model" value={s.geminiModel} onChange={(e) => changed(s.setGeminiModel)(e.target.value)}>
                {GEMINI_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <div className="settings-hint">
                Gemini takes each character&rsquo;s parentheticals and Speech Pattern as directions for how to say their lines.
              </div>
            </div>
          )}

          {s.aiProvider === 'azure' && (
            <div className="settings-row">
              <label htmlFor="voice-azure-region">Region</label>
              <input
                id="voice-azure-region"
                type="text"
                spellCheck={false}
                placeholder="e.g. eastus"
                value={s.azureRegion}
                onChange={(e) => changed(s.setAzureRegion)(e.target.value)}
              />
              <div className="settings-hint">The region of your Speech resource, shown with its keys in the Azure portal.</div>
            </div>
          )}

          {s.aiProvider === 'openai' && (
            <div className="settings-row">
              <label htmlFor="voice-openai-model">Model</label>
              <Select id="voice-openai-model" value={s.openaiModel} onChange={(e) => changed(s.setOpenaiModel)(e.target.value)}>
                {OPENAI_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
          )}

          {s.aiProvider === 'elevenlabs' && (
            <div className="settings-row">
              <label htmlFor="voice-eleven-model">Model</label>
              <Select id="voice-eleven-model" value={s.elevenlabsModel} onChange={(e) => changed(s.setElevenlabsModel)(e.target.value)}>
                {ELEVENLABS_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
          )}

          {s.aiProvider === 'openai-compatible' && (
            <>
              <div className="settings-row">
                <label htmlFor="voice-compat-url">Server address</label>
                <input
                  id="voice-compat-url"
                  type="url"
                  spellCheck={false}
                  value={s.compatibleBaseUrl}
                  placeholder="http://localhost:8880/v1"
                  onChange={(e) => changed(s.setCompatibleBaseUrl)(e.target.value)}
                />
                <div className="settings-hint">
                  The address up to and including <code>/v1</code> of a server that offers OpenAI&rsquo;s
                  <code> /audio/speech</code> API — Kokoro-FastAPI, OpenedAI Speech, LocalAI and others.
                </div>
              </div>
              <div className="settings-row">
                <label htmlFor="voice-compat-model">Model</label>
                <input
                  id="voice-compat-model"
                  type="text"
                  spellCheck={false}
                  value={s.compatibleModel}
                  onChange={(e) => changed(s.setCompatibleModel)(e.target.value)}
                />
              </div>
              <div className="settings-row">
                <label htmlFor="voice-compat-voices">Voices</label>
                <input
                  id="voice-compat-voices"
                  type="text"
                  spellCheck={false}
                  placeholder="Leave empty to ask the server"
                  value={s.compatibleVoices}
                  onChange={(e) => changed(s.setCompatibleVoices)(e.target.value)}
                />
                <div className="settings-hint">Comma-separated voice names, if the server cannot list its own.</div>
              </div>
            </>
          )}

          {provider && (
            <div className="settings-row voice-provider-test">
              <button type="button" onClick={test} disabled={!configured || testing}>
                {testing ? 'Testing…' : 'Test voice'}
              </button>
              {testResult && (
                <span className={testResult.ok ? 'voice-provider-ok' : 'voice-provider-error'} role="status">
                  {testResult.message}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VoiceProviderSettings;
