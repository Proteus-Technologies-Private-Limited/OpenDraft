import React, { useState, useEffect, useCallback } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useGoBack } from '../hooks/useGoBack';
import { useSettingsStore } from '../stores/settingsStore';
import { collabAuthApi, handleAuthResponse, performLogout, isDeviceChallenge, useSigningOut } from '../services/collabAuth';
import type { CollabServerConfig, DeviceRecord } from '../services/collabAuth';
import { initDemoInfo, isDemoMode } from '../services/demoInfo';
import { showToast } from './Toast';
import { getApiBase } from '../config';
import { getDeviceId } from '../services/deviceId';
import BackupSettingsSection from './BackupSettingsSection';
import AddOnsSettingsSection from './AddOnsSettingsSection';
import SaveSettingsSection from './SaveSettingsSection';
import VoiceProviderSettings from './VoiceProviderSettings';
import { isMacPlatform } from '../utils/shortcuts';
import ShortcutField from './ShortcutField';
import MacroSettingsSection from './MacroSettingsSection';
import { printRoute, isTauri as isTauriApp } from '../services/platform';
import Select from './Select';
import { t as translate } from '../i18n';
import { useLanguage } from '../i18n/useLanguage';
import { formatDateTime } from '../i18n/format';
import { buildLanguageOptions } from './languageOptions';

// The value stored is `hours`; the words shown for it are built from unit and count when rendering.
const EXPIRY_OPTIONS: { hours: number; unit: 'minutes' | 'hours' | 'days'; count: number }[] = [
  { hours: 0.5, unit: 'minutes', count: 30 },
  { hours: 1, unit: 'hours', count: 1 },
  { hours: 6, unit: 'hours', count: 6 },
  { hours: 12, unit: 'hours', count: 12 },
  { hours: 24, unit: 'hours', count: 24 },
  { hours: 48, unit: 'hours', count: 48 },
  { hours: 168, unit: 'days', count: 7 },
  { hours: 720, unit: 'days', count: 30 },
];

// Same shape as Date.toLocaleString() in English, written in the interface language.
const FULL_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
};

// The word the writer types to confirm deleting the account. The server checks for this exact value, so it is data and is never translated.
const DELETE_WORD = 'DELETE';

const SettingsPage: React.FC = () => {
  const { t } = useTranslation(['settings', 'common']);
  const { preference: languagePreference, setLanguage } = useLanguage();
  const languageOptions = buildLanguageOptions((language) => t('language.system', { language }));
  const expiryLabel = (o: (typeof EXPIRY_OPTIONS)[number]): string =>
    o.unit === 'minutes' ? t('invite.expiryMinutes', { count: o.count })
      : o.unit === 'hours' ? t('invite.expiryHours', { count: o.count })
        : t('invite.expiryDays', { count: o.count });
  const goBack = useGoBack();
  const {
    collabServerUrl, setCollabServerUrl,
    collabAuth, defaultInviteExpiry, setDefaultInviteExpiry,
    elementMenuOnEnter, setElementMenuOnEnter,
    printViaPdf, setPrintViaPdf,
    elementMenuShortcut, setElementMenuShortcut,
  } = useSettingsStore();

  // ── Local form state ──
  const signingOut = useSigningOut((s) => s.signingOut);
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
    // server the app will hit, not just a faded placeholder. Show it as the
    // bare server root: `/api` is appended automatically (normalizeApiBase), so
    // both forms resolve to the same base, and the placeholder, the help text
    // above and this value should not disagree about which one to show.
    return getApiBase().replace(/\/api$/, '');
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
      showToast(t('collabServer.urlInvalid'), 'error');
      return;
    }
    setCollabServerUrl(trimmed);
    showToast(t('collabServer.urlSaved'), 'success');
  };

  const handleSaveCloudApi = () => {
    const trimmed = cloudApiInput.trim().replace(/\/+$/, '');
    if (trimmed && !/^https?:\/\//.test(trimmed)) {
      showToast(t('cloud.urlInvalid'), 'error');
      return;
    }
    try {
      if (trimmed) localStorage.setItem(CLOUD_API_KEY, trimmed);
      else localStorage.removeItem(CLOUD_API_KEY);
      showToast(t('cloud.urlSaved'), 'success');
    } catch {
      showToast(t('cloud.saveFailed'), 'error');
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
        showToast(t('collabServer.httpStatus', { status: res.status }), 'error');
      }
    } catch (err: any) {
      console.error('[SettingsPage] Test connection failed:', err);
      setConnectionStatus('fail');
      const msg = typeof err === 'string' ? err : (err?.message || String(err));
      showToast(t('collabServer.connectionError', { error: msg }), 'error');
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
        showToast(response.message || t('auth.deviceCodeEmailed'), 'info');
        return;
      }
      handleAuthResponse(response);
      try {
        if (rememberEmail) localStorage.setItem('opendraft:rememberedEmail', loginEmail);
        else localStorage.removeItem('opendraft:rememberedEmail');
      } catch { /* ignore quota/private-mode errors */ }
      showToast(t('auth.loggedIn'), 'success');
      setLoginEmail('');
      setLoginPassword('');
    } catch (err: any) {
      const msg = err.message || t('auth.loginFailed');
      if (isDemoServer && (msg.toLowerCase().includes('user not found') || msg.includes('404'))) {
        showToast(t('auth.userNotFound'), 'error');
        showToast(t('auth.demoReset'), 'info');
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
      showToast(t('auth.deviceVerified'), 'success');
      setPendingChallenge(null);
      setDeviceCode('');
      setLoginEmail('');
      setLoginPassword('');
    } catch (err: any) {
      showToast(err.message || t('auth.verificationFailed'), 'error');
    } finally {
      setVerifyingDevice(false);
    }
  };

  const handleResendDeviceCode = async () => {
    if (!pendingChallenge) return;
    setVerifyingDevice(true);
    try {
      const r = await collabAuthApi.resendDeviceChallenge(pendingChallenge.challengeId);
      // Server invalidates the old code and returns a fresh challengeId.
      setPendingChallenge({ challengeId: r.challengeId, email: pendingChallenge.email });
      setDeviceCode('');
      showToast(r.message || t('auth.newCodeSent'), 'success');
    } catch (err: any) {
      showToast(err.message || t('auth.resendCodeFailed'), 'error');
    } finally {
      setVerifyingDevice(false);
    }
  };

  const handleRegister = async () => {
    if (!regEmail || !regPassword || !regName) return;
    if (regPassword !== regConfirm) {
      showToast(t('auth.passwordsMismatch'), 'error');
      return;
    }
    if (regPassword.length < 8) {
      showToast(t('auth.passwordTooShort'), 'error');
      return;
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(regPassword)) {
      showToast(t('auth.passwordWeak'), 'error');
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
          ? t('auth.accountCreated')
          : t('auth.accountCreatedVerify'),
        'success',
      );
      setRegEmail('');
      setRegPassword('');
      setRegConfirm('');
      setRegName('');
    } catch (err: any) {
      showToast(err.message || t('auth.registrationFailed'), 'error');
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
      showToast(t('auth.googleSignedIn'), 'success');
    } catch (err: any) {
      showToast(err.message || t('auth.googleFailed'), 'error');
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
      showToast(t('auth.emailVerified'), 'success');
      setVerifyCode('');
    } catch (err: any) {
      showToast(err.message || t('auth.verificationFailed'), 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleResendVerification = async () => {
    try {
      await collabAuthApi.resendVerification();
      showToast(t('auth.verificationSent'), 'success');
    } catch (err: any) {
      showToast(err.message || t('auth.resendFailed'), 'error');
    }
  };

  const handleLogout = async () => {
    await performLogout();
    showToast(t('auth.signedOut'), 'success');
  };

  // ── Account: change password ──
  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !newPasswordConfirm) return;
    if (newPassword !== newPasswordConfirm) {
      showToast(t('account.newPasswordsMismatch'), 'error');
      return;
    }
    if (newPassword.length < 8 || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      showToast(t('account.newPasswordWeak'), 'error');
      return;
    }
    setChangingPassword(true);
    try {
      await collabAuthApi.changePassword(currentPassword, newPassword);
      // Server revokes every refresh token — sign the user out so they
      // re-authenticate with the new password.
      showToast(t('account.passwordChanged'), 'success');
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
      await performLogout();
    } catch (err: any) {
      showToast(err.message || t('account.changePasswordFailed'), 'error');
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
          ? t('account.twoFactorOnToast')
          : t('account.twoFactorOffToast'),
        'success',
      );
    } catch (err: any) {
      showToast(err.message || t('account.twoFactorFailed'), 'error');
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
      showToast(err.message || t('account.devices.loadFailed'), 'error');
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (showAccount && isLoggedIn && devices === null && !devicesLoading) {
      void refreshDevices();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAccount, isLoggedIn]);

  const handleRevokeDevice = async (deviceId: string) => {
    if (deviceId === getDeviceId()) {
      showToast(t('account.devices.useSignOut'), 'error');
      return;
    }
    if (!confirm(t('account.devices.revokeConfirm'))) return;
    try {
      await collabAuthApi.revokeDevice(deviceId);
      showToast(t('account.devices.revoked'), 'success');
      await refreshDevices();
    } catch (err: any) {
      showToast(err.message || t('account.devices.revokeFailed'), 'error');
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
    if (deleteConfirmation !== DELETE_WORD) {
      showToast(t('account.delete.typeToConfirm', { word: DELETE_WORD }), 'error');
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
      showToast(t('account.delete.deleted'), 'success');
      setDeleteOpen(false);
      setDeletePassword('');
      setDeleteConfirmation('');
      // Clear local auth state — the access token now references a deleted user.
      useSettingsStore.getState().clearCollabAuth();
    } catch (err: any) {
      showToast(err.message || t('account.delete.failed'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleLanguageChange = async (value: string) => {
    try {
      // The Select hands back a string; only a known preference reaches setLanguage.
      const known = languageOptions.find((o) => o.value === value);
      if (!known) return;
      await setLanguage(known.value);
    } catch (err) {
      console.error('[SettingsPage] Changing the language failed:', err);
      showToast(t('language.failed'), 'error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: () => void) => {
    if (e.key === 'Enter') action();
  };

  return (
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={goBack} title={t('page.back')}>
          &larr;
        </button>
        <h1>{t('page.title')}</h1>
      </div>

      <div className="settings-content">
        {/* ── Interface language ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">{t('language.title')}</h2>
          <p className="settings-section-desc">{t('language.description')}</p>

          <div className="settings-row">
            <label htmlFor="settings-language">{t('language.title')}</label>
            <Select
              id="settings-language"
              className="dialog-input settings-select"
              value={languagePreference}
              onChange={(e) => { void handleLanguageChange(e.target.value); }}
            >
              {languageOptions.map((opt) => (
                // i18n-ignore: a language is listed under its own name, never translated
                <option key={opt.value} value={opt.value} lang={opt.lang} dir={opt.dir}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </section>

        {/* ── Collaboration Server URL ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">{t('collabServer.title')}</h2>
          <p className="settings-section-desc">
            <Trans ns="settings" i18nKey="collabServer.description" components={{ code: <code /> }} />
          </p>

          <div className="settings-row">
            <label>{t('collabServer.serverUrl')}</label>
            <div className="settings-url-row">
              <input
                className="dialog-input settings-url-input"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="wss://collab.open-draft.com"
                onKeyDown={(e) => handleKeyDown(e, handleSaveUrl)}
              />
              <button className="dialog-btn dialog-btn-primary" onClick={handleSaveUrl}>
                {t('common:save')}
              </button>
              <button
                className="dialog-btn"
                onClick={handleTestConnection}
                disabled={connectionStatus === 'testing'}
              >
                {connectionStatus === 'testing' ? t('collabServer.testing') :
                  connectionStatus === 'ok' ? t('collabServer.connected') :
                    connectionStatus === 'fail' ? t('collabServer.failed') : t('collabServer.test')}
              </button>
            </div>
            {connectionStatus === 'ok' && (
              <div className="settings-status settings-status-ok">{t('collabServer.reachable')}</div>
            )}
            {connectionStatus === 'fail' && (
              <div className="settings-status settings-status-fail">{t('collabServer.unreachable')}</div>
            )}
            {urlInput.startsWith('wss://') && (
              <div className="settings-hint">{t('collabServer.tls')}</div>
            )}
            {urlInput.startsWith('ws://') && (
              <div className="settings-hint">{t('collabServer.noEncryption')}</div>
            )}
          </div>
        </section>

        {/* ── OpenDraft Cloud API URL ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">{t('cloud.title')}</h2>
          <p className="settings-section-desc">
            <Trans ns="settings" i18nKey="cloud.description" components={{ code: <code /> }} />
          </p>

          <div className="settings-row">
            <label>{t('cloud.apiUrl')}</label>
            <div className="settings-url-row">
              <input
                className="dialog-input settings-url-input"
                value={cloudApiInput}
                onChange={(e) => setCloudApiInput(e.target.value)}
                placeholder="https://open-draft.com"
                onKeyDown={(e) => handleKeyDown(e, handleSaveCloudApi)}
              />
              <button className="dialog-btn dialog-btn-primary" onClick={handleSaveCloudApi}>
                {t('common:save')}
              </button>
              <button
                className="dialog-btn"
                onClick={handleTestCloudApi}
                disabled={cloudApiStatus === 'testing'}
              >
                {cloudApiStatus === 'testing' ? t('collabServer.testing') :
                  cloudApiStatus === 'ok' ? t('cloud.reachable') :
                    cloudApiStatus === 'fail' ? t('collabServer.failed') : t('collabServer.test')}
              </button>
            </div>
            {cloudApiStatus === 'ok' && (
              <div className="settings-status settings-status-ok">{t('collabServer.reachable')}</div>
            )}
            {cloudApiStatus === 'fail' && (
              <div className="settings-status settings-status-fail">{t('collabServer.unreachable')}</div>
            )}
          </div>
        </section>

        <SaveSettingsSection />

        <BackupSettingsSection />

        <AddOnsSettingsSection />

        {/* ── Collab Account ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">{t('auth.title')}</h2>
          <p className="settings-section-desc">
            {t('auth.description')}
          </p>

          {isDemoServer && (
            <div className="settings-demo-notice">
              <Trans ns="settings" i18nKey="auth.demoNotice" components={{ strong: <strong /> }} />
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
                    <div className="settings-email-unverified">{t('auth.emailNotVerified')}</div>
                  )}
                </div>
                <button
                  className="dialog-btn settings-logout-btn"
                  onClick={handleLogout}
                  disabled={signingOut}
                  aria-busy={signingOut}
                >
                  {signingOut ? t('auth.signingOut') : t('auth.signOut')}
                </button>
              </div>

              {/* Email verification form */}
              {!collabAuth.user!.emailVerified && (
                <div className="settings-verify-section">
                  <p className="settings-verify-text">
                    {t('auth.enterCode')}
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
                      {verifying ? t('auth.verifying') : t('auth.verify')}
                    </button>
                    <button className="dialog-btn" onClick={handleResendVerification}>
                      {t('auth.resend')}
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
                  {t('auth.signIn')}
                </button>
                <button
                  className={`settings-auth-tab ${authTab === 'register' ? 'active' : ''}`}
                  onClick={() => setAuthTab('register')}
                >
                  {t('auth.createAccount')}
                </button>
              </div>

              {authTab === 'login' ? (
                pendingChallenge ? (
                  <div className="settings-auth-form">
                    <div className="settings-verify-text">
                      <Trans
                        ns="settings"
                        i18nKey="auth.deviceChallenge"
                        values={{ email: pendingChallenge.email }}
                        components={{ strong: <strong /> }}
                      />
                    </div>
                    <div className="settings-field">
                      <label>{t('auth.verificationCode')}</label>
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
                        {verifyingDevice ? t('auth.verifying') : t('auth.verifyDevice')}
                      </button>
                      <button
                        className="dialog-btn"
                        onClick={handleResendDeviceCode}
                        disabled={verifyingDevice}
                      >
                        {t('auth.resendCode')}
                      </button>
                      <button
                        className="dialog-btn"
                        onClick={() => { setPendingChallenge(null); setDeviceCode(''); }}
                        disabled={verifyingDevice}
                      >
                        {t('common:cancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                <div className="settings-auth-form">
                  <div className="settings-field">
                    <label>{t('auth.email')}</label>
                    <input
                      className="dialog-input"
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder={t('auth.emailPlaceholder')}
                      onKeyDown={(e) => handleKeyDown(e, handleLogin)}
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('auth.password')}</label>
                    <input
                      className="dialog-input"
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder={t('auth.password')}
                      onKeyDown={(e) => handleKeyDown(e, handleLogin)}
                    />
                  </div>
                  <button
                    className="dialog-btn dialog-btn-primary settings-auth-submit"
                    onClick={handleLogin}
                    disabled={!loginEmail || !loginPassword || authLoading}
                  >
                    {authLoading ? t('auth.signingIn') : t('auth.signIn')}
                  </button>
                </div>
                )
              ) : (
                <div className="settings-auth-form">
                  <div className="settings-field">
                    <label>{t('auth.displayName')}</label>
                    <input
                      className="dialog-input"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      placeholder={t('auth.namePlaceholder')}
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('auth.email')}</label>
                    <input
                      className="dialog-input"
                      type="email"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      placeholder={t('auth.emailPlaceholder')}
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('auth.password')}</label>
                    <input
                      className="dialog-input"
                      type="password"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      placeholder={t('auth.passwordPlaceholder')}
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('auth.confirmPassword')}</label>
                    <input
                      className="dialog-input"
                      type="password"
                      value={regConfirm}
                      onChange={(e) => setRegConfirm(e.target.value)}
                      placeholder={t('auth.confirmPasswordPlaceholder')}
                      onKeyDown={(e) => handleKeyDown(e, handleRegister)}
                    />
                  </div>
                  <button
                    className="dialog-btn dialog-btn-primary settings-auth-submit"
                    onClick={handleRegister}
                    disabled={!regEmail || !regPassword || !regName || authLoading}
                  >
                    {authLoading ? t('auth.creatingAccount') : t('auth.createAccount')}
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
                  {t('auth.rememberEmail')}
                </label>
                <p className="collab-remember-hint">
                  {t('auth.rememberHint')}
                </p>
              </div>

              {/* Google sign-in */}
              {serverConfig?.googleEnabled && (
                <div className="settings-google-section">
                  <div className="settings-divider">
                    <span>{t('auth.or')}</span>
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
                    {googleLoading ? t('auth.signingIn') : t('auth.signInWithGoogle')}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── Account & Security (signed-in users only) ── */}
        {isLoggedIn && (
          <section className="settings-section">
            <h2 className="settings-section-title">{t('account.title')}</h2>
            <p className="settings-section-desc">
              {t('account.description')}
            </p>

            {!showAccount ? (
              <button className="dialog-btn" onClick={() => setShowAccount(true)}>
                {t('account.open')}
              </button>
            ) : (
              <div className="settings-auth-card">
                {/* Two-factor toggle */}
                <div className="settings-account-block">
                  <div className="settings-account-row">
                    <div>
                      <div className="settings-account-title">{t('account.twoFactor')}</div>
                      <div className="settings-account-hint">
                        {t('account.twoFactorHint')}
                      </div>
                      {serverConfig && serverConfig.smtpConfigured === false && (
                        <div
                          className="settings-account-hint"
                          style={{ color: 'var(--fd-warning, #b85c00)', marginTop: 4 }}
                        >
                          {t('account.smtpMissing')}
                        </div>
                      )}
                    </div>
                    <label className="settings-switch">
                      <input
                        type="checkbox"
                        checked={Boolean(collabAuth.user?.twoFactorEnabled)}
                        disabled={
                          twoFactorBusy ||
                          (serverConfig?.smtpConfigured === false &&
                            !collabAuth.user?.twoFactorEnabled)
                        }
                        onChange={(e) => handleToggleTwoFactor(e.target.checked)}
                      />
                      <span>{collabAuth.user?.twoFactorEnabled ? t('common:on') : t('common:off')}</span>
                    </label>
                  </div>
                </div>

                {/* Change password */}
                <div className="settings-account-block">
                  <div className="settings-account-title">{t('account.changePassword')}</div>
                  <div className="settings-account-hint">
                    {t('account.changePasswordHint')}
                  </div>
                  <div className="settings-field">
                    <label>{t('account.currentPassword')}</label>
                    <input
                      className="dialog-input"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder={t('account.currentPasswordPlaceholder')}
                      autoComplete="current-password"
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('account.newPassword')}</label>
                    <input
                      className="dialog-input"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={t('auth.passwordPlaceholder')}
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="settings-field">
                    <label>{t('account.confirmNewPassword')}</label>
                    <input
                      className="dialog-input"
                      type="password"
                      value={newPasswordConfirm}
                      onChange={(e) => setNewPasswordConfirm(e.target.value)}
                      placeholder={t('account.repeatNewPassword')}
                      autoComplete="new-password"
                    />
                  </div>
                  <button
                    className="dialog-btn dialog-btn-primary"
                    onClick={handleChangePassword}
                    disabled={!currentPassword || !newPassword || !newPasswordConfirm || changingPassword}
                  >
                    {changingPassword ? t('account.updating') : t('account.updatePassword')}
                  </button>
                </div>

                {/* Devices */}
                <div className="settings-account-block">
                  <div className="settings-account-row">
                    <div>
                      <div className="settings-account-title">{t('account.devices.title')}</div>
                      <div className="settings-account-hint">
                        {t('account.devices.hint')}
                      </div>
                    </div>
                    <button className="dialog-btn" onClick={refreshDevices} disabled={devicesLoading}>
                      {devicesLoading ? t('account.devices.loading') : t('account.devices.refresh')}
                    </button>
                  </div>
                  {devicesLoading && devices === null ? (
                    <div className="settings-account-hint">{t('account.devices.loadingList')}</div>
                  ) : (devices || []).length === 0 ? (
                    <div className="settings-account-hint">{t('account.devices.none')}</div>
                  ) : (
                    <ul className="settings-device-list">
                      {(devices || []).map((d) => (
                        <li key={d.deviceId} className="settings-device-row">
                          <div className="settings-device-info">
                            <div className="settings-device-name">
                              {d.deviceName}
                              {d.current && <span className="settings-device-current"> {t('account.devices.thisDevice')}</span>}
                            </div>
                            <div className="settings-device-meta">
                              {d.platform || t('account.devices.unknownPlatform')}
                              {d.ipAddress ? ` · ${d.ipAddress}` : ''}
                            </div>
                            <div className="settings-device-meta">
                              {t('account.devices.lastSeen', { date: formatDateTime(d.lastSeenAt, FULL_DATE_TIME) })}
                            </div>
                          </div>
                          {!d.current && (
                            <button
                              className="dialog-btn dialog-btn-danger"
                              onClick={() => handleRevokeDevice(d.deviceId)}
                            >
                              {t('account.devices.revoke')}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Delete account (Apple Guideline 5.1.1(v)) */}
                <div className="settings-account-block settings-account-danger">
                  <div className="settings-account-title">{t('account.delete.title')}</div>
                  <div className="settings-account-hint">
                    {t('account.delete.hint')}
                  </div>
                  {!deleteOpen ? (
                    <button
                      className="dialog-btn dialog-btn-danger"
                      onClick={handleOpenDelete}
                    >
                      {t('account.delete.open')}
                    </button>
                  ) : (
                    <div className="settings-delete-confirm">
                      <div className="settings-delete-warning">
                        <strong>{t('account.delete.before')}</strong>{' '}
                        {inventoryLoading ? (
                          t('account.delete.checking')
                        ) : cloudInventory && (cloudInventory.projects > 0 || cloudInventory.scripts > 0) ? (
                          <Trans
                            ns="settings"
                            i18nKey="account.delete.found"
                            values={{
                              projects: t('account.delete.projects', { count: cloudInventory.projects }),
                              screenplays: cloudInventory.scripts > 0
                                ? `${t('account.delete.screenplays', { count: cloudInventory.scripts })} `
                                : '',
                            }}
                            components={{ strong: <strong />, em: <em /> }}
                          />
                        ) : (
                          t('account.delete.generic')
                        )}
                        {cloudPortalLink && (
                          <>
                            {' '}
                            <Trans
                              ns="settings"
                              i18nKey="account.delete.portal"
                              values={{ url: cloudPortalLink }}
                              components={{ link: <a href={cloudPortalLink} target="_blank" rel="noreferrer" /> }}
                            />
                          </>
                        )}
                      </div>

                      <div className="settings-field">
                        <label>{t('account.delete.passwordLabel')}</label>
                        <input
                          className="dialog-input"
                          type="password"
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                          placeholder={t('account.delete.passwordPlaceholder')}
                          autoComplete="current-password"
                        />
                      </div>

                      <div className="settings-field">
                        <label><Trans ns="settings" i18nKey="account.delete.typeLabel" values={{ word: DELETE_WORD }} components={{ strong: <strong /> }} /></label>
                        <input
                          className="dialog-input"
                          value={deleteConfirmation}
                          onChange={(e) => setDeleteConfirmation(e.target.value)}
                          placeholder={DELETE_WORD}
                        />
                      </div>

                      <div className="settings-verify-row">
                        <button
                          className="dialog-btn dialog-btn-danger"
                          onClick={handleDeleteAccount}
                          disabled={deleting || deleteConfirmation !== DELETE_WORD}
                        >
                          {deleting ? t('account.delete.deleting') : t('account.delete.confirm')}
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
                          {t('common:cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ── Printing ──
            Only where there is a choice to make. iPad, iPhone and Android have
            no print dialog of their own — printRoute() explains why — so they
            print the PDF whatever this says, and a switch that changed nothing
            would be worse than no switch at all. */}
        {printRoute() === 'dialog' && (
        <section className="settings-section">
          <h2 className="settings-section-title">{t('printing.title')}</h2>
          <p className="settings-section-desc">
            {t('printing.description')}
          </p>

          <div className="settings-row">
            <label>
              <input
                type="checkbox"
                checked={printViaPdf}
                onChange={(e) => setPrintViaPdf(e.target.checked)}
              />{' '}
              {t('printing.viaPdf')}
            </label>
            <div className="settings-hint">
              {t('printing.viaPdfHint')}
            </div>
          </div>
        </section>
        )}

        {/* ── Table Read (issue #131) ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">{t('tableRead.title')}</h2>
          <p className="settings-section-desc">
            {isTauriApp() ? t('tableRead.descriptionDevice') : t('tableRead.descriptionComputer')}
          </p>
          <VoiceProviderSettings />
        </section>

        {/* ── Editing ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">{t('editing.title')}</h2>
          <p className="settings-section-desc">
            {t('editing.description')}
          </p>

          <div className="settings-row">
            <label>
              <input
                type="checkbox"
                checked={elementMenuOnEnter}
                onChange={(e) => setElementMenuOnEnter(e.target.checked)}
              />{' '}
              {t('editing.menuOnEnter')}
            </label>
            <div className="settings-hint">
              {t('editing.menuOnEnterHint')}
            </div>
          </div>

          <div className="settings-row">
            <label htmlFor="element-menu-shortcut">{t('editing.shortcut')}</label>
            <ShortcutField
              id="element-menu-shortcut"
              value={elementMenuShortcut}
              onChange={setElementMenuShortcut}
            />
            <div className="settings-hint">
              {isMacPlatform() ? t('editing.shortcutHintMac') : t('editing.shortcutHintOther')}
            </div>
          </div>
        </section>

        <MacroSettingsSection />

        {/* ── Invite Defaults ── */}
        <section className="settings-section">
          <h2 className="settings-section-title">{t('invite.title')}</h2>
          <p className="settings-section-desc">
            {t('invite.description')}
          </p>

          <div className="settings-row">
            <label>{t('invite.expiry')}</label>
            <Select
              className="dialog-input settings-select"
              value={defaultInviteExpiry}
              onChange={(e) => setDefaultInviteExpiry(Number(e.target.value))}
            >
              {EXPIRY_OPTIONS.map((opt) => (
                <option key={opt.hours} value={opt.hours}>
                  {expiryLabel(opt)}
                </option>
              ))}
            </Select>
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
    script.onerror = () => reject(new Error(translate('settings:auth.googleScriptFailed')));
    document.head.appendChild(script);
  });
}

function getGoogleIdToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const google = (window as any).google;
    if (!google?.accounts?.id) {
      reject(new Error(translate('settings:auth.googleNotLoaded')));
      return;
    }

    google.accounts.id.initialize({
      client_id: '', // Will be filled from server config
      callback: (response: any) => {
        if (response.credential) {
          resolve(response.credential);
        } else {
          reject(new Error(translate('settings:auth.googleNoCredential')));
        }
      },
    });

    google.accounts.id.prompt((notification: any) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        reject(new Error(translate('settings:auth.googleCancelled')));
      }
    });
  });
}

export default SettingsPage;
