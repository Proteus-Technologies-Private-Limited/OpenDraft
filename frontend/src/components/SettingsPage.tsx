import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../stores/settingsStore';
import { collabAuthApi, handleAuthResponse, performLogout, isDeviceChallenge } from '../services/collabAuth';
import type { CollabServerConfig, DeviceRecord } from '../services/collabAuth';
import { initDemoInfo, isDemoMode } from '../services/demoInfo';
import { showToast } from './Toast';
import { getApiBase } from '../config';
import { getDeviceId } from '../services/deviceId';

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

  // OpenDraft Cloud (HTTP backend) URL — distinct from the collab WebSocket
  // server. On Tauri custom schemes the same-origin default doesn't work, so
  // the user must point at a real backend (e.g. https://opendraft.duckdns.org/api).
  const CLOUD_API_KEY = 'opendraft:cloudApiUrl';
  const [cloudApiInput, setCloudApiInput] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(CLOUD_API_KEY);
      if (stored) return stored;
    } catch { /* ignore */ }
    // No stored value — pre-fill with the live default so users see the actual
    // URL the app will hit, not just a faded placeholder.
    return getApiBase();
  });
  const [cloudApiStatus, setCloudApiStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');

  // Auth forms — remember email only; never store password.
  // Migrate away from the legacy password-storing key on first render.
  useEffect(() => {
    try { localStorage.removeItem('opendraft:collabSavedCreds'); } catch { /* ignore */ }
  }, []);
  const savedEmail = (() => {
    try { return localStorage.getItem('opendraft:rememberedEmail') || ''; } catch { return ''; }
  })();
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [loginEmail, setLoginEmail] = useState(savedEmail);
  const [loginPassword, setLoginPassword] = useState('');
  const [regEmail, setRegEmail] = useState(savedEmail);
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regName, setRegName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(!!savedEmail);

  // Email verification
  const [verifyCode, setVerifyCode] = useState('');
  const [verifying, setVerifying] = useState(false);

  // New-device 2FA challenge (only set when /login returns a challenge)
  const [pendingChallenge, setPendingChallenge] = useState<{ challengeId: string; email: string } | null>(null);
  const [deviceCode, setDeviceCode] = useState('');
  const [verifyingDevice, setVerifyingDevice] = useState(false);

  // Account management state
  const [showAccount, setShowAccount] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const [twoFactorBusy, setTwoFactorBusy] = useState(false);

  const [devices, setDevices] = useState<DeviceRecord[] | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  // Cloud screenplay inventory — populated when the delete dialog opens so we
  // can warn the user about exactly what they'll lose. Empty array = none on
  // file; null = not loaded yet (or load failed and we proceed with the
  // generic warning).
  const [cloudInventory, setCloudInventory] = useState<{ projects: number; scripts: number } | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);

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
  // Demo flag comes from the backend's DEMO_MODE env var (see /api/demo-info).
  const [isDemoServer, setIsDemoServer] = useState<boolean>(isDemoMode());
  useEffect(() => {
    initDemoInfo().then((info) => setIsDemoServer(Boolean(info.demo))).catch(() => {});
  }, []);

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

  const handleSaveCloudApi = () => {
    const trimmed = cloudApiInput.trim().replace(/\/+$/, '');
    if (trimmed && !/^https?:\/\//.test(trimmed)) {
      showToast('URL must start with http:// or https://', 'error');
      return;
    }
    try {
      if (trimmed) localStorage.setItem(CLOUD_API_KEY, trimmed);
      else localStorage.removeItem(CLOUD_API_KEY);
      showToast('OpenDraft Cloud URL saved', 'success');
    } catch {
      showToast('Could not save URL', 'error');
    }
  };

  const handleTestCloudApi = async () => {
    const trimmed = cloudApiInput.trim().replace(/\/+$/, '');
    if (!trimmed) { setCloudApiStatus('fail'); return; }
    setCloudApiStatus('testing');
    try {
      // The Python backend exposes /api/demo-info even without auth, so it's a
      // safe reachability probe. Route through platformFetch so the same
      // mixed-content tunnel the real cloud calls use is exercised here —
      // otherwise the test passes/fails on a different code path than the
      // actual login/projects requests.
      const { platformFetch } = await import('../services/platform');
      const probe = trimmed.endsWith('/api') ? `${trimmed}/demo-info` : `${trimmed}/api/demo-info`;
      const res = await platformFetch(probe);
      setCloudApiStatus(res.ok ? 'ok' : 'fail');
    } catch {
      setCloudApiStatus('fail');
    }
    setTimeout(() => setCloudApiStatus('idle'), 3000);
  };

  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    // Test the URL currently in the input field, not the last saved value
    try {
      const { platformFetch } = await import('../services/platform');
      const httpUrl = urlInput.trim().replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
      const res = await platformFetch(`${httpUrl}/health`);
      setConnectionStatus(res.ok ? 'ok' : 'fail');
      if (!res.ok) {
        showToast(`Server returned HTTP ${res.status}`, 'error');
      }
    } catch (err: any) {
      console.error('[SettingsPage] Test connection failed:', err);
      setConnectionStatus('fail');
      const msg = typeof err === 'string' ? err : (err?.message || String(err));
      showToast(`Connection error: ${msg}`, 'error');
    }
    setTimeout(() => setConnectionStatus('idle'), 5000);
  };

  // ── Auth handlers ──

  const handleLogin = async () => {
    if (!loginEmail || !loginPassword) return;
    setAuthLoading(true);
    try {
      const response = await collabAuthApi.login(loginEmail, loginPassword);
      if (isDeviceChallenge(response)) {
        // 2FA enabled and this device is new — server emailed a code instead
        // of issuing tokens. Hand off to the device-verification UI.
        setPendingChallenge({ challengeId: response.challengeId, email: loginEmail });
        setDeviceCode('');
        showToast(response.message || 'Verification code emailed for this new device.', 'info');
        return;
      }
      handleAuthResponse(response);
      try {
        if (rememberEmail) localStorage.setItem('opendraft:rememberedEmail', loginEmail);
        else localStorage.removeItem('opendraft:rememberedEmail');
      } catch { /* ignore quota/private-mode errors */ }
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

  const handleVerifyDevice = async () => {
    if (!pendingChallenge || deviceCode.length !== 6) return;
    setVerifyingDevice(true);
    try {
      const response = await collabAuthApi.verifyDevice(pendingChallenge.challengeId, deviceCode);
      handleAuthResponse(response);
      try {
        if (rememberEmail) localStorage.setItem('opendraft:rememberedEmail', pendingChallenge.email);
      } catch { /* ignore */ }
      showToast('Device verified — you are signed in.', 'success');
      setPendingChallenge(null);
      setDeviceCode('');
      setLoginEmail('');
      setLoginPassword('');
    } catch (err: any) {
      showToast(err.message || 'Verification failed', 'error');
    } finally {
      setVerifyingDevice(false);
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
      try {
        if (rememberEmail) localStorage.setItem('opendraft:rememberedEmail', regEmail);
        else localStorage.removeItem('opendraft:rememberedEmail');
      } catch { /* ignore */ }
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

  // ── Account: change password ──
  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !newPasswordConfirm) return;
    if (newPassword !== newPasswordConfirm) {
      showToast('New passwords do not match', 'error');
      return;
    }
    if (newPassword.length < 8 || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      showToast('New password must be 8+ chars with upper, lower, and digit', 'error');
      return;
    }
    setChangingPassword(true);
    try {
      await collabAuthApi.changePassword(currentPassword, newPassword);
      // Server revokes every refresh token — sign the user out so they
      // re-authenticate with the new password.
      showToast('Password changed. Please sign in again.', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      await performLogout();
    } catch (err: any) {
      showToast(err.message || 'Could not change password', 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  // ── Account: two-factor toggle ──
  const handleToggleTwoFactor = async (enabled: boolean) => {
    setTwoFactorBusy(true);
    try {
      const r = await collabAuthApi.setTwoFactorEnabled(enabled);
      useSettingsStore.getState().setCollabAuth({
        ...useSettingsStore.getState().collabAuth,
        user: r.user,
      });
      showToast(
        enabled
          ? 'Two-factor verification turned on. New devices will need an emailed code.'
          : 'Two-factor verification turned off. New sign-ins will only get a notification email.',
        'success',
      );
    } catch (err: any) {
      showToast(err.message || 'Could not update 2FA setting', 'error');
    } finally {
      setTwoFactorBusy(false);
    }
  };

  // ── Account: devices list ──
  const refreshDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const list = await collabAuthApi.listDevices();
      setDevices(list);
    } catch (err: any) {
      showToast(err.message || 'Could not load devices', 'error');
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (showAccount && isLoggedIn && devices === null && !devicesLoading) {
      void refreshDevices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAccount, isLoggedIn]);

  const handleRevokeDevice = async (deviceId: string) => {
    if (deviceId === getDeviceId()) {
      showToast('Use Sign Out to remove the current device.', 'error');
      return;
    }
    if (!confirm('Sign this device out and revoke its sessions?')) return;
    try {
      await collabAuthApi.revokeDevice(deviceId);
      showToast('Device revoked', 'success');
      await refreshDevices();
    } catch (err: any) {
      showToast(err.message || 'Could not revoke device', 'error');
    }
  };

  // ── Account: delete account (Apple Guideline 5.1.1(v)) ──
  const cloudPortalLink = (() => {
    const base = getApiBase();
    if (!base) return '';
    return base.replace(/\/api\/?$/, '');
  })();

  // Load the user's cloud screenplay count when the user opens the delete
  // dialog so the warning can name the actual amount they're about to lose.
  // Best-effort: if the cloud is unreachable or returns 401 we leave the
  // generic warning in place — better to under-warn than block the deletion
  // flow on a network hiccup.
  const loadCloudInventory = useCallback(async () => {
    setInventoryLoading(true);
    setCloudInventory(null);
    try {
      const { cloudApi } = await import('../services/cloudApi');
      const projects = await cloudApi.listProjects();
      let scripts = 0;
      // The list endpoint already returns project metadata; counting scripts
      // is a per-project API hop. Limit it to the first 25 projects so we
      // don't make a long sequence of requests in the worst case — anything
      // past that is good enough as an "X+ screenplays" warning.
      const sample = projects.slice(0, 25);
      for (const p of sample) {
        try {
          const list = await cloudApi.listScripts(p.id, false);
          scripts += list.length;
        } catch { /* ignore per-project failure */ }
      }
      setCloudInventory({ projects: projects.length, scripts });
    } catch {
      setCloudInventory(null);
    } finally {
      setInventoryLoading(false);
    }
  }, []);

  const handleOpenDelete = () => {
    setDeleteOpen(true);
    void loadCloudInventory();
  };

  const handleDeleteAccount = async () => {
    if (!collabAuth.user) return;
    if (deleteConfirmation !== 'DELETE') {
      showToast('Type DELETE to confirm.', 'error');
      return;
    }
    setDeleting(true);
    try {
      // Always send both fields when present — the server picks the right one
      // based on whether the account has a password set. We can't tell from
      // the client because /auth/me doesn't expose that detail.
      const opts: { password?: string; confirmation?: string } = {
        confirmation: deleteConfirmation,
      };
      if (deletePassword) opts.password = deletePassword;
      await collabAuthApi.deleteAccount(opts);
      showToast('Account deleted. We are sorry to see you go.', 'success');
      setDeleteOpen(false);
      setDeletePassword('');
      setDeleteConfirmation('');
      // Clear local auth state — the access token now references a deleted user.
      useSettingsStore.getState().clearCollabAuth();
    } catch (err: any) {
      showToast(err.message || 'Could not delete account', 'error');
    } finally {
      setDeleting(false);
    }
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
                placeholder="wss://collab.open-draft.com"
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

        {/* ── OpenDraft Cloud API URL ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">OpenDraft Cloud Server</h2>
          <p className="settings-section-desc">
            HTTP backend used for sign-in, projects, and cloud saves. Leave blank
            in the browser to use this site's <code>/api</code>. Required on the
            desktop and mobile apps — defaults to <code>https://open-draft.com</code>;
            override to point at a self-hosted backend like
            <code> https://your-host.example.com</code> (the <code>/api</code> suffix
            is added automatically if missing).
          </p>

          <div className="settings-row">
            <label>Cloud API URL</label>
            <div className="settings-url-row">
              <input
                className="dialog-input settings-url-input"
                value={cloudApiInput}
                onChange={(e) => setCloudApiInput(e.target.value)}
                placeholder="https://open-draft.com"
                onKeyDown={(e) => handleKeyDown(e, handleSaveCloudApi)}
              />
              <button className="dialog-btn dialog-btn-primary" onClick={handleSaveCloudApi}>
                Save
              </button>
              <button
                className="dialog-btn"
                onClick={handleTestCloudApi}
                disabled={cloudApiStatus === 'testing'}
              >
                {cloudApiStatus === 'testing' ? 'Testing...' :
                  cloudApiStatus === 'ok' ? 'Reachable' :
                    cloudApiStatus === 'fail' ? 'Failed' : 'Test'}
              </button>
            </div>
            {cloudApiStatus === 'ok' && (
              <div className="settings-status settings-status-ok">Server is reachable</div>
            )}
            {cloudApiStatus === 'fail' && (
              <div className="settings-status settings-status-fail">Cannot reach server</div>
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
                pendingChallenge ? (
                  <div className="settings-auth-form">
                    <div className="settings-verify-text">
                      A 6-digit verification code was emailed to{' '}
                      <strong>{pendingChallenge.email}</strong> to confirm this is a
                      device you trust. Enter it below to finish signing in.
                    </div>
                    <div className="settings-field">
                      <label>Verification Code</label>
                      <input
                        className="dialog-input settings-verify-input"
                        value={deviceCode}
                        onChange={(e) => setDeviceCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        maxLength={6}
                        autoFocus
                        onKeyDown={(e) => handleKeyDown(e, handleVerifyDevice)}
                      />
                    </div>
                    <div className="settings-verify-row">
                      <button
                        className="dialog-btn dialog-btn-primary"
                        onClick={handleVerifyDevice}
                        disabled={deviceCode.length !== 6 || verifyingDevice}
                      >
                        {verifyingDevice ? 'Verifying...' : 'Verify Device'}
                      </button>
                      <button
                        className="dialog-btn"
                        onClick={() => { setPendingChallenge(null); setDeviceCode(''); }}
                        disabled={verifyingDevice}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
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
                )
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
                    checked={rememberEmail}
                    onChange={(e) => {
                      setRememberEmail(e.target.checked);
                      try {
                        if (!e.target.checked) localStorage.removeItem('opendraft:rememberedEmail');
                      } catch { /* ignore */ }
                    }}
                  />
                  Remember my email address
                </label>
                <p className="collab-remember-hint">
                  You stay signed in for up to 7 days using a secure refresh token —
                  no password is stored on this device.
                </p>
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

        {/* ── Account & Security (signed-in users only) ── */}
        {isLoggedIn && (
          <section className="settings-section">
            <h2 className="settings-section-title">Account &amp; Security</h2>
            <p className="settings-section-desc">
              Manage your password, devices, two-factor verification, and account deletion.
            </p>

            {!showAccount ? (
              <button className="dialog-btn" onClick={() => setShowAccount(true)}>
                Open Account Settings
              </button>
            ) : (
              <div className="settings-auth-card">
                {/* Two-factor toggle */}
                <div className="settings-account-block">
                  <div className="settings-account-row">
                    <div>
                      <div className="settings-account-title">Two-factor verification</div>
                      <div className="settings-account-hint">
                        When on, signing in from a new device requires a 6-digit code emailed to
                        you. When off, you'll only get a heads-up email so you can spot
                        unauthorized sign-ins.
                      </div>
                    </div>
                    <label className="settings-switch">
                      <input
                        type="checkbox"
                        checked={Boolean(collabAuth.user?.twoFactorEnabled)}
                        disabled={twoFactorBusy}
                        onChange={(e) => handleToggleTwoFactor(e.target.checked)}
                      />
                      <span>{collabAuth.user?.twoFactorEnabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                </div>

                {/* Change password */}
                <div className="settings-account-block">
                  <div className="settings-account-title">Change password</div>
                  <div className="settings-account-hint">
                    Updating your password will sign you out everywhere. You'll need to sign in
                    again with the new password on each device.
                  </div>
                  <div className="settings-field">
                    <label>Current Password</label>
                    <input
                      className="dialog-input"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Current password"
                      autoComplete="current-password"
                    />
                  </div>
                  <div className="settings-field">
                    <label>New Password</label>
                    <input
                      className="dialog-input"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="settings-field">
                    <label>Confirm New Password</label>
                    <input
                      className="dialog-input"
                      type="password"
                      value={newPasswordConfirm}
                      onChange={(e) => setNewPasswordConfirm(e.target.value)}
                      placeholder="Repeat new password"
                      autoComplete="new-password"
                    />
                  </div>
                  <button
                    className="dialog-btn dialog-btn-primary"
                    onClick={handleChangePassword}
                    disabled={!currentPassword || !newPassword || !newPasswordConfirm || changingPassword}
                  >
                    {changingPassword ? 'Updating...' : 'Update Password'}
                  </button>
                </div>

                {/* Devices */}
                <div className="settings-account-block">
                  <div className="settings-account-row">
                    <div>
                      <div className="settings-account-title">Active devices</div>
                      <div className="settings-account-hint">
                        These are the devices currently signed in to your account. Revoke any
                        you don't recognise — that device will be signed out immediately.
                      </div>
                    </div>
                    <button className="dialog-btn" onClick={refreshDevices} disabled={devicesLoading}>
                      {devicesLoading ? 'Loading...' : 'Refresh'}
                    </button>
                  </div>
                  {devicesLoading && devices === null ? (
                    <div className="settings-account-hint">Loading devices…</div>
                  ) : (devices || []).length === 0 ? (
                    <div className="settings-account-hint">No registered devices yet.</div>
                  ) : (
                    <ul className="settings-device-list">
                      {(devices || []).map((d) => (
                        <li key={d.deviceId} className="settings-device-row">
                          <div className="settings-device-info">
                            <div className="settings-device-name">
                              {d.deviceName}
                              {d.current && <span className="settings-device-current"> (this device)</span>}
                            </div>
                            <div className="settings-device-meta">
                              {d.platform || 'Unknown platform'}
                              {d.ipAddress ? ` · ${d.ipAddress}` : ''}
                            </div>
                            <div className="settings-device-meta">
                              Last seen {new Date(d.lastSeenAt).toLocaleString()}
                            </div>
                          </div>
                          {!d.current && (
                            <button
                              className="dialog-btn dialog-btn-danger"
                              onClick={() => handleRevokeDevice(d.deviceId)}
                            >
                              Revoke
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Delete account (Apple Guideline 5.1.1(v)) */}
                <div className="settings-account-block settings-account-danger">
                  <div className="settings-account-title">Delete account</div>
                  <div className="settings-account-hint">
                    Permanently deletes your account, password, devices, and any cloud
                    screenplays stored under your account. This cannot be undone.
                  </div>
                  {!deleteOpen ? (
                    <button
                      className="dialog-btn dialog-btn-danger"
                      onClick={handleOpenDelete}
                    >
                      Delete Account…
                    </button>
                  ) : (
                    <div className="settings-delete-confirm">
                      <div className="settings-delete-warning">
                        <strong>Before you continue:</strong>{' '}
                        {inventoryLoading ? (
                          <>checking your OpenDraft Cloud account for screenplays…</>
                        ) : cloudInventory && (cloudInventory.projects > 0 || cloudInventory.scripts > 0) ? (
                          <>
                            you have <strong>{cloudInventory.projects}</strong>{' '}
                            project{cloudInventory.projects === 1 ? '' : 's'}
                            {cloudInventory.scripts > 0 && (
                              <>
                                {' '}with at least <strong>{cloudInventory.scripts}</strong>{' '}
                                screenplay{cloudInventory.scripts === 1 ? '' : 's'}
                              </>
                            )}{' '}
                            stored in OpenDraft Cloud. They will be permanently deleted along
                            with this account and cannot be recovered. Please open each one in
                            OpenDraft and use <em>File → Save As / Export</em> to download a
                            local copy before continuing.
                          </>
                        ) : (
                          <>
                            any screenplays stored in OpenDraft Cloud under this account will be
                            deleted along with the account and cannot be recovered. Please make
                            sure you have downloaded them first.
                          </>
                        )}
                        {cloudPortalLink && (
                          <>
                            {' '}You can review and download them from{' '}
                            <a href={cloudPortalLink} target="_blank" rel="noreferrer">
                              {cloudPortalLink}
                            </a>.
                          </>
                        )}
                      </div>

                      <div className="settings-field">
                        <label>Current password (leave blank for Google-only accounts)</label>
                        <input
                          className="dialog-input"
                          type="password"
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                          placeholder="Your password"
                          autoComplete="current-password"
                        />
                      </div>

                      <div className="settings-field">
                        <label>Type <strong>DELETE</strong> to confirm</label>
                        <input
                          className="dialog-input"
                          value={deleteConfirmation}
                          onChange={(e) => setDeleteConfirmation(e.target.value)}
                          placeholder="DELETE"
                        />
                      </div>

                      <div className="settings-verify-row">
                        <button
                          className="dialog-btn dialog-btn-danger"
                          onClick={handleDeleteAccount}
                          disabled={deleting || deleteConfirmation !== 'DELETE'}
                        >
                          {deleting ? 'Deleting...' : 'Permanently delete my account'}
                        </button>
                        <button
                          className="dialog-btn"
                          onClick={() => {
                            setDeleteOpen(false);
                            setDeletePassword('');
                            setDeleteConfirmation('');
                          }}
                          disabled={deleting}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

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
