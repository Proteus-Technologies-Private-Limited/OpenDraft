/**
 * /verify?email=…&code=… magic-link handler.
 *
 * The activation email contains a link to this route. On mount we POST the
 * email+code to /auth/verify-email-link, store the returned tokens, then
 * bounce the user back to the app. Failure shows an inline error with a
 * retry/resend path.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { collabAuthApi, handleAuthResponse } from '../services/collabAuth';

const VerifyEmailRoute: React.FC = () => {
  const { t } = useTranslation('collab');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const email = params.get('email') || '';
  const code = params.get('code') || '';
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [error, setError] = useState<string>('');
  // Strict-mode double-mount guard.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!email || !code) {
      setStatus('error');
      setError(t('verifyRoute.missingParams'));
      return;
    }

    (async () => {
      try {
        const resp = await collabAuthApi.verifyEmailLink(email, code);
        handleAuthResponse(resp);
        setStatus('success');
        // Brief pause so the user sees the confirmation, then continue.
        setTimeout(() => navigate('/', { replace: true }), 900);
      } catch (err: any) {
        setStatus('error');
        setError(err?.message || t('verifyRoute.failed'));
      }
    })();
  }, [email, code, navigate, t]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '70vh', padding: 24,
    }}>
      <div style={{
        maxWidth: 420, width: '100%', padding: 24, borderRadius: 8,
        background: 'var(--fd-dialog-bg, #333)',
        color: 'var(--fd-text, #eee)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.25)',
        textAlign: 'center',
      }}>
        {status === 'pending' && (
          <>
            <h2 style={{ marginTop: 0 }}>{t('verifyRoute.activating')}</h2>
            <p>{t('verifyRoute.wait')}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <h2 style={{ marginTop: 0 }}>{t('verifyRoute.success')}</h2>
            <p>{t('verifyRoute.successBody')}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <h2 style={{ marginTop: 0 }}>{t('verifyRoute.errorTitle')}</h2>
            <p style={{ color: 'var(--fd-text-muted, #aaa)' }}>{error}</p>
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={() => navigate('/', { replace: true })}
              style={{ marginTop: 12 }}
            >
              {t('verifyRoute.goToApp')}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default VerifyEmailRoute;
