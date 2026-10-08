/**
 * The voices of the engine that reads the script here (issue #131), reloaded
 * when the voice settings change. Shared by every voice picker.
 */
import { useEffect, useState } from 'react';
import { useVoiceSettingsStore, isAiProviderConfigured } from '../stores/voiceSettingsStore';
import { activeEngineKind, engineFor, NeedsProviderError } from '../services/tts/engines';
import type { EngineKind, VoiceInfo } from '../services/tts/types';

export interface VoiceListState {
  kind: EngineKind;
  voices: VoiceInfo[];
  loading: boolean;
  error: string | null;
  /** AI voices are wanted but no provider is set up. */
  needsProvider: boolean;
}

export function useVoiceList(): VoiceListState {
  const settings = useVoiceSettingsStore();
  const kind = activeEngineKind(settings);
  const needsProvider = kind === 'ai' && !isAiProviderConfigured(settings);
  // Every setting that changes which voices are on offer.
  const key = kind === 'ai'
    ? JSON.stringify([settings.aiProvider, settings.apiKeys, settings.openaiModel, settings.azureRegion, settings.compatibleBaseUrl, settings.compatibleVoices])
    : 'system';
  const [result, setResult] = useState<{ key: string; voices: VoiceInfo[]; error: string | null; needsProvider: boolean } | null>(null);

  useEffect(() => {
    if (needsProvider) return;
    let cancelled = false;
    engineFor(kind)
      .then(({ voices }) => { if (!cancelled) setResult({ key, voices, error: null, needsProvider: false }); })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof NeedsProviderError) {
          setResult({ key, voices: [], error: null, needsProvider: true });
          return;
        }
        console.warn('[tableRead] could not list voices:', err);
        setResult({ key, voices: [], error: err instanceof Error ? err.message : String(err), needsProvider: false });
      });
    return () => { cancelled = true; };
  }, [kind, key, needsProvider]);

  if (needsProvider) return { kind, voices: [], loading: false, error: null, needsProvider: true };
  if (!result || result.key !== key) return { kind, voices: [], loading: true, error: null, needsProvider: false };
  return { kind, voices: result.voices, loading: false, error: result.error, needsProvider: result.needsProvider };
}
