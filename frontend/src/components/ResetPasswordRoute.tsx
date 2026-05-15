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
import { FaEye, FaEyeSlash } from 'react-icons/fa';
import { collabAuthApi } from '../services/collabAuth';
import { showToast } from './Toast';

type Status = 'idle' | 'submitting' | 'success' | 'error';

const ResetPasswordRoute: React.FC = () => {
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
    if (password.length < 8) return 'Password must be at least 8 characters.';
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return 'Password must contain an uppercase letter, a lowercase letter, and a digit.';
    }
    if (password !== confirm) return 'Passwords do not match.';
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
      showToast('Password updated. You can sign in with your new password.', 'success');
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err: any) {
      setStatus('error');
      setError(err?.message || 'Could not reset password.');
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
          background: 'var(--fd-surface, #1e1e1e)',
          color: 'var(--fd-text, #eee)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
        }}
        onKeyDown={handleKeyDown}
      >
        <h2 style={{ marginTop: 0 }}>Choose a new password</h2>

        {missingToken ? (
          <>
            <p style={{ color: 'var(--fd-text-muted, #aaa)' }}>
              This reset link is missing its token. Request a new password-reset
              email from the sign-in screen.
            </p>
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={() => navigate('/', { replace: true })}
              style={{ marginTop: 12 }}
            >
              Go to sign in
            </button>
          </>
        ) : status === 'success' ? (
          <>
            <p>Your password was updated. Redirecting to the sign-in screen…</p>
          </>
        ) : (
          <div className="settings-auth-form">
            <div className="settings-field">
              <label>New Password</label>
              <div className="password-input-wrapper">
                <input
                  className="dialog-input"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 chars, upper + lower + digit"
                  autoFocus
                  disabled={status === 'submitting'}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPw(!showPw)}
                  tabIndex={-1}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>
            <div className="settings-field">
              <label>Confirm Password</label>
              <div className="password-input-wrapper">
                <input
                  className="dialog-input"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter password"
                  disabled={status === 'submitting'}
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowConfirm(!showConfirm)}
                  tabIndex={-1}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
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
              {status === 'submitting' ? 'Updating…' : 'Update password'}
            </button>
            <button
              className="dialog-btn"
              onClick={() => navigate('/', { replace: true })}
              disabled={status === 'submitting'}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordRoute;
