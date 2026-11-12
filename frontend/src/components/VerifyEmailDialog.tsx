/**
 * VerifyEmailDialog — OTP code entry after registration or when a protected
 * action returns 403 email_not_verified. Also used as the target for the
 * magic-link /verify route via preset props.
 */

import React, { useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { Trans, useTranslation } from 'react-i18next';
import { collabAuthApi, handleAuthResponse } from '../services/collabAuth';
import { useSettingsStore } from '../stores/settingsStore';
import { showToast } from './Toast';

interface VerifyEmailDialogProps {
  onClose: () => void;
  onSuccess?: () => void;
}

const VerifyEmailDialog: React.FC<VerifyEmailDialogProps> = ({ onClose, onSuccess }) => {
  const { t } = useTranslation(['collab', 'common']);
  const user = useSettingsStore((s) => s.collabAuth.user);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);

  const handleVerify = async () => {
    if (code.trim().length !== 6) {
      showToast(t('verifyEmail.toast.enterCode'), 'error');
      return;
    }
    setLoading(true);
    try {
      // Prefer the authenticated /verify-email if we already have a token,
      // otherwise fall back to the unauthenticated /verify-email-link with
      // the user's email from local state.
      if (useSettingsStore.getState().collabAuth.accessToken) {
        await collabAuthApi.verifyEmail(code.trim());
        // Refresh cached user so emailVerified flips to true.
        const refreshed = await collabAuthApi.getMe();
        const current = useSettingsStore.getState().collabAuth;
        useSettingsStore.getState().setCollabAuth({ ...current, user: refreshed });
      } else {
        if (!user?.email) {
          showToast(t('verifyEmail.toast.noAccount'), 'error');
          return;
        }
        const resp = await collabAuthApi.verifyEmailLink(user.email, code.trim());
        handleAuthResponse(resp);
      }
      showToast(t('verifyEmail.toast.verified'), 'success');
      onSuccess?.();
      onClose();
    } catch (err: any) {
      showToast(err.message || t('verifyEmail.toast.failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResendLoading(true);
    try {
      await collabAuthApi.resendVerification();
      showToast(t('verifyEmail.toast.sent'), 'success');
    } catch (err: any) {
      showToast(err.message || t('verifyEmail.toast.resendFailed'), 'error');
    } finally {
      setResendLoading(false);
    }
  };

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleVerify();
          else if (e.key === 'Escape') onClose();
        }}
      >
        <div className="dialog-header">{t('verifyEmail.title')}</div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--fd-text-muted)' }}>
            {user?.email ? (
              <Trans ns="collab" i18nKey="verifyEmail.bodyWithEmail" values={{ email: user.email }} components={{ strong: <strong /> }} />
            ) : (
              t('verifyEmail.bodyNoEmail')
            )}
          </p>
          <input
            className="dialog-input"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="123456"
            autoFocus
            style={{ letterSpacing: 6, fontSize: 20, textAlign: 'center' }}
          />
          <button
            className="dialog-btn dialog-btn-primary settings-auth-submit"
            onClick={handleVerify}
            disabled={loading || code.length !== 6}
            style={{ marginTop: 12 }}
          >
            {loading ? t('verifyEmail.verifying') : t('verifyEmail.verify')}
          </button>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button
              className="dialog-btn"
              onClick={handleResend}
              disabled={resendLoading || !useSettingsStore.getState().collabAuth.accessToken}
              style={{ fontSize: 13 }}
            >
              {resendLoading ? t('verifyEmail.sending') : t('verifyEmail.resendCode')}
            </button>
          </div>
        </div>
        <div className="dialog-footer">
          <div style={{ flex: 1 }} />
          <button className="dialog-btn" onClick={onClose}>{t('common:cancel')}</button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default VerifyEmailDialog;
