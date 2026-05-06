/**
 * Blocking modal shown when a save (auto-save, manual save, metadata save,
 * or save-on-close) fails.  The user must acknowledge before continuing so
 * unsaved-data risk is impossible to miss.
 */

import React from 'react';
import { useSaveErrorStore } from '../stores/saveErrorStore';

const SOURCE_LABELS: Record<string, string> = {
  'auto-save': 'Auto-save failed',
  'metadata-save': 'Save failed',
  'manual-save': 'Save failed',
  'save-on-close': 'Could not save before closing',
};

const SaveErrorDialog: React.FC = () => {
  const error = useSaveErrorStore((s) => s.error);
  const clearError = useSaveErrorStore((s) => s.clearError);

  if (!error) return null;

  const heading = SOURCE_LABELS[error.source] || 'Save failed';
  const localTime = new Date(error.at).toLocaleTimeString();

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
            OpenDraft could not save your changes. Your work is still in the
            editor — please copy anything important before closing the app or
            reloading the window.
          </p>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: 'var(--fd-text-muted)' }}>
            Failure at {localTime}:
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
            I understand
          </button>
        </div>
      </div>
    </div>
  );
};

export default SaveErrorDialog;
