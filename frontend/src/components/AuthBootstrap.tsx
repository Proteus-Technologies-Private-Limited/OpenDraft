/**
 * AuthBootstrap — verifies the persisted auth token against the server once
 * per app session.
 *
 * Why: a token in localStorage alone is not proof that the user is logged in.
 * If the auth/backend server is unreachable, or if the token has been revoked
 * server-side, we must not flash a "signed in" UI. Until /auth/me succeeds we
 * keep `authVerified=false` so AuthIndicator and signed-in gates show the
 * "Local only" state.
 *
 * Outcomes:
 *   - 2xx /auth/me  → setAuthVerified(true) and refresh the cached user.
 *   - 401            → handleNonOkResponse already cleared auth via authedFetch.
 *   - network error  → leave verified=false; retry when the browser reports
 *                      'online' so reconnects flip to the signed-in UI.
 */

import React, { useEffect } from 'react';
import { collabAuthApi } from '../services/collabAuth';
import { useSettingsStore } from '../stores/settingsStore';

const AuthBootstrap: React.FC = () => {
  useEffect(() => {
    let cancelled = false;

    async function verify() {
      const { collabAuth, setCollabAuth, setAuthVerified } = useSettingsStore.getState();
      if (!collabAuth.accessToken) {
        setAuthVerified(false);
        return;
      }
      try {
        const user = await collabAuthApi.getMe();
        if (cancelled) return;
        // Refresh the cached user (display name, email_verified, etc.) so the
        // UI reflects any server-side changes since the last login.
        setCollabAuth({ ...useSettingsStore.getState().collabAuth, user });
        // setCollabAuth already flips authVerified=true when token+user exist,
        // but call it explicitly in case the token was nulled mid-flight.
        setAuthVerified(true);
      } catch {
        // 401 paths clear auth via authedFetch / handleNonOkResponse. Network
        // errors leave the token in place but unverified — reconnects retry.
        if (cancelled) return;
        setAuthVerified(false);
      }
    }

    void verify();

    // Re-verify when the network returns. Without this, a user who launches
    // the app offline stays "Local only" forever even after Wi-Fi comes back.
    const onOnline = () => { void verify(); };
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return null;
};

export default AuthBootstrap;
