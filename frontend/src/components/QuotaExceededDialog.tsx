/**
 * QuotaExceededDialog — shown when the backend returns 402 quota_exceeded.
 * The actual upgrade flow (Stripe, tier picker) lives in OpenDraft-Pro. Core
 * only shows the "limit reached" message and a pluggable "Upgrade" action:
 * Pro registers an upgrade handler via the plugin registry, and we invoke
 * it here when present.
 */

import React from 'react';
import { ModalOverlay } from './ModalOverlay';
import { Trans, useTranslation } from 'react-i18next';
import type { QuotaErrorDetail } from '../services/api';
import { pluginRegistry } from '../plugins/registry';

interface QuotaExceededDialogProps {
  detail: QuotaErrorDetail;
  onClose: () => void;
}

const QuotaExceededDialog: React.FC<QuotaExceededDialogProps> = ({ detail, onClose }) => {
  const { t } = useTranslation(['dialogs', 'common']);
  // Pro can register an upgrade handler; core has none, so the button hides.
  const upgradeHandler = (pluginRegistry as any).getUpgradeHandler?.() as
    | (() => void)
    | undefined;

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-header">{t('quota.title')}</div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 12px' }}>{detail.message}</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted)' }}>
            <Trans
              ns="dialogs"
              i18nKey="quota.usage"
              values={{ current: detail.current, limit: detail.limit, plan: detail.current_plan }}
              components={{ strong: <strong /> }}
            />
          </p>
        </div>
        <div className="dialog-footer">
          <div style={{ flex: 1 }} />
          <button className="dialog-btn" onClick={onClose}>{t('common:close')}</button>
          {upgradeHandler && (
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={() => { upgradeHandler(); onClose(); }}
            >
              {t('quota.upgrade')}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
};

export default QuotaExceededDialog;
