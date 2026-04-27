import { getApiBase } from '../config';
import { useSettingsStore } from '../stores/settingsStore';
import type { CollabAuth, CollabUser } from '../stores/settingsStore';
import { platformFetch } from './platform';
import { authedFetch } from './authedFetch';

// ── URL helpers ──

function getCollabHttpBase(): string {
  const wsUrl = useSettingsStore.getState().collabServerUrl;
  return wsUrl.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
}

// ── HTTP helpers ──

/** Convert `TypeError: Failed to fetch` (network / CORS) into an actionable
 *  message. Browsers give the same opaque error regardless of the root cause;
 *  a generic "cannot reach server" is more useful than "Failed to fetch". */
function wrapNetworkError(err: unknown, where: string): Error {
  if (err instanceof TypeError) {
    return new Error(`Cannot reach ${where}. Check that the server is running and reachable.`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function parseError(res: Response, fallbackLabel: string): Promise<Error> {
  try {
    const body = await res.json();
    const msg = body?.error || body?.detail?.error || body?.detail?.message
      || body?.detail || body?.message;
    if (typeof msg === 'string') return new Error(msg);
    return new Error(`${fallbackLabel} error ${res.status}`);
  } catch {
    return new Error(`${fallbackLabel} error ${res.status}`);
  }
}

/**
 * Auth HTTP — routes through the Python backend at /api/auth/*, which proxies
 * to the collab server. The frontend only needs to reach its own backend;
 * network/CORS issues with the collab host are surfaced as a clean 502 by the
 * backend rather than a raw browser "Failed to fetch".
 */
async function backendAuthRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new Error('OpenDraft Cloud is not configured for this app. Open Settings → System Settings to set the OpenDraft server URL.');
  }
  const url = `${base}/auth${path}`;
  let res: Response;
  try {
    // platformFetch tunnels through Tauri's http_fetch invoke when running
    // inside a WebView, sidestepping the WKWebView/Android-WebView mixed-
    // content block on plain HTTP backends.
    res = await platformFetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
  } catch (err) {
    throw wrapNetworkError(err, 'the OpenDraft backend');
  }
  if (!res.ok) throw await parseError(res, 'Auth');
  return res.json();
}

/** Same as backendAuthRequest but attaches the bearer token and refreshes on 401. */
async function backendAuthedRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getApiBase();
  if (!base) {
    throw new Error('OpenDraft Cloud is not configured for this app. Open Settings → System Settings to set the OpenDraft server URL.');
  }
  const url = `${base}/auth${path}`;
  let res: Response;
  try {
    res = await authedFetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
  } catch (err) {
    throw wrapNetworkError(err, 'the OpenDraft backend');
  }
  if (!res.ok) throw await parseError(res, 'Auth');
  return res.json();
}

/**
 * Collab-server HTTP — used ONLY for endpoints that live on the collab
 * server itself (reset-document, close-document, revoke-my-sessions). Auth
 * endpoints go through backendAuthRequest above.
 */
async function collabRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getCollabHttpBase();
  let res: Response;
  try {
    res = await platformFetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
  } catch (err) {
    throw wrapNetworkError(err, 'the collaboration server');
  }
  if (!res.ok) throw await parseError(res, 'Collab');
  return res.json();
}

async function collabAuthedRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getCollabHttpBase();
  let res: Response;
  try {
    res = await authedFetch(`${base}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options?.headers },
    });
  } catch (err) {
    throw wrapNetworkError(err, 'the collaboration server');
  }
  if (!res.ok) throw await parseError(res, 'Collab');
  return res.json();
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
    backendAuthRequest<AuthResponse>('/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),

  login: (email: string, password: string) =>
    backendAuthRequest<AuthResponse>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  refresh: (refreshToken: string) =>
    backendAuthRequest<{ accessToken: string; refreshToken: string }>('/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  logout: (refreshToken: string) =>
    backendAuthRequest<{ message: string }>('/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  verifyEmail: (code: string) =>
    backendAuthedRequest<{ message: string }>('/verify-email', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),

  /** Unauthenticated magic-link verification: used by the /verify route and
   * by the OTP dialog when the user has no session token yet. Returns a fresh
   * token pair so the frontend can log the user in on link-click. */
  verifyEmailLink: (email: string, code: string) =>
    backendAuthRequest<AuthResponse>('/verify-email-link', {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    }),

  resendVerification: () =>
    backendAuthedRequest<{ message: string }>('/resend-verification', {
      method: 'POST',
    }),

  loginWithGoogle: (idToken: string) =>
    backendAuthRequest<AuthResponse>('/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),

  getMe: () =>
    backendAuthedRequest<CollabUser>('/me'),

  getServerConfig: () =>
    backendAuthRequest<CollabServerConfig>('/config'),

  /** Test reachability of the *collab* server directly (used by Settings to
   * show connection status for the websocket host). Auth flows don't depend
   * on this — they go through the backend proxy. */
  testConnection: async (): Promise<boolean> => {
    try {
      const base = getCollabHttpBase();
      const res = await platformFetch(`${base}/health`);
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

  /** Close all connections for a document (called by host after ending a session) */
  closeDocument: (documentName: string) =>
    collabRequest<{ status: string }>('/api/close-document', {
      method: 'POST',
      body: JSON.stringify({ documentName }),
    }),

  /** Revoke all collab sessions created by the authenticated user (called on logout) */
  revokeMyCollabSessions: () =>
    collabAuthedRequest<{ message: string }>('/api/collab/my-sessions', { method: 'DELETE' }),
};

// ── Helper: check if current auth is valid (token present and not expired) ──

export function isCollabAuthenticated(): boolean {
  const { collabAuth } = useSettingsStore.getState();
  if (!collabAuth.accessToken) return false;
  try {
    const payload = JSON.parse(atob(collabAuth.accessToken.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      // Token expired — clear it
      console.log('[collabAuth] Access token expired, clearing auth');
      useSettingsStore.getState().clearCollabAuth();
      return false;
    }
  } catch {
    // Malformed token
    useSettingsStore.getState().clearCollabAuth();
    return false;
  }
  return true;
}

// ── Helper: handle auth response and store tokens ──

export function handleAuthResponse(response: AuthResponse): CollabAuth {
  const auth: CollabAuth = {
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    user: response.user,
  };
  console.log('[collabAuth] Authenticated as', auth.user?.displayName);
  useSettingsStore.getState().setCollabAuth(auth);
  return auth;
}

/**
 * Callback set by ScreenplayEditor to tear down an active collab session.
 * Called by performLogout before revoking tokens.
 */
let _onLogoutCollabTeardown: (() => Promise<void>) | null = null;

export function setLogoutCollabTeardown(fn: (() => Promise<void>) | null): void {
  _onLogoutCollabTeardown = fn;
}

/**
 * Callback set by ScreenplayEditor to flush pending saves for a cloud file
 * and close the editor back to a blank document. Called by performLogout
 * *before* the access token is revoked so the final save still authenticates.
 * Without this, the editor's auto-save loop keeps firing after signout and
 * every PUT returns 401.
 */
let _onLogoutEditorReset: (() => Promise<void>) | null = null;

export function setLogoutEditorReset(fn: (() => Promise<void>) | null): void {
  _onLogoutEditorReset = fn;
}

export async function performLogout(): Promise<void> {
  const { collabAuth, clearCollabAuth } = useSettingsStore.getState();

  // 1. End any active collab session in the editor
  if (_onLogoutCollabTeardown) {
    try { await _onLogoutCollabTeardown(); } catch { /* best-effort */ }
  }

  // 2. Flush any pending cloud save and reset the editor to a blank file.
  //    Runs while the access token is still valid.
  if (_onLogoutEditorReset) {
    try { await _onLogoutEditorReset(); } catch { /* best-effort */ }
  }

  // 3. Revoke all collab invite links this user created on the server
  if (collabAuth.accessToken) {
    try { await collabAuthApi.revokeMyCollabSessions(); } catch { /* best-effort */ }
  }

  // 4. Revoke the refresh token on the server
  if (collabAuth.refreshToken) {
    try { await collabAuthApi.logout(collabAuth.refreshToken); } catch { /* best-effort */ }
  }

  // 5. Clear local auth state
  clearCollabAuth();
}
