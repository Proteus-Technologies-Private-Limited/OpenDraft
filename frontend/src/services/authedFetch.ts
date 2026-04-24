/**
 * authedFetch — fetch wrapper that attaches the Bearer access token and
 * transparently refreshes it on 401.
 *
 * Flow:
 *   1. Fire the request with the current access token (if any).
 *   2. If it returns 401 AND we hold a refresh token, hit /auth/refresh
 *      exactly once and retry the original request with the new access token.
 *   3. If refresh itself fails (invalid/expired/revoked refresh token), clear
 *      local auth state so AuthGate can prompt a fresh sign-in. The caller
 *      still receives the final Response (the second 401) and can react.
 *
 * Concurrency: N parallel 401s collapse onto a single in-flight refresh via
 * the module-level promise. Each caller retries at most once per invocation,
 * so a persistently bad server cannot cause an infinite loop.
 */

import { useSettingsStore } from '../stores/settingsStore';
import { collabAuthApi } from './collabAuth';

let refreshing: Promise<string | null> | null = null;

async function refreshOnce(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { collabAuth, setCollabAuth, clearCollabAuth } = useSettingsStore.getState();
    if (!collabAuth.refreshToken) return null;
    try {
      const refreshed = await collabAuthApi.refresh(collabAuth.refreshToken);
      setCollabAuth({
        ...collabAuth,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
      });
      return refreshed.accessToken;
    } catch {
      // Refresh token invalid/expired — force a fresh login.
      clearCollabAuth();
      return null;
    } finally {
      // Release the latch so a future 401 (e.g. after user re-logs-in) can
      // trigger a fresh refresh.
      refreshing = null;
    }
  })();
  return refreshing;
}

function withAuth(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');
  return { ...init, headers };
}

export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const initial = useSettingsStore.getState().collabAuth.accessToken;
  let res = await fetch(url, withAuth(init, initial));

  if (res.status !== 401) return res;

  // Only attempt refresh if we actually have a refresh token to try.
  if (!useSettingsStore.getState().collabAuth.refreshToken) return res;

  const fresh = await refreshOnce();
  if (!fresh) return res;

  return fetch(url, withAuth(init, fresh));
}
