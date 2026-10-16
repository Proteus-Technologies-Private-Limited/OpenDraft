/**
 * authedFetch — fetch wrapper that attaches the Bearer access token and
 * transparently refreshes it on 401.
 *
 * Flow:
 *   1. Fire the request with the current access token (if any).
 *   2. If it returns 401 AND we hold a refresh token, hit /auth/refresh
 *      exactly once and retry the original request with the new access token.
 *   3. If the server rejects the refresh token (400/401/403), clear local
 *      auth state so AuthGate can prompt a fresh sign-in. Any other failure —
 *      rate limit, server error, network — keeps the session: the refresh
 *      token is still good and the next request tries again. The caller
 *      still receives the final Response (the second 401) and can react.
 *
 * Concurrency: N parallel 401s in one tab collapse onto a single in-flight
 * refresh via the module-level promise. Across tabs and windows, a Web Lock
 * serialises refreshes: refresh tokens are single-use, so a second tab
 * spending the same one would be refused and sign everybody out. The tab
 * that waits adopts the pair the first one wrote to localStorage instead.
 * Each caller retries at most once per invocation, so a persistently bad
 * server cannot cause an infinite loop.
 */

import { useSettingsStore } from '../stores/settingsStore';
import type { CollabAuth } from '../stores/settingsStore';
import { collabAuthApi } from './collabAuth';
import { platformFetch } from './platform';

const AUTH_STORAGE_KEY = 'opendraft:collabAuth';
const REFRESH_LOCK_NAME = 'opendraft:auth-refresh';
/** An access token this close to expiry is treated as already expired. */
const EXPIRY_SKEW_MS = 30_000;
/** Refresh responses that mean the refresh token itself is no good. */
const REJECTED_STATUSES = new Set([400, 401, 403]);

let refreshing: Promise<string | null> | null = null;

/** True when the JWT is expired (or about to be), or cannot be read. */
export function accessTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' && payload.exp * 1000 - EXPIRY_SKEW_MS < Date.now();
  } catch {
    return true;
  }
}

/** The auth pair as another tab may have left it in localStorage. */
function readStoredAuth(): CollabAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CollabAuth) : null;
  } catch (err) {
    console.warn('[auth] could not read stored session:', err);
    return null;
  }
}

/** A newer pair another tab wrote while this one held `spent`, if usable. */
function adoptRotatedPair(spent: string): string | null {
  const stored = readStoredAuth();
  if (!stored?.refreshToken || stored.refreshToken === spent) return null;
  if (!stored.accessToken || accessTokenExpired(stored.accessToken)) return null;
  useSettingsStore.getState().setCollabAuth(stored);
  return stored.accessToken;
}

/** Run `fn` holding the cross-tab refresh lock, where the platform has one. */
async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return fn();
  let ran = false;
  try {
    return (await locks.request(REFRESH_LOCK_NAME, () => {
      ran = true;
      return fn();
    })) as T;
  } catch (err) {
    // Only a lock that could not be taken falls back; a failure inside `fn`
    // is the caller's to see.
    if (ran) throw err;
    console.warn('[auth] cross-tab lock unavailable, refreshing without it:', err);
    return fn();
  }
}

/**
 * Exchange the refresh token for a new pair. Resolves to the new access
 * token, or null when no session could be renewed. Never throws.
 */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;
  const heldWhenAsked = useSettingsStore.getState().collabAuth.refreshToken;
  refreshing = withRefreshLock(async () => {
    // Another tab may have rotated the pair while we waited for the lock.
    if (heldWhenAsked) {
      const adopted = adoptRotatedPair(heldWhenAsked);
      if (adopted) return adopted;
    }
    const { collabAuth, setCollabAuth, clearCollabAuth } = useSettingsStore.getState();
    if (!collabAuth.refreshToken) return null;
    try {
      const refreshed = await collabAuthApi.refresh(collabAuth.refreshToken);
      setCollabAuth({
        ...useSettingsStore.getState().collabAuth,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      });
      return refreshed.accessToken;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== undefined && REJECTED_STATUSES.has(status)) {
        // Refused — but if another tab rotated the pair without a lock to
        // stop us, its tokens are fine and signing out would be wrong.
        const adopted = adoptRotatedPair(collabAuth.refreshToken);
        if (adopted) return adopted;
        console.warn('[auth] refresh token rejected, signing out:', err);
        clearCollabAuth();
      } else {
        console.warn('[auth] could not refresh the session, keeping it for the next try:', err);
      }
      return null;
    }
  })
    .catch((err) => {
      console.error('[auth] refresh failed unexpectedly:', err);
      return null;
    })
    .finally(() => {
      // Release the latch so a future 401 (e.g. after user re-logs-in) can
      // trigger a fresh refresh.
      refreshing = null;
    });
  return refreshing;
}

/**
 * Whether a 401 the caller just received leaves a session worth keeping:
 * true when we still hold a refresh token, i.e. the refresh failed for a
 * transient reason rather than being refused (which clears it).
 */
export function sessionSurvivesUnauthorized(): boolean {
  return Boolean(useSettingsStore.getState().collabAuth.refreshToken);
}

function withAuth(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');
  return { ...init, headers };
}

export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const initial = useSettingsStore.getState().collabAuth.accessToken;
  // Route through platformFetch so HTTP backend URLs work from the Tauri
  // WebView (whose origin is https://tauri.localhost — plain fetch() to
  // http:// targets is blocked as mixed content). On web this is a thin
  // pass-through to the native fetch.
  let res = await platformFetch(url, withAuth(init, initial));

  if (res.status !== 401) return res;

  const { accessToken: current, refreshToken } = useSettingsStore.getState().collabAuth;
  // Renewed (here or by another tab) while the request was in flight.
  if (current && current !== initial && !accessTokenExpired(current)) {
    return platformFetch(url, withAuth(init, current));
  }

  // Only attempt refresh if we actually have a refresh token to try.
  if (!refreshToken) return res;

  const fresh = await refreshAccessToken();
  if (!fresh) return res;

  res = await platformFetch(url, withAuth(init, fresh));
  return res;
}
