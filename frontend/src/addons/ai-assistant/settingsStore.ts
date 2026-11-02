/**
 * The assistant's settings, kept on this device only.
 *
 * Never written into scripts, never synced: the server address, the model name
 * and an API key, if the server needs one. `forgetSettings` is what the writer
 * gets when they turn the add-on off and ask for its settings to be deleted.
 */
import type { AiProviderKind } from './client';
import { DEFAULT_OLLAMA_URL, DEFAULT_OPENAI_URL } from './client';

const STORAGE_KEY = 'opendraft:addon:ai-assistant';

export interface AssistantSettings {
  /** Ollama's own API, or an OpenAI-compatible server (Unsloth, LM Studio…). */
  provider: AiProviderKind;
  /** e.g. http://localhost:11434 or http://localhost:8080/v1 */
  baseUrl: string;
  model: string;
  /** Only for servers that need one. Stored on this device, never in scripts. */
  apiKey: string;
}

export const DEFAULT_SETTINGS: AssistantSettings = {
  provider: 'ollama',
  baseUrl: DEFAULT_OLLAMA_URL,
  model: 'qwen2.5',
  apiKey: '',
};

/** The address an OpenAI-compatible local server usually listens on. */
export const DEFAULT_COMPATIBLE_URL = DEFAULT_OPENAI_URL;

export function loadSettings(): AssistantSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw) as Partial<AssistantSettings>;
    return {
      provider: saved.provider === 'openai' ? 'openai' : 'ollama',
      baseUrl: typeof saved.baseUrl === 'string' && saved.baseUrl.trim()
        ? saved.baseUrl.trim()
        : DEFAULT_SETTINGS.baseUrl,
      model: typeof saved.model === 'string' && saved.model.trim()
        ? saved.model.trim()
        : DEFAULT_SETTINGS.model,
      apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
    };
  } catch (err) {
    console.warn('[ai-assistant] could not read settings; using defaults', err);
    return { ...DEFAULT_SETTINGS };
  }
}

/** Throws with a message the settings form can show. */
export function saveSettings(settings: AssistantSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    throw new Error(
      `Could not save the settings on this device: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Called when the writer turns the add-on off and asks for its settings to be deleted. */
export function forgetSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('[ai-assistant] could not delete settings', err);
  }
}
