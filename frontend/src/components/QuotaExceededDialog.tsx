/**
 * QuotaExceededDialog — shown when the backend returns 402 quota_exceeded.
 * The actual upgrade flow (Stripe, tier picker) lives in OpenDraft-Pro. Core
 * only shows the "limit reached" message and a pluggable "Upgrade" action:
 * Pro registers an upgrade handler via the plugin registry, and we invoke
 * it here when present.
 */

import React from 'react';
import type { QuotaErrorDetail } from '../services/api';
import { pluginRegistry } from '../plugins/registry';

interface QuotaExceededDialogProps {
  detail: QuotaErrorDetail;
  onClose: () => void;
}

const QuotaExceededDialog: React.FC<QuotaExceededDialogProps> = ({ detail, onClose }) => {
  // Pro can register an upgrade handler; core has none, so the button hides.
  const upgradeHandler = (pluginRegistry as any).getUpgradeHandler?.() as
    | (() => void)
    | undefined;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">Free plan limit reached</div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 12px' }}>{detail.message}</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted)' }}>
            You have <strong>{detail.current}</strong> of <strong>{detail.limit}</strong> files on the{' '}
            <strong>{detail.current_plan}</strong> plan.
          </p>
        </div>
        <div className="dialog-footer">
          <div style={{ flex: 1 }} />
          <button className="dialog-btn" onClick={onClose}>Close</button>
          {upgradeHandler && (
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={() => { upgradeHandler(); onClose(); }}
            >
              Upgrade
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuotaExceededDialog;
