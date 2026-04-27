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

  // Whether the persisted token has been verified against the server during
  // this app session. Always starts false — a stored token alone never proves
  // "logged in" if the server hasn't confirmed it yet (e.g. offline boot).
  authVerified: boolean;
  setAuthVerified: (verified: boolean) => void;

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

const DEFAULT_COLLAB_URL = 'wss://opendraft-collab-267958344432.us-central1.run.app';

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
    // A fresh token from login/refresh is implicitly verified — the server
    // just issued it. Avoids a flicker where AuthIndicator briefly shows
    // "Local only" right after sign-in while we wait for /auth/me.
    set({ collabAuth: auth, authVerified: Boolean(auth.accessToken && auth.user) });
  },
  clearCollabAuth: () => {
    localStorage.removeItem(STORAGE_KEY_AUTH);
    set({
      collabAuth: { accessToken: null, refreshToken: null, user: null },
      authVerified: false,
    });
  },

  authVerified: false,
  setAuthVerified: (verified) => set({ authVerified: verified }),

  defaultInviteExpiry: parseInt(localStorage.getItem(STORAGE_KEY_EXPIRY) || '1', 10),
  setDefaultInviteExpiry: (hours) => {
    localStorage.setItem(STORAGE_KEY_EXPIRY, String(hours));
    set({ defaultInviteExpiry: hours });
  },

  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
