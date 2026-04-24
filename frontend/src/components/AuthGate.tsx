/**
 * AuthGate — listens for auth/quota events dispatched from the API client and
 * opens the appropriate dialog. Mounted once at the app root so every API
 * call site gets consistent behavior.
 *
 * Events (see src/services/api.ts):
 *   opendraft:auth-required    → open CollabLoginDialog
 *   opendraft:email-unverified → open VerifyEmailDialog
 *   opendraft:quota-exceeded   → open QuotaExceededDialog with the payload
 */

import React, { useEffect, useState } from 'react';
import CollabLoginDialog from './CollabLoginDialog';
import VerifyEmailDialog from './VerifyEmailDialog';
import QuotaExceededDialog from './QuotaExceededDialog';
import type { QuotaErrorDetail } from '../services/api';

const AuthGate: React.FC = () => {
  const [loginOpen, setLoginOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [quotaDetail, setQuotaDetail] = useState<QuotaErrorDetail | null>(null);

  useEffect(() => {
    const onAuthRequired = () => setLoginOpen(true);
    const onUnverified = () => setVerifyOpen(true);
    const onQuota = (e: Event) => {
      const detail = (e as CustomEvent<QuotaErrorDetail>).detail;
      if (detail) setQuotaDetail(detail);
    };
    window.addEventListener('opendraft:auth-required', onAuthRequired);
    window.addEventListener('opendraft:email-unverified', onUnverified);
    window.addEventListener('opendraft:quota-exceeded', onQuota as EventListener);
    return () => {
      window.removeEventListener('opendraft:auth-required', onAuthRequired);
      window.removeEventListener('opendraft:email-unverified', onUnverified);
      window.removeEventListener('opendraft:quota-exceeded', onQuota as EventListener);
    };
  }, []);

  return (
    <>
      {loginOpen && (
        <CollabLoginDialog
          onClose={() => setLoginOpen(false)}
          onSuccess={() => setLoginOpen(false)}
        />
      )}
      {verifyOpen && (
        <VerifyEmailDialog onClose={() => setVerifyOpen(false)} />
      )}
      {quotaDetail && (
        <QuotaExceededDialog
          detail={quotaDetail}
          onClose={() => setQuotaDetail(null)}
        />
      )}
    </>
  );
};

export default AuthGate;
