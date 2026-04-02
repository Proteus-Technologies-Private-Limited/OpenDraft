import { create } from 'zustand';

export interface CollabUser {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}

export interface CollabAuth {
  accessToken: string | null;
  refreshToken: string | null;
  user: CollabUser | null;
}

interface SettingsState {
  // Collab server URL (ws:// or wss://)
  collabServerUrl: string;
  setCollabServerUrl: (url: string) => void;

  // Collab auth state
  collabAuth: CollabAuth;
  setCollabAuth: (auth: CollabAuth) => void;
  clearCollabAuth: () => void;

  // Default invite expiry (hours)
  defaultInviteExpiry: number;
  setDefaultInviteExpiry: (hours: number) => void;

  // Settings dialog open state
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
}

const STORAGE_KEY_URL = 'opendraft:collabServerUrl';
const STORAGE_KEY_AUTH = 'opendraft:collabAuth';
const STORAGE_KEY_EXPIRY = 'opendraft:defaultInviteExpiry';

const DEFAULT_COLLAB_URL = 'ws://localhost:4000';

function loadAuth(): CollabAuth {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_AUTH);
    if (raw) return JSON.parse(raw) as CollabAuth;
  } catch { /* ignore */ }
  return { accessToken: null, refreshToken: null, user: null };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  collabServerUrl: localStorage.getItem(STORAGE_KEY_URL) || DEFAULT_COLLAB_URL,
  setCollabServerUrl: (url) => {
    localStorage.setItem(STORAGE_KEY_URL, url);
    set({ collabServerUrl: url });
  },


  collabAuth: loadAuth(),
  setCollabAuth: (auth) => {
    localStorage.setItem(STORAGE_KEY_AUTH, JSON.stringify(auth));
    set({ collabAuth: auth });
  },
  clearCollabAuth: () => {
    localStorage.removeItem(STORAGE_KEY_AUTH);
    set({ collabAuth: { accessToken: null, refreshToken: null, user: null } });
  },

  defaultInviteExpiry: parseInt(localStorage.getItem(STORAGE_KEY_EXPIRY) || '1', 10),
  setDefaultInviteExpiry: (hours) => {
    localStorage.setItem(STORAGE_KEY_EXPIRY, String(hours));
    set({ defaultInviteExpiry: hours });
  },

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
