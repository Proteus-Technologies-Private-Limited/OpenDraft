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

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { FaCloud, FaUserCircle } from 'react-icons/fa';
import { useSettingsStore } from '../stores/settingsStore';
import { performLogout } from '../services/collabAuth';
import CollabLoginDialog from './CollabLoginDialog';

const AuthIndicator: React.FC = () => {
  const collabAuth = useSettingsStore((s) => s.collabAuth);
  const authVerified = useSettingsStore((s) => s.authVerified);
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuRect, setMenuRect] = useState<{ top: number; right: number } | null>(null);

  // Only show "signed in" once the server has confirmed the token. A stored
  // token that hasn't been verified (offline launch, server down) reads as
  // "Local only" — the user hasn't actually been authenticated this session.
  const signedIn = Boolean(collabAuth.accessToken && collabAuth.user && authVerified);

  // Recompute the dropdown's anchor position whenever it opens, and on
  // resize/scroll so it stays attached to the button. The dropdown is
  // portaled to <body> with position: fixed so the menu-bar's
  // overflow:hidden on mobile (added for horizontal scroll) doesn't clip it.
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      setMenuRect({
        top: r.bottom + 4,
        right: Math.max(8, window.innerWidth - r.right),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [menuOpen]);

  // Close on outside click / tap. onMouseLeave doesn't fire on touch devices,
  // which is why this menu was unreachable on Android/iOS — now it closes on
  // any pointer interaction outside the menu or trigger.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (menuRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [menuOpen]);

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
        ref={buttonRef}
        type="button"
        className={`auth-indicator auth-indicator--signed-in ${user.emailVerified ? '' : 'auth-indicator--unverified'}`}
        onClick={() => setMenuOpen((v) => !v)}
        title={user.emailVerified ? `Signed in as ${user.displayName}` : 'Email not verified — saving disabled'}
      >
        <span className="auth-indicator__avatar" aria-hidden="true">{initial}</span>
        <span className="auth-indicator__name">{user.displayName || user.email}</span>
        {!user.emailVerified && <span className="auth-indicator__badge">verify</span>}
      </button>
      {menuOpen && menuRect && createPortal(
        <div
          ref={menuRef}
          className="auth-indicator__menu auth-indicator__menu--portal"
          role="menu"
          style={{ position: 'fixed', top: menuRect.top, right: menuRect.right }}
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
        </div>,
        document.body,
      )}
    </div>
  );
};

export default AuthIndicator;
