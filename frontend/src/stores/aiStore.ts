/**
 * Assistant state: the panel's open/closed flag, the provider settings (kept in
 * localStorage on this device only) and the conversation.
 *
 * Messages are not persisted: closing the app starts a fresh conversation,
 * which is the safe default for a prototype. The API key, when one is used,
 * never leaves the machine except to the server the writer configured.
 */
import { create } from 'zustand';
import {
  DEFAULT_OLLAMA_URL,
  type AiProviderKind,
  type AiSettings,
} from '../services/ai/provider';

const SETTINGS_KEY = 'opendraft:ai';
const PREVIEW_KEY = 'opendraft:aiPreview';
const MAX_MESSAGES = 200;

export interface AiUiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: number;
}

interface AiState {
  panelOpen: boolean;
  settings: AiSettings;
  messages: AiUiMessage[];
  busy: boolean;
  error: string | null;
  /** Show what the model proposes before touching the script. */
  previewEnabled: boolean;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  updateSettings: (patch: Partial<AiSettings>) => void;
  setPreviewEnabled: (enabled: boolean) => void;
  addMessage: (role: AiUiMessage['role'], content: string) => void;
  clearMessages: () => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string | null) => void;
}

function loadSettings(): AiSettings {
  const defaults: AiSettings = {
    provider: 'ollama',
    baseUrl: DEFAULT_OLLAMA_URL,
    model: 'qwen2.5',
    apiKey: '',
  };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AiSettings>;
    return {
      provider: parsed.provider === 'openai' ? 'openai' : 'ollama',
      baseUrl: typeof parsed.baseUrl === 'string' && parsed.baseUrl.trim()
        ? parsed.baseUrl.trim()
        : defaults.baseUrl,
      model: typeof parsed.model === 'string' ? parsed.model : defaults.model,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings: AiSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode, a full quota: the assistant still works for this session.
  }
}

let counter = 0;
function messageId(): string {
  counter += 1;
  try {
    return crypto.randomUUID();
  } catch {
    return `ai-${Date.now()}-${counter}`;
  }
}

export const useAiStore = create<AiState>((set, get) => ({
  panelOpen: false,
  settings: loadSettings(),
  messages: [],
  busy: false,
  error: null,
  previewEnabled: (() => {
    try {
      return localStorage.getItem(PREVIEW_KEY) !== '0';
    } catch {
      return true;
    }
  })(),

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (open) => set({ panelOpen: open }),

  updateSettings: (patch) => {
    const settings: AiSettings = { ...get().settings, ...patch };
    saveSettings(settings);
    set({ settings });
  },

  setPreviewEnabled: (enabled) => {
    try {
      localStorage.setItem(PREVIEW_KEY, enabled ? '1' : '0');
    } catch {
      // The choice still lasts for this session.
    }
    set({ previewEnabled: enabled });
  },

  addMessage: (role, content) => set((s) => ({
    messages: [...s.messages, {
      id: messageId(), role, content, at: Date.now(),
    }].slice(-MAX_MESSAGES),
  })),
  clearMessages: () => set({ messages: [], error: null }),
  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),
}));

/** The provider labels used by the settings form. */
export const AI_PROVIDER_LABELS: Record<AiProviderKind, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI-compatible (Unsloth, LM Studio…)',
};
