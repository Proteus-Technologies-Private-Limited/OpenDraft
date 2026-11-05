/**
 * Blocking modal shown when a save (auto-save, manual save, metadata save,
 * or save-on-close) fails.  The user must acknowledge before continuing so
 * unsaved-data risk is impossible to miss.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSaveErrorStore } from '../stores/saveErrorStore';
import { formatTime } from '../i18n/format';

const SaveErrorDialog: React.FC = () => {
  const { t } = useTranslation('dialogs');
  const error = useSaveErrorStore((s) => s.error);
  const clearError = useSaveErrorStore((s) => s.clearError);

  if (!error) return null;

  let heading: string;
  switch (error.source) {
    case 'auto-save':
      heading = t('saveError.heading.autoSave');
      break;
    case 'save-on-close':
      heading = t('saveError.heading.beforeClose');
      break;
    default:
      heading = t('saveError.heading.saveFailed');
  }
  const localTime = formatTime(error.at, { timeStyle: 'medium' });

  return (
    <div className="dialog-overlay" onClick={clearError}>
      <div
        className="dialog-box"
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <div className="dialog-header">{heading}</div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 12px' }}>
            {t('saveError.body')}
          </p>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--fd-text-muted)' }}>
            {t('saveError.failureAt', { time: localTime })}
          </p>
          <pre
            style={{
              margin: 0,
              padding: '8px 10px',
              fontSize: 12,
              background: '#f4f4f4',
              color: '#1a1a1a',
              border: '1px solid #ddd',
              borderRadius: 4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 160,
              overflow: 'auto',
            }}
          >
            {error.message}
          </pre>
        </div>
        <div className="dialog-footer">
          <div style={{ flex: 1 }} />
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={clearError}
            autoFocus
          >
            {t('saveError.acknowledge')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveErrorDialog;
