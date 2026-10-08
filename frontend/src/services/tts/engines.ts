/**
 * Which engine reads the script here.
 *
 *  - In the app (Tauri), the voices installed on the machine unless the writer
 *    has switched to an AI provider. The web view's own speech synthesis is
 *    used where it has voices (macOS, Windows, iOS); otherwise the platform's
 *    text-to-speech through Tauri (Android, Linux).
 *  - In a browser, whichever the writer picks the first time: the machine's
 *    voices, which the browser offers through `speechSynthesis`, or an AI
 *    provider. Nothing is read until they have picked one.
 */
import { isTauri, getOS } from '../platform';
import {
  isAiProviderConfigured,
  useVoiceSettingsStore,
  type VoiceSettingsState,
} from '../../stores/voiceSettingsStore';
import { AiEngine } from './aiEngine';
import { NativeEngine } from './nativeEngine';
import { hasWebSpeech, WebSpeechEngine } from './webSpeechEngine';
import { TtsUnavailableError, type EngineKind, type TtsEngine, type VoiceInfo } from './types';

/** Thrown when a read needs an AI provider and none is configured yet. */
export class NeedsProviderError extends TtsUnavailableError {
  constructor() {
    super('Set up an AI voice provider to hear the script read aloud in the browser.');
    this.name = 'NeedsProviderError';
  }
}

/** Engine families this platform can offer. */
export function availableEngineKinds(): EngineKind[] {
  return isTauri() || hasWebSpeech() ? ['system', 'ai'] : ['ai'];
}

/** The family a read will use, from the platform and the writer's choice. */
export function activeEngineKind(
  s: Pick<VoiceSettingsState, 'enginePreference' | 'engineChosen'> = useVoiceSettingsStore.getState(),
): EngineKind {
  if (isTauri()) return s.enginePreference === 'ai' ? 'ai' : 'system';
  // A browser with no speech synthesis has only AI voices to offer. One that
  // has it reads with nothing until the writer has chosen: 'ai' with no
  // provider configured is what opens the setup dialog.
  if (!hasWebSpeech() || !s.engineChosen) return 'ai';
  return s.enginePreference === 'ai' ? 'ai' : 'system';
}

/**
 * What the voice-source choice shows as selected. In a browser that has not
 * chosen yet that is null — unless an AI provider is already set up (from
 * before the browser offered installed voices), which is what reads then.
 */
export function selectedEngineKind(
  s: Pick<VoiceSettingsState, 'enginePreference' | 'engineChosen' | 'aiProvider' | 'apiKeys' | 'compatibleBaseUrl'> = useVoiceSettingsStore.getState(),
): EngineKind | null {
  if (!availableEngineKinds().includes('system')) return 'ai';
  if (!isTauri() && !s.engineChosen) return isAiProviderConfigured(s) ? 'ai' : null;
  return s.enginePreference === 'ai' ? 'ai' : 'system';
}

let systemEngine: Promise<{ engine: TtsEngine; voices: VoiceInfo[] }> | null = null;

function noVoicesMessage(): string {
  if (!isTauri()) {
    return 'This browser offers no speech voices. Choose an AI voice provider in the voice source settings instead.';
  }
  switch (getOS()) {
    case 'linux':
      return 'No speech voices were found. Install speech-dispatcher (spd-say) or eSpeak NG from your distribution, then try again.';
    case 'android':
      return 'No text-to-speech voices are installed. Add one in Android Settings → Accessibility → Text-to-speech output, then try again.';
    case 'windows':
      return 'No speech voices were found. Add one in Windows Settings → Time & language → Speech, then try again.';
    default:
      return 'No speech voices were found on this device.';
  }
}

/** The machine's voices, found once per session. */
export function systemVoices(): Promise<{ engine: TtsEngine; voices: VoiceInfo[] }> {
  if (!systemEngine) {
    systemEngine = (async () => {
      if (hasWebSpeech()) {
        const web = new WebSpeechEngine();
        try {
          const voices = await web.listVoices();
          if (voices.length) return { engine: web as TtsEngine, voices };
          console.info('[tableRead] web view speech has no voices; trying the platform engine');
        } catch (err) {
          console.warn('[tableRead] web view speech failed to list voices:', err);
        }
      }
      if (isTauri()) {
        const native = new NativeEngine();
        try {
          const voices = await native.listVoices();
          if (voices.length) return { engine: native as TtsEngine, voices };
        } catch (err) {
          console.warn('[tableRead] platform speech engine unavailable:', err);
          throw new TtsUnavailableError(
            `${noVoicesMessage()} (${err instanceof Error ? err.message : String(err)})`,
          );
        }
      }
      throw new TtsUnavailableError(noVoicesMessage());
    })();
    // A failure is not remembered: the writer may install a voice and retry.
    systemEngine.catch(() => { systemEngine = null; });
  }
  return systemEngine;
}

let aiCache: { signature: string; engine: AiEngine } | null = null;

function aiSignature(s: VoiceSettingsState): string {
  return JSON.stringify([s.aiProvider, s.apiKeys[s.aiProvider as keyof typeof s.apiKeys] || '',
    s.openaiModel, s.elevenlabsModel, s.geminiModel, s.azureRegion, s.compatibleBaseUrl, s.compatibleModel, s.compatibleVoices]);
}

/** The configured AI engine, rebuilt only when its settings change. */
export function aiEngine(s: VoiceSettingsState = useVoiceSettingsStore.getState()): AiEngine {
  if (!isAiProviderConfigured(s)) throw new NeedsProviderError();
  const signature = aiSignature(s);
  if (aiCache?.signature !== signature) {
    aiCache?.engine.dispose();
    aiCache = { signature, engine: new AiEngine(s) };
  }
  return aiCache.engine;
}

/** The engine for `kind` and the voices it offers. */
export async function engineFor(kind: EngineKind): Promise<{ engine: TtsEngine; voices: VoiceInfo[] }> {
  if (kind === 'system') return systemVoices();
  const engine = aiEngine();
  return { engine, voices: await engine.listVoices() };
}
