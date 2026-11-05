/**
 * /reset-password?token=… landing page.
 *
 * The forgot-password email carries a link here with an opaque token. The
 * user picks a new password; we POST {token, newPassword} to /reset-password.
 * On success the server has already revoked every refresh token, so we bounce
 * the user to the app and let the normal sign-in flow take over.
 */

import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { collabAuthApi } from '../services/collabAuth';
import { showToast } from './Toast';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const ResetPasswordRoute: React.FC = () => {
  const { t } = useTranslation(['collab', 'common']);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');

  // Missing token = the user got here via something other than the email link.
  // We still render the form so the user can read why it's broken.
  const missingToken = !token;

  const validate = (): string | null => {
    if (password.length < 8) return t('resetPassword.tooShort');
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return t('resetPassword.weak');
    }
    if (password !== confirm) return t('resetPassword.mismatch');
    return null;
  };

  const handleSubmit = async () => {
    if (missingToken) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    setStatus('submitting');
    try {
      await collabAuthApi.resetPassword(token, password);
      setStatus('success');
      showToast(t('resetPassword.updated'), 'success');
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err: any) {
      setStatus('error');
      setError(err?.message || t('resetPassword.failed'));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '70vh', padding: 24,
    }}>
      <div
        style={{
          maxWidth: 440, width: '100%', padding: 24, borderRadius: 8,
          background: 'var(--fd-dialog-bg, #333)',
          color: 'var(--fd-text, #eee)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
        }}
        onKeyDown={handleKeyDown}
      >
        <h2 style={{ marginTop: 0 }}>{t('resetPassword.title')}</h2>

        {missingToken ? (
          <>
            <p style={{ color: 'var(--fd-text-muted, #aaa)' }}>
              {t('resetPassword.missingToken')}
            </p>
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={() => navigate('/', { replace: true })}
              style={{ marginTop: 12 }}
            >
              {t('resetPassword.goToSignIn')}
            </button>
          </>
        ) : status === 'success' ? (
          <>
            <p>{t('resetPassword.success')}</p>
          </>
        ) : (
          <div className="settings-auth-form">
            <div className="settings-field">
              <label>{t('resetPassword.newPassword')}</label>
              <div className="password-input-wrapper">
                <input
                  className="dialog-input"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.passwordHint')}
                  autoFocus
                  disabled={status === 'submitting'}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPw(!showPw)}
                  tabIndex={-1}
                  aria-label={showPw ? t('resetPassword.hidePassword') : t('resetPassword.showPassword')}
                >
                  {showPw ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>
            <div className="settings-field">
              <label>{t('resetPassword.confirmPassword')}</label>
              <div className="password-input-wrapper">
                <input
                  className="dialog-input"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder={t('resetPassword.reenter')}
                  disabled={status === 'submitting'}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirm(!showConfirm)}
                  tabIndex={-1}
                  aria-label={showConfirm ? t('resetPassword.hidePassword') : t('resetPassword.showPassword')}
                >
                  {showConfirm ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>

            {error && (
              <p style={{ color: '#e57373', fontSize: 13, margin: 0 }}>{error}</p>
            )}

            <button
              className="dialog-btn dialog-btn-primary settings-auth-submit"
              onClick={handleSubmit}
              disabled={!password || !confirm || status === 'submitting'}
            >
              {status === 'submitting' ? t('resetPassword.updating') : t('resetPassword.update')}
            </button>
            <button
              className="dialog-btn"
              onClick={() => navigate('/', { replace: true })}
              disabled={status === 'submitting'}
            >
              {t('common:cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordRoute;
