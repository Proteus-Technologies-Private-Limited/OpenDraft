/**
 * Shown at startup when the Tauri SQLite plugin is unavailable and we have
 * dropped into file-based fallback storage.  Displays the underlying error
 * so the user can report it, and explains that the app is still safe to use.
 */

import React from 'react';
import { ModalOverlay } from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import { useStorageStatusStore } from '../stores/storageStatusStore';

const StorageFallbackDialog: React.FC = () => {
  const { t } = useTranslation(['dialogs', 'common']);
  const { mode, errorReason, acknowledged, acknowledge } = useStorageStatusStore();

  if (acknowledged) return null;
  if (mode === 'sqlite' || mode === 'http') return null;

  const isFile = mode === 'file-fallback';
  const heading = isFile
    ? t('storageFallback.fileHeading')
    : t('storageFallback.dbHeading');
  const explanation = isFile
    ? t('storageFallback.fileExplanation')
    : t('storageFallback.dbExplanation');

  return (
    <ModalOverlay className="dialog-overlay" onClick={acknowledge}>
      <div
        className="dialog-box"
        style={{ maxWidth: 480 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="dialog-header">{heading}</div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 12px' }}>{explanation}</p>
          {errorReason && (
            <>
              <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--fd-text-muted)' }}>
                {t('storageFallback.underlyingError')}
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
                {errorReason}
              </pre>
            </>
          )}
        </div>
        <div className="dialog-footer">
          <div style={{ flex: 1 }} />
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={acknowledge}
            autoFocus
          >
            {t('common:continue')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default StorageFallbackDialog;
