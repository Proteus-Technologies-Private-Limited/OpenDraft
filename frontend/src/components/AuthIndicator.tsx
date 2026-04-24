/**
 * AuthIndicator — compact badge shown in the MenuBar.
 *
 *   Signed in  → avatar + displayName (click → Settings → Account)
 *   Anonymous  → "Local only" chip (click → open login dialog)
 *
 * The point is to answer the user's question at a glance: "am I saving to the
 * server or just to this device?" — matching the user's requirement that the
 * app works offline without login but shows status clearly.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FaCloud, FaUserCircle } from 'react-icons/fa';
import { useSettingsStore } from '../stores/settingsStore';
import { performLogout } from '../services/collabAuth';
import CollabLoginDialog from './CollabLoginDialog';

const AuthIndicator: React.FC = () => {
  const collabAuth = useSettingsStore((s) => s.collabAuth);
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const signedIn = Boolean(collabAuth.accessToken && collabAuth.user);

  if (!signedIn) {
    return (
      <>
        <button
          type="button"
          className="auth-indicator auth-indicator--local"
          onClick={() => setLoginOpen(true)}
          title="Working offline — click to sign in and save to the server"
        >
          <FaCloud style={{ opacity: 0.6 }} />
          <span>Local only</span>
        </button>
        {loginOpen && (
          <CollabLoginDialog
            onClose={() => setLoginOpen(false)}
            onSuccess={() => setLoginOpen(false)}
          />
        )}
      </>
    );
  }

  const user = collabAuth.user!;
  const initial = (user.displayName || user.email || '?').charAt(0).toUpperCase();

  return (
    <div className="auth-indicator-wrap" style={{ position: 'relative' }}>
      <button
        type="button"
        className={`auth-indicator auth-indicator--signed-in ${user.emailVerified ? '' : 'auth-indicator--unverified'}`}
        onClick={() => setMenuOpen((v) => !v)}
        title={user.emailVerified ? `Signed in as ${user.displayName}` : 'Email not verified — saving disabled'}
      >
        <span className="auth-indicator__avatar" aria-hidden="true">{initial}</span>
        <span className="auth-indicator__name">{user.displayName || user.email}</span>
        {!user.emailVerified && <span className="auth-indicator__badge">verify</span>}
      </button>
      {menuOpen && (
        <div
          className="auth-indicator__menu"
          role="menu"
          onMouseLeave={() => setMenuOpen(false)}
        >
          <button
            type="button"
            className="auth-indicator__menu-item"
            onClick={() => { setMenuOpen(false); navigate('/settings'); }}
          >
            <FaUserCircle /> Account settings
          </button>
          <button
            type="button"
            className="auth-indicator__menu-item"
            onClick={async () => {
              setMenuOpen(false);
              await performLogout();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
};

export default AuthIndicator;
