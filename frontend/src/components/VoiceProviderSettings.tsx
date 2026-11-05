/**
 * Where Table Read gets its voices (issue #131): the voices installed on the
 * device, or an AI voice provider with its key and model.
 *
 * Shown in Settings, and as the dialog Table Read opens when it needs a
 * choice — in a browser the first time, anywhere when AI voices are chosen
 * but no provider is set up.
 */
import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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

// i18n-ignore: the sentence the voice speaks in a test; it is audio content, not interface text
const SAMPLE = 'This is how the script will sound in a table read.';

/**
 * Shown wherever a provider that sends the script off the device is chosen
 * (issue #131). The writer owns the decision; OpenDraft makes no promise
 * about what a third party does with the text.
 */
export const ConfidentialityWarning: React.FC<{ provider: string; gemini?: boolean }> = ({ provider, gemini }) => {
  const { t } = useTranslation(['settings', 'common']);
  return (
    <div className="voice-provider-warning" role="alert">
      <Trans ns="settings" i18nKey="voice.confidentiality" values={{ provider }} components={{ strong: <strong /> }} />
      {gemini && ` ${t('voice.confidentialityGemini')}`}
    </div>
  );
};

const VoiceProviderSettings: React.FC<{ autoFocus?: boolean }> = ({ autoFocus }) => {
  const { t } = useTranslation(['settings', 'common']);
  const s = useVoiceSettingsStore();
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const inApp = isTauri();
  const provider = AI_PROVIDERS.find((p) => p.id === s.aiProvider);
  const configured = isAiProviderConfigured(s);
  const offersSystem = availableEngineKinds().includes('system');
  const selected = selectedEngineKind(s);

  // The provider list in the store holds English defaults; what is shown is looked up by id.
  const providerLabel = (p: (typeof AI_PROVIDERS)[number]): string =>
    p.id === 'kokoro' ? t('voice.providers.kokoro')
      : p.id === 'openai-compatible' ? t('voice.providers.compatible')
        : p.label; // brand names
  const providerCost = (p: (typeof AI_PROVIDERS)[number]): string => {
    switch (p.id) {
      case 'kokoro': return t('voice.cost.kokoro');
      case 'gemini': return t('voice.cost.gemini');
      case 'openai': return t('voice.cost.openai');
      case 'elevenlabs': return t('voice.cost.elevenlabs');
      case 'azure': return t('voice.cost.azure');
      case 'openai-compatible': return t('voice.cost.compatible');
      default: return p.cost;
    }
  };
  const providerKeyHint = (p: (typeof AI_PROVIDERS)[number]): string => {
    switch (p.id) {
      case 'gemini': return t('voice.keyHint.gemini');
      case 'azure': return t('voice.keyHint.azure');
      case 'openai-compatible': return t('voice.keyHint.optional');
      default: return p.keyHint; // key formats such as sk-…
    }
  };

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
      setTestResult({ ok: true, message: t('voice.testOk', { count: voices.length }) });
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
            {inApp ? t('voice.useSystemDevice') : t('voice.useSystemComputer')}
          </label>
          <label className="voice-provider-radio">
            <input
              type="radio"
              name="table-read-engine"
              checked={selected === 'ai'}
              onChange={() => changed(s.setEnginePreference)('ai')}
            />{' '}
            {t('voice.useAi')}
          </label>
          <div className="settings-hint">
            {inApp ? t('voice.systemHintApp') : t('voice.systemHintBrowser')}
            {!inApp && ` ${t('voice.systemHintBrowserExtra')}`}
          </div>
        </div>
      )}

      {selected === 'ai' && (
        <>
          <div className="settings-row">
            <label htmlFor="voice-provider">{t('voice.provider')}</label>
            <Select
              id="voice-provider"
              value={s.aiProvider}
              autoFocus={autoFocus}
              onChange={(e) => changed(s.setAiProvider)(e.target.value as AiProviderId | '')}
            >
              <option value="">{t('voice.chooseProvider')}</option>
              {AI_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{providerLabel(p)}</option>)}
            </Select>
          </div>

          {provider && (
            <div className="settings-hint voice-provider-cost">{providerCost(provider)}</div>
          )}

          {/* Anything but Kokoro sends the script's text off this device. */}
          {provider ? providerIsRemote(provider.id) && <ConfidentialityWarning provider={provider.id === 'openai-compatible' ? t('voice.yourSpeechServer') : providerLabel(provider)} gemini={provider.id === 'gemini'} />
            : <ConfidentialityWarning provider={t('voice.providerYouChoose')} />}

          {provider?.local && (
            <div className="voice-provider-local" role="note">
              {inApp ? t('voice.kokoroApp') : t('voice.kokoroBrowser')}
            </div>
          )}

          {provider && !provider.local && (
            <div className="settings-row">
              <label htmlFor="voice-provider-key">
                {provider.keyOptional ? t('voice.apiKeyOptional') : t('voice.apiKey')}
              </label>
              <div className="voice-provider-key-row">
                <input
                  id="voice-provider-key"
                  type={showKey ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={providerKeyHint(provider)}
                  value={s.apiKeys[provider.id] ?? ''}
                  onChange={(e) => changed((v: string) => s.setApiKey(provider.id, v))(e.target.value)}
                />
                <button type="button" onClick={() => setShowKey((v) => !v)}>{showKey ? t('voice.hide') : t('voice.show')}</button>
              </div>
              {provider.keyUrl && (
                <div className="settings-hint">
                  <a
                    href={provider.keyUrl}
                    onClick={(e) => {
                      e.preventDefault();
                      openExternal(provider.keyUrl!).catch((err) => showToast(t('voice.linkFailed', { error: String(err) }), 'error'));
                    }}
                  >
                    {provider.id === 'azure' ? t('voice.createAzure') : t('voice.getKey', { provider: providerLabel(provider) })}
                  </a>
                </div>
              )}
              <div className="settings-hint">
                {inApp
                  ? t('voice.keyKeptApp', { provider: provider.id === 'openai-compatible' ? t('voice.yourServer') : providerLabel(provider) })
                  : t('voice.keyKeptBrowser', { provider: provider.id === 'openai-compatible' ? t('voice.yourServer') : providerLabel(provider) })}
              </div>
            </div>
          )}

          {s.aiProvider === 'gemini' && (
            <div className="settings-row">
              <label htmlFor="voice-gemini-model">{t('voice.model')}</label>
              <Select id="voice-gemini-model" value={s.geminiModel} onChange={(e) => changed(s.setGeminiModel)(e.target.value)}>
                {GEMINI_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
              <div className="settings-hint">
                {t('voice.geminiHint')}
              </div>
            </div>
          )}

          {s.aiProvider === 'azure' && (
            <div className="settings-row">
              <label htmlFor="voice-azure-region">{t('voice.region')}</label>
              <input
                id="voice-azure-region"
                type="text"
                spellCheck={false}
                placeholder={t('voice.regionPlaceholder')}
                value={s.azureRegion}
                onChange={(e) => changed(s.setAzureRegion)(e.target.value)}
              />
              <div className="settings-hint">{t('voice.regionHint')}</div>
            </div>
          )}

          {s.aiProvider === 'openai' && (
            <div className="settings-row">
              <label htmlFor="voice-openai-model">{t('voice.model')}</label>
              <Select id="voice-openai-model" value={s.openaiModel} onChange={(e) => changed(s.setOpenaiModel)(e.target.value)}>
                {OPENAI_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
          )}

          {s.aiProvider === 'elevenlabs' && (
            <div className="settings-row">
              <label htmlFor="voice-eleven-model">{t('voice.model')}</label>
              <Select id="voice-eleven-model" value={s.elevenlabsModel} onChange={(e) => changed(s.setElevenlabsModel)(e.target.value)}>
                {ELEVENLABS_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </Select>
            </div>
          )}

          {s.aiProvider === 'openai-compatible' && (
            <>
              <div className="settings-row">
                <label htmlFor="voice-compat-url">{t('voice.serverAddress')}</label>
                <input
                  id="voice-compat-url"
                  type="url"
                  spellCheck={false}
                  value={s.compatibleBaseUrl}
                  placeholder="http://localhost:8880/v1" /* i18n-ignore example URL */
                  onChange={(e) => changed(s.setCompatibleBaseUrl)(e.target.value)}
                />
                <div className="settings-hint">
                  <Trans ns="settings" i18nKey="voice.serverAddressHint" components={{ code: <code /> }} />
                </div>
              </div>
              <div className="settings-row">
                <label htmlFor="voice-compat-model">{t('voice.model')}</label>
                <input
                  id="voice-compat-model"
                  type="text"
                  spellCheck={false}
                  value={s.compatibleModel}
                  onChange={(e) => changed(s.setCompatibleModel)(e.target.value)}
                />
              </div>
              <div className="settings-row">
                <label htmlFor="voice-compat-voices">{t('voice.voices')}</label>
                <input
                  id="voice-compat-voices"
                  type="text"
                  spellCheck={false}
                  placeholder={t('voice.voicesPlaceholder')}
                  value={s.compatibleVoices}
                  onChange={(e) => changed(s.setCompatibleVoices)(e.target.value)}
                />
                <div className="settings-hint">{t('voice.voicesHint')}</div>
              </div>
            </>
          )}

          {provider && (
            <div className="settings-row voice-provider-test">
              <button type="button" onClick={test} disabled={!configured || testing}>
                {testing ? t('voice.testing') : t('voice.test')}
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
