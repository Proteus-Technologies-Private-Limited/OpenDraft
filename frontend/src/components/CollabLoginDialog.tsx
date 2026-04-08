import React, { useState, useEffect } from 'react';
import { collabAuthApi, handleAuthResponse } from '../services/collabAuth';
import type { CollabServerConfig } from '../services/collabAuth';
import { useSettingsStore } from '../stores/settingsStore';
import { showToast } from './Toast';

interface CollabLoginDialogProps {
  onClose: () => void;
  onSuccess: () => void;
}

const SAVED_CREDS_KEY = 'opendraft:collabSavedCreds';

function loadSavedCreds(): { email: string; password: string } | null {
  try {
    const raw = localStorage.getItem(SAVED_CREDS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveCreds(email: string, password: string) {
  localStorage.setItem(SAVED_CREDS_KEY, JSON.stringify({ email, password }));
}

function clearSavedCreds() {
  localStorage.removeItem(SAVED_CREDS_KEY);
}

const CollabLoginDialog: React.FC<CollabLoginDialogProps> = ({ onClose, onSuccess }) => {
  const saved = loadSavedCreds();

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [loading, setLoading] = useState(false);
  const [serverConfig, setServerConfig] = useState<CollabServerConfig | null>(null);
  const collabServerUrl = useSettingsStore((s) => s.collabServerUrl);
  const isDemoServer = collabServerUrl.includes('opendraft-collab-267958344432.us-central1.run.app');

  // Login fields — pre-fill from saved credentials
  const [loginEmail, setLoginEmail] = useState(saved?.email ?? '');
  const [loginPassword, setLoginPassword] = useState(saved?.password ?? '');

  // Register fields — pre-fill email/password from saved credentials
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState(saved?.email ?? '');
  const [regPassword, setRegPassword] = useState(saved?.password ?? '');
  const [regConfirm, setRegConfirm] = useState('');

  // Remember credentials
  const [rememberCreds, setRememberCreds] = useState(!!saved);

  useEffect(() => {
    collabAuthApi.getServerConfig().then(setServerConfig).catch(() => {});
  }, []);

  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) return;
    setLoading(true);
    try {
      const response = await collabAuthApi.login(loginEmail, loginPassword);
      handleAuthResponse(response);
      if (rememberCreds) saveCreds(loginEmail, loginPassword);
      else clearSavedCreds();
      showToast('Signed in', 'success');
      onSuccess();
    } catch (err: any) {
      const msg = err.message || 'Login failed';
      if (isDemoServer && (msg.toLowerCase().includes('user not found') || msg.includes('404'))) {
        showToast('User not found', 'error');
        showToast('Note: The demo server resets every hour — please create a new account.', 'info');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regEmail || !regPassword || !regName) return;
    if (regPassword !== regConfirm) {
      showToast('Passwords do not match', 'error');
      return;
    }
    if (regPassword.length < 8) {
      showToast('Password must be at least 8 characters', 'error');
      return;
    }
    setLoading(true);
    try {
      const response = await collabAuthApi.register(regEmail, regPassword, regName);
      handleAuthResponse(response);
      if (rememberCreds) saveCreds(regEmail, regPassword);
      else clearSavedCreds();
      showToast('Account created!', 'success');
      onSuccess();
    } catch (err: any) {
      showToast(err.message || 'Registration failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await loadGoogleScript();
      const idToken = await getGoogleIdToken();
      const response = await collabAuthApi.loginWithGoogle(idToken);
      handleAuthResponse(response);
      showToast('Signed in with Google', 'success');
      onSuccess();
    } catch (err: any) {
      showToast(err.message || 'Google sign-in failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (tab === 'login') handleLogin();
      else handleRegister();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-header">
          Sign in to Collaborate
        </div>

        <div className="dialog-body">
          <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--fd-text-muted)' }}>
            A collaboration account is required to use real-time editing.
            You can manage your account in System Settings.
          </p>

          {isDemoServer && (
            <div className="settings-demo-notice" style={{ marginBottom: 16 }}>
              <strong>Demo Server:</strong> This is a shared demo server. Registered accounts and
              collaboration data are automatically removed every hour. For persistent use,
              deploy your own collab server or upgrade to the paid version.
            </div>
          )}

          <div className="settings-auth-tabs">
            <button
              className={`settings-auth-tab ${tab === 'login' ? 'active' : ''}`}
              onClick={() => setTab('login')}
            >
              Sign In
            </button>
            <button
              className={`settings-auth-tab ${tab === 'register' ? 'active' : ''}`}
              onClick={() => setTab('register')}
            >
              Create Account
            </button>
          </div>

          {tab === 'login' ? (
            <div className="settings-auth-form">
              <div className="settings-field">
                <label>Email</label>
                <input
                  className="dialog-input"
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoFocus
                />
              </div>
              <div className="settings-field">
                <label>Password</label>
                <input
                  className="dialog-input"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="Password"
                />
              </div>
              <button
                className="dialog-btn dialog-btn-primary settings-auth-submit"
                onClick={handleLogin}
                disabled={!loginEmail || !loginPassword || loading}
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </div>
          ) : (
            <div className="settings-auth-form">
              <div className="settings-field">
                <label>Display Name</label>
                <input
                  className="dialog-input"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Your name"
                  autoFocus
                />
              </div>
              <div className="settings-field">
                <label>Email</label>
                <input
                  className="dialog-input"
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="settings-field">
                <label>Password</label>
                <input
                  className="dialog-input"
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>
              <div className="settings-field">
                <label>Confirm Password</label>
                <input
                  className="dialog-input"
                  type="password"
                  value={regConfirm}
                  onChange={(e) => setRegConfirm(e.target.value)}
                  placeholder="Confirm password"
                />
              </div>
              <button
                className="dialog-btn dialog-btn-primary settings-auth-submit"
                onClick={handleRegister}
                disabled={!regEmail || !regPassword || !regName || loading}
              >
                {loading ? 'Creating account...' : 'Create Account'}
              </button>
            </div>
          )}

          <div className="collab-remember-section">
            <label className="collab-remember-label">
              <input
                type="checkbox"
                checked={rememberCreds}
                onChange={(e) => {
                  setRememberCreds(e.target.checked);
                  if (!e.target.checked) clearSavedCreds();
                }}
              />
              Remember credentials
            </label>
            {rememberCreds && (
              <p className="collab-remember-warning">
                Your password will be stored in plain text on this device. This is not
                recommended on shared or public computers.
              </p>
            )}
          </div>

          {serverConfig?.googleEnabled && (
            <div className="settings-google-section">
              <div className="settings-divider"><span>or</span></div>
              <button
                className="dialog-btn settings-google-btn"
                onClick={handleGoogleLogin}
                disabled={loading}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" style={{ marginRight: 8 }}>
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {loading ? 'Signing in...' : 'Sign in with Google'}
              </button>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <div style={{ flex: 1 }} />
          <button className="dialog-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

// ── Google helpers ──

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.accounts) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In'));
    document.head.appendChild(script);
  });
}

function getGoogleIdToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const google = (window as any).google;
    if (!google?.accounts?.id) { reject(new Error('Google not loaded')); return; }
    google.accounts.id.initialize({
      client_id: '',
      callback: (response: any) => {
        if (response.credential) resolve(response.credential);
        else reject(new Error('No credential'));
      },
    });
    google.accounts.id.prompt((n: any) => {
      if (n.isNotDisplayed() || n.isSkippedMoment()) {
        reject(new Error('Google sign-in cancelled'));
      }
    });
  });
}

export default CollabLoginDialog;
