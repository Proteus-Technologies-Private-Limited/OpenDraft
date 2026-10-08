/**
 * Table Read preferences (issue #131): which voices read the script, and how.
 *
 * Kept per device in localStorage, not in the script. Voice providers and
 * their keys belong to the writer's machine or browser, not to a document that
 * may be shared; per-character voices are the exception and live on the
 * character profile, so they travel with the script.
 *
 * API keys never leave the browser except in requests to the provider the
 * writer configured — OpenDraft's own servers never see them.
 */
import { create } from 'zustand';
import type { CharacterVoice } from './editorStore';

export type AiProviderId = 'kokoro' | 'gemini' | 'openai' | 'elevenlabs' | 'azure' | 'openai-compatible';

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  /** Placeholder for the key field; '' = this provider takes no key. */
  keyHint: string;
  keyUrl?: string;
  /** Runs on this device: the script is never sent anywhere. */
  local?: boolean;
  /** A key is optional (a self-hosted server may not ask for one). */
  keyOptional?: boolean;
  /** One line on cost, shown under the provider list. */
  cost: string;
}

export const AI_PROVIDERS: AiProviderInfo[] = [
  {
    id: 'kokoro', label: 'Kokoro — free, runs on this device', keyHint: '', local: true,
    cost: 'Free, with no account. English voices only.',
  },
  {
    id: 'gemini', label: 'Google Gemini', keyHint: 'Gemini API key', keyUrl: 'https://aistudio.google.com/apikey',
    cost: 'Free tier with a Google account (with daily limits); paid tier billed by Google.',
  },
  {
    id: 'openai', label: 'OpenAI', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys',
    cost: 'Paid, billed by OpenAI per character.',
  },
  {
    id: 'elevenlabs', label: 'ElevenLabs', keyHint: 'xi-api-key', keyUrl: 'https://elevenlabs.io/app/settings/api-keys',
    cost: 'Small free allowance each month; paid plans beyond it.',
  },
  {
    id: 'azure', label: 'Microsoft Azure Speech', keyHint: 'Speech resource key', keyUrl: 'https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices',
    cost: 'Free tier of 500,000 characters a month; paid beyond it.',
  },
  {
    id: 'openai-compatible', label: 'OpenAI-compatible server', keyHint: 'Optional', keyOptional: true,
    cost: 'Whatever your server costs — free when it runs on your own machine.',
  },
];

export const OPENAI_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] as const;
export const ELEVENLABS_MODELS = ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_turbo_v2_5'] as const;
export const GEMINI_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts'] as const;

/** Which engine family reads the script on a platform that offers both. */
export type EnginePreference = 'system' | 'ai';

export interface TableReadOptions {
  readSceneHeadings: boolean;
  readAction: boolean;
  readParentheticals: boolean;
  readTransitions: boolean;
  /** Say the character's name before each speech, as a narrator would. */
  announceCharacters: boolean;
  /** Scroll the script to keep the line being read on screen. */
  followScript: boolean;
  /** 0.5–2; 1 is each engine's normal speed. */
  rate: number;
}

export interface VoiceSettingsState {
  enginePreference: EnginePreference;
  /**
   * The writer has picked a voice source. Only consulted in a browser, where
   * Table Read asks before it reads anything; the app starts on the device's
   * voices without asking.
   */
  engineChosen: boolean;
  aiProvider: AiProviderId | '';
  apiKeys: Partial<Record<AiProviderId, string>>;
  openaiModel: string;
  elevenlabsModel: string;
  geminiModel: string;
  /** Azure region of the Speech resource, e.g. 'eastus'. */
  azureRegion: string;
  /** Base URL of an OpenAI-compatible speech server, up to and including /v1. */
  compatibleBaseUrl: string;
  compatibleModel: string;
  /** Voices to offer when the compatible server cannot list its own. */
  compatibleVoices: string;
  /** The voice for scene headings, action and transitions. */
  narratorVoice: CharacterVoice;
  options: TableReadOptions;

  setEnginePreference: (p: EnginePreference) => void;
  setAiProvider: (p: AiProviderId | '') => void;
  setApiKey: (p: AiProviderId, key: string) => void;
  setOpenaiModel: (m: string) => void;
  setElevenlabsModel: (m: string) => void;
  setGeminiModel: (m: string) => void;
  setAzureRegion: (r: string) => void;
  setCompatibleBaseUrl: (url: string) => void;
  setCompatibleModel: (m: string) => void;
  setCompatibleVoices: (v: string) => void;
  setNarratorVoice: (slot: keyof CharacterVoice, id: string | undefined) => void;
  setOptions: (patch: Partial<TableReadOptions>) => void;
}

const STORAGE_KEY = 'opendraft:tableRead';

export const DEFAULT_TABLE_READ_OPTIONS: TableReadOptions = {
  readSceneHeadings: true,
  readAction: true,
  readParentheticals: false,
  readTransitions: true,
  announceCharacters: false,
  followScript: true,
  rate: 1,
};

type Persisted = Omit<VoiceSettingsState,
  | 'setEnginePreference' | 'setAiProvider' | 'setApiKey' | 'setOpenaiModel'
  | 'setElevenlabsModel' | 'setGeminiModel' | 'setAzureRegion' | 'setCompatibleBaseUrl' | 'setCompatibleModel'
  | 'setCompatibleVoices' | 'setNarratorVoice' | 'setOptions'>;

const DEFAULTS: Persisted = {
  enginePreference: 'system',
  engineChosen: false,
  aiProvider: '',
  apiKeys: {},
  openaiModel: OPENAI_MODELS[0],
  elevenlabsModel: ELEVENLABS_MODELS[0],
  geminiModel: GEMINI_MODELS[0],
  azureRegion: '',
  compatibleBaseUrl: 'http://localhost:8880/v1',
  compatibleModel: 'kokoro',
  compatibleVoices: '',
  narratorVoice: {},
  options: DEFAULT_TABLE_READ_OPTIONS,
};

function clampRate(rate: unknown): number {
  const n = typeof rate === 'number' && Number.isFinite(rate) ? rate : 1;
  return Math.min(2, Math.max(0.5, n));
}

/** Read the stored settings, falling back field by field so one bad value cannot wipe the rest. */
export function loadVoiceSettings(raw: string | null): Persisted {
  if (!raw) return { ...DEFAULTS };
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object') return { ...DEFAULTS };
    parsed = value as Record<string, unknown>;
  } catch {
    return { ...DEFAULTS };
  }
  const str = (k: keyof Persisted, fallback: string) =>
    typeof parsed[k] === 'string' ? (parsed[k] as string) : fallback;
  const providers = AI_PROVIDERS.map((p) => p.id) as string[];
  const provider = str('aiProvider', '');
  const keys: Partial<Record<AiProviderId, string>> = {};
  if (parsed.apiKeys && typeof parsed.apiKeys === 'object') {
    for (const [k, v] of Object.entries(parsed.apiKeys as Record<string, unknown>)) {
      if (providers.includes(k) && typeof v === 'string') keys[k as AiProviderId] = v;
    }
  }
  const narrator: CharacterVoice = {};
  if (parsed.narratorVoice && typeof parsed.narratorVoice === 'object') {
    const nv = parsed.narratorVoice as Record<string, unknown>;
    if (typeof nv.system === 'string') narrator.system = nv.system;
    if (typeof nv.ai === 'string') narrator.ai = nv.ai;
  }
  const opts = { ...DEFAULT_TABLE_READ_OPTIONS };
  if (parsed.options && typeof parsed.options === 'object') {
    const o = parsed.options as Record<string, unknown>;
    for (const k of Object.keys(DEFAULT_TABLE_READ_OPTIONS) as (keyof TableReadOptions)[]) {
      if (k === 'rate') continue;
      if (typeof o[k] === 'boolean') (opts as Record<string, unknown>)[k] = o[k];
    }
    opts.rate = clampRate(o.rate);
  }
  return {
    enginePreference: parsed.enginePreference === 'ai' ? 'ai' : 'system',
    engineChosen: parsed.engineChosen === true,
    aiProvider: providers.includes(provider) ? (provider as AiProviderId) : '',
    apiKeys: keys,
    openaiModel: str('openaiModel', DEFAULTS.openaiModel),
    elevenlabsModel: str('elevenlabsModel', DEFAULTS.elevenlabsModel),
    geminiModel: str('geminiModel', DEFAULTS.geminiModel),
    azureRegion: str('azureRegion', ''),
    compatibleBaseUrl: str('compatibleBaseUrl', DEFAULTS.compatibleBaseUrl),
    compatibleModel: str('compatibleModel', DEFAULTS.compatibleModel),
    compatibleVoices: str('compatibleVoices', ''),
    narratorVoice: narrator,
    options: opts,
  };
}

function initial(): Persisted {
  try {
    return loadVoiceSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(state: VoiceSettingsState) {
  const out: Persisted = {
    enginePreference: state.enginePreference,
    engineChosen: state.engineChosen,
    aiProvider: state.aiProvider,
    apiKeys: state.apiKeys,
    openaiModel: state.openaiModel,
    elevenlabsModel: state.elevenlabsModel,
    geminiModel: state.geminiModel,
    azureRegion: state.azureRegion,
    compatibleBaseUrl: state.compatibleBaseUrl,
    compatibleModel: state.compatibleModel,
    compatibleVoices: state.compatibleVoices,
    narratorVoice: state.narratorVoice,
    options: state.options,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch (err) {
    console.warn('[tableRead] could not save voice settings:', err);
  }
}

export const useVoiceSettingsStore = create<VoiceSettingsState>((set, get) => {
  const update = (patch: Partial<Persisted>) => {
    set(patch);
    persist(get());
  };
  return {
    ...initial(),
    setEnginePreference: (p) => update({ enginePreference: p, engineChosen: true }),
    setAiProvider: (p) => update({ aiProvider: p }),
    setApiKey: (p, key) => update({ apiKeys: { ...get().apiKeys, [p]: key.trim() } }),
    setOpenaiModel: (m) => update({ openaiModel: m }),
    setElevenlabsModel: (m) => update({ elevenlabsModel: m }),
    setGeminiModel: (m) => update({ geminiModel: m }),
    // Accepts "East US" or "eastus"; Azure's endpoints use the bare form.
    setAzureRegion: (r) => update({ azureRegion: r.trim().toLowerCase().replace(/\s+/g, '') }),
    setCompatibleBaseUrl: (url) => update({ compatibleBaseUrl: url.trim().replace(/\/+$/, '') }),
    setCompatibleModel: (m) => update({ compatibleModel: m.trim() }),
    setCompatibleVoices: (v) => update({ compatibleVoices: v }),
    setNarratorVoice: (slot, id) => {
      const next = { ...get().narratorVoice };
      if (id) next[slot] = id;
      else delete next[slot];
      update({ narratorVoice: next });
    },
    setOptions: (patch) => {
      const merged = { ...get().options, ...patch };
      merged.rate = clampRate(merged.rate);
      update({ options: merged });
    },
  };
});

/** True when the configured AI provider has what it needs to make a request. */
export function isAiProviderConfigured(
  s: Pick<VoiceSettingsState, 'aiProvider' | 'apiKeys' | 'compatibleBaseUrl'> & Partial<Pick<VoiceSettingsState, 'azureRegion'>>,
): boolean {
  if (!s.aiProvider) return false;
  if (s.aiProvider === 'kokoro') return true;
  if (s.aiProvider === 'openai-compatible') return /^https?:\/\//i.test(s.compatibleBaseUrl);
  if (s.aiProvider === 'azure') return !!s.apiKeys.azure && !!s.azureRegion;
  return !!s.apiKeys[s.aiProvider];
}

/** Whether the provider sends the script's text off this device. */
export function providerIsRemote(id: AiProviderId | ''): boolean {
  return !!id && !AI_PROVIDERS.find((p) => p.id === id)?.local;
}
