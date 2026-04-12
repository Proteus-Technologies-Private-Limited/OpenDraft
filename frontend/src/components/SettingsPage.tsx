import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../stores/settingsStore';
import { collabAuthApi, handleAuthResponse, performLogout } from '../services/collabAuth';
import type { CollabServerConfig } from '../services/collabAuth';
import { showToast } from './Toast';

const EXPIRY_OPTIONS = [
  { label: '30 minutes', hours: 0.5 },
  { label: '1 hour', hours: 1 },
  { label: '6 hours', hours: 6 },
  { label: '12 hours', hours: 12 },
  { label: '24 hours', hours: 24 },
  { label: '48 hours', hours: 48 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const {
    collabServerUrl, setCollabServerUrl,
    collabAuth, defaultInviteExpiry, setDefaultInviteExpiry,
  } = useSettingsStore();

  // ── Local form state ──
  const [urlInput, setUrlInput] = useState(collabServerUrl);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // Auth forms — pre-fill from saved credentials
  const savedCreds = (() => {
    try {
      const raw = localStorage.getItem('opendraft:collabSavedCreds');
      return raw ? JSON.parse(raw) as { email: string; password: string } : null;
    } catch { return null; }
  })();
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState(savedCreds?.email ?? '');
  const [loginPassword, setLoginPassword] = useState(savedCreds?.password ?? '');
  const [regEmail, setRegEmail] = useState(savedCreds?.email ?? '');
  const [regPassword, setRegPassword] = useState(savedCreds?.password ?? '');
  const [regConfirm, setRegConfirm] = useState('');
  const [regName, setRegName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [rememberCreds, setRememberCreds] = useState(!!savedCreds);

  // Email verification
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Google OAuth
  const [serverConfig, setServerConfig] = useState<CollabServerConfig | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Load server config when URL is saved
  useEffect(() => {
    if (collabServerUrl) {
      collabAuthApi.getServerConfig().then(setServerConfig).catch(() => setServerConfig(null));
    }
  }, [collabServerUrl]);

  const isLoggedIn = Boolean(collabAuth.accessToken && collabAuth.user);
  const isDemoServer = collabServerUrl.includes('opendraft-collab-267958344432.us-central1.run.app');

  // ── URL handlers ──

  const handleSaveUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed.startsWith('ws://') && !trimmed.startsWith('wss://')) {
      showToast('URL must start with ws:// or wss://', 'error');
      return;
    }
    setCollabServerUrl(trimmed);
    showToast('Collaboration server URL saved', 'success');
  };

  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    // Test the URL currently in the input field, not the last saved value
    try {
      const { platformFetch } = await import('../services/platform');
      const httpUrl = urlInput.trim().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
      const res = await platformFetch(`${httpUrl}/health`);
      setConnectionStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setConnectionStatus('fail');
    }
    setTimeout(() => setConnectionStatus('idle'), 3000);
  };

  // ── Auth handlers ──

  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) return;
    setAuthLoading(true);
    try {
      const response = await collabAuthApi.login(loginEmail, loginPassword);
      handleAuthResponse(response);
      if (rememberCreds) localStorage.setItem('opendraft:collabSavedCreds', JSON.stringify({ email: loginEmail, password: loginPassword }));
      else localStorage.removeItem('opendraft:collabSavedCreds');
      showToast('Logged in successfully', 'success');
      setLoginEmail('');
      setLoginPassword('');
    } catch (err: any) {
      const msg = err.message || 'Login failed';
      if (isDemoServer && (msg.toLowerCase().includes('user not found') || msg.includes('404'))) {
        showToast('User not found', 'error');
        showToast('Note: The demo server resets every hour — please create a new account.', 'info');
      } else {
        showToast(msg, 'error');
      }
    } finally {
      setAuthLoading(false);
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
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(regPassword)) {
      showToast('Password must contain uppercase, lowercase, and a digit', 'error');
      return;
    }
    setAuthLoading(true);
    try {
      const response = await collabAuthApi.register(regEmail, regPassword, regName);
      handleAuthResponse(response);
      if (rememberCreds) localStorage.setItem('opendraft:collabSavedCreds', JSON.stringify({ email: regEmail, password: regPassword }));
      else localStorage.removeItem('opendraft:collabSavedCreds');
      showToast(
        response.user.emailVerified
          ? 'Account created successfully!'
          : 'Account created! Check your email for a verification code.',
        'success',
      );
      setRegEmail('');
      setRegPassword('');
      setRegConfirm('');
      setRegName('');
    } catch (err: any) {
      showToast(err.message || 'Registration failed', 'error');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!serverConfig?.googleEnabled) return;
    setGoogleLoading(true);
    try {
      // Load Google Identity Services script dynamically
      await loadGoogleScript();
      const idToken = await getGoogleIdToken();
      const response = await collabAuthApi.loginWithGoogle(idToken);
      handleAuthResponse(response);
      showToast('Signed in with Google', 'success');
    } catch (err: any) {
      showToast(err.message || 'Google sign-in failed', 'error');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (verifyCode.length !== 6) return;
    setVerifying(true);
    try {
      await collabAuthApi.verifyEmail(verifyCode);
      // Update local user state
      const user = await collabAuthApi.getMe();
      useSettingsStore.getState().setCollabAuth({
        ...collabAuth,
        user: user,
      });
      showToast('Email verified!', 'success');
      setVerifyCode('');
    } catch (err: any) {
      showToast(err.message || 'Verification failed', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleResendVerification = async () => {
    try {
      await collabAuthApi.resendVerification();
      showToast('Verification email sent', 'success');
    } catch (err: any) {
      showToast(err.message || 'Failed to resend', 'error');
    }
  };

  const handleLogout = async () => {
    await performLogout();
    showToast('Logged out', 'success');
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') action();
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={() => navigate(-1)} title="Go back">
          &larr;
        </button>
        <h1>System Settings</h1>
      </div>

      <div className="settings-content">
        {/* ── Collaboration Server URL ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">Collaboration Server</h2>
          <p className="settings-section-desc">
            Configure the collaboration server URL. Use <code>wss://</code> for encrypted connections
            or <code>ws://</code> for local networks.
          </p>

          <div className="settings-row">
            <label>Server URL</label>
            <div className="settings-url-row">
              <input
                className="dialog-input settings-url-input"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="wss://opendraft-collab-267958344432.us-central1.run.app"
                onKeyDown={(e) => handleKeyDown(e, handleSaveUrl)}
              />
              <button className="dialog-btn dialog-btn-primary" onClick={handleSaveUrl}>
                Save
              </button>
              <button
                className="dialog-btn"
                onClick={handleTestConnection}
                disabled={connectionStatus === 'testing'}
              >
                {connectionStatus === 'testing' ? 'Testing...' :
                  connectionStatus === 'ok' ? 'Connected' :
                    connectionStatus === 'fail' ? 'Failed' : 'Test'}
              </button>
            </div>
            {connectionStatus === 'ok' && (
              <div className="settings-status settings-status-ok">Server is reachable</div>
            )}
            {connectionStatus === 'fail' && (
              <div className="settings-status settings-status-fail">Cannot reach server</div>
            )}
            {urlInput.startsWith('wss://') && (
              <div className="settings-hint">TLS/SSL encryption is active (wss://)</div>
            )}
            {urlInput.startsWith('ws://') && (
              <div className="settings-hint">No encryption (ws://). Suitable for local networks only.</div>
            )}
          </div>
        </section>

        {/* ── Collab Account ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">Collaboration Account</h2>
          <p className="settings-section-desc">
            Sign in to the collaboration server to use real-time editing features.
            An account is only required for collaboration — all other features work offline.
          </p>

          {isDemoServer && (
            <div className="settings-demo-notice">
              <strong>Demo Server:</strong> This is a shared demo server. Registered accounts and
              collaboration data are automatically removed every hour. For persistent use,
              deploy your own collab server or upgrade to the paid version.
            </div>
          )}

          {isLoggedIn ? (
            <div className="settings-auth-card">
              <div className="settings-user-info">
                <div className="settings-user-avatar">
                  {collabAuth.user!.displayName.charAt(0).toUpperCase()}
                </div>
                <div className="settings-user-details">
                  <div className="settings-user-name">{collabAuth.user!.displayName}</div>
                  <div className="settings-user-email">{collabAuth.user!.email}</div>
                  {!collabAuth.user!.emailVerified && (
                    <div className="settings-email-unverified">Email not verified</div>
                  )}
                </div>
                <button className="dialog-btn settings-logout-btn" onClick={handleLogout}>
                  Sign Out
                </button>
              </div>

              {/* Email verification form */}
              {!collabAuth.user!.emailVerified && (
                <div className="settings-verify-section">
                  <p className="settings-verify-text">
                    Enter the 6-digit code sent to your email to verify your account.
                  </p>
                  <div className="settings-verify-row">
                    <input
                      className="dialog-input settings-verify-input"
                      value={verifyCode}
                      onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="000000"
                      maxLength={6}
                      onKeyDown={(e) => handleKeyDown(e, handleVerifyEmail)}
                    />
                    <button
                      className="dialog-btn dialog-btn-primary"
                      onClick={handleVerifyEmail}
                      disabled={verifyCode.length !== 6 || verifying}
                    >
                      {verifying ? 'Verifying...' : 'Verify'}
                    </button>
                    <button className="dialog-btn" onClick={handleResendVerification}>
                      Resend
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="settings-auth-card">
              <div className="settings-auth-tabs">
                <button
                  className={`settings-auth-tab ${authTab === 'login' ? 'active' : ''}`}
                  onClick={() => setAuthTab('login')}
                >
                  Sign In
                </button>
                <button
                  className={`settings-auth-tab ${authTab === 'register' ? 'active' : ''}`}
                  onClick={() => setAuthTab('register')}
                >
                  Create Account
                </button>
              </div>

              {authTab === 'login' ? (
                <div className="settings-auth-form">
                  <div className="settings-field">
                    <label>Email</label>
                    <input
                      className="dialog-input"
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="you@example.com"
                      onKeyDown={(e) => handleKeyDown(e, handleLogin)}
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
                      onKeyDown={(e) => handleKeyDown(e, handleLogin)}
                    />
                  </div>
                  <button
                    className="dialog-btn dialog-btn-primary settings-auth-submit"
                    onClick={handleLogin}
                    disabled={!loginEmail || !loginPassword || authLoading}
                  >
                    {authLoading ? 'Signing in...' : 'Sign In'}
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
                      onKeyDown={(e) => handleKeyDown(e, handleRegister)}
                    />
                  </div>
                  <button
                    className="dialog-btn dialog-btn-primary settings-auth-submit"
                    onClick={handleRegister}
                    disabled={!regEmail || !regPassword || !regName || authLoading}
                  >
                    {authLoading ? 'Creating account...' : 'Create Account'}
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
                      if (!e.target.checked) localStorage.removeItem('opendraft:collabSavedCreds');
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

              {/* Google sign-in */}
              {serverConfig?.googleEnabled && (
                <div className="settings-google-section">
                  <div className="settings-divider">
                    <span>or</span>
                  </div>
                  <button
                    className="dialog-btn settings-google-btn"
                    onClick={handleGoogleLogin}
                    disabled={googleLoading}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" style={{ marginRight: 8 }}>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {googleLoading ? 'Signing in...' : 'Sign in with Google'}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Invite Defaults ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">Invite Defaults</h2>
          <p className="settings-section-desc">
            Default settings for new collaboration invites.
          </p>

          <div className="settings-row">
            <label>Default Token Expiry</label>
            <select
              className="dialog-input settings-select"
              value={defaultInviteExpiry}
              onChange={(e) => setDefaultInviteExpiry(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.hours} value={opt.hours}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </section>
      </div>
    </div>
  );
};

// ── Google Identity Services helpers ──

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.accounts) {
      resolve();
      return;
    }
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
    if (!google?.accounts?.id) {
      reject(new Error('Google Identity Services not loaded'));
      return;
    }

    google.accounts.id.initialize({
      client_id: '', // Will be filled from server config
      callback: (response: any) => {
        if (response.credential) {
          resolve(response.credential);
        } else {
          reject(new Error('No credential returned'));
        }
      },
    });

    google.accounts.id.prompt((notification: any) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        reject(new Error('Google sign-in was cancelled or not available'));
      }
    });
  });
}

export default SettingsPage;
