import { useSettingsStore } from '../stores/settingsStore';
import type { CollabAuth, CollabUser } from '../stores/settingsStore';

// ── URL helpers ──

function getCollabHttpBase(): string {
  const wsUrl = useSettingsStore.getState().collabServerUrl;
  return wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

// ── HTTP helpers ──

async function collabRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getCollabHttpBase();
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(detail.error || `Collab API error ${res.status}`);
  }
  return res.json();
}

let isRefreshing = false;

async function authRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const { collabAuth } = useSettingsStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (collabAuth.accessToken) {
    headers['Authorization'] = `Bearer ${collabAuth.accessToken}`;
  }

  try {
    return await collabRequest<T>(path, { ...options, headers });
  } catch (err: any) {
    // On 401, attempt token refresh
    if (err.message?.includes('401') && collabAuth.refreshToken && !isRefreshing) {
      isRefreshing = true;
      try {
        const refreshed = await collabAuthApi.refresh(collabAuth.refreshToken);
        useSettingsStore.getState().setCollabAuth({
          ...collabAuth,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
        });
        // Retry with new token
        headers['Authorization'] = `Bearer ${refreshed.accessToken}`;
        return await collabRequest<T>(path, { ...options, headers });
      } catch {
        // Refresh failed — clear auth
        useSettingsStore.getState().clearCollabAuth();
        throw new Error('Session expired, please log in again');
      } finally {
        isRefreshing = false;
      }
    }
    throw err;
  }
}

// ── API types ──

export interface AuthResponse {
  user: CollabUser;
  accessToken: string;
  refreshToken: string;
}

export interface CollabServerConfig {
  googleEnabled: boolean;
  emailVerificationRequired: boolean;
}

// ── API methods ──

export const collabAuthApi = {
  register: (email: string, password: string, displayName: string) =>
    collabRequest<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),

  login: (email: string, password: string) =>
    collabRequest<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  refresh: (refreshToken: string) =>
    collabRequest<{ accessToken: string; refreshToken: string }>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (refreshToken: string) =>
    collabRequest<{ message: string }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  verifyEmail: (code: string) =>
    authRequest<{ message: string }>('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  resendVerification: () =>
    authRequest<{ message: string }>('/auth/resend-verification', {
      method: 'POST',
    }),

  loginWithGoogle: (idToken: string) =>
    collabRequest<AuthResponse>('/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),

  getMe: () =>
    authRequest<CollabUser>('/auth/me'),

  getServerConfig: () =>
    collabRequest<CollabServerConfig>('/auth/config'),

  testConnection: async (): Promise<boolean> => {
    try {
      const base = getCollabHttpBase();
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  },

  /** Reset a document's persisted Yjs state on the collab server (called by host before starting a new session) */
  resetDocument: (documentName: string, token: string) =>
    collabRequest<{ status: string }>('/api/reset-document', {
      method: 'POST',
      body: JSON.stringify({ documentName, token }),
    }),
};

// ── Helper: handle auth response and store tokens ──

export function handleAuthResponse(response: AuthResponse): CollabAuth {
  const auth: CollabAuth = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    user: response.user,
  };
  useSettingsStore.getState().setCollabAuth(auth);
  return auth;
}

export async function performLogout(): Promise<void> {
  const { collabAuth, clearCollabAuth } = useSettingsStore.getState();
  if (collabAuth.refreshToken) {
    try {
      await collabAuthApi.logout(collabAuth.refreshToken);
    } catch { /* ignore */ }
  }
  clearCollabAuth();
}
