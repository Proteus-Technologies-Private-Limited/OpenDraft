/**
 * Shown at startup when the Tauri SQLite plugin is unavailable and we have
 * dropped into file-based fallback storage.  Displays the underlying error
 * so the user can report it, and explains that the app is still safe to use.
 */

import React from 'react';
import { useStorageStatusStore } from '../stores/storageStatusStore';

const StorageFallbackDialog: React.FC = () => {
  const { mode, errorReason, acknowledged, acknowledge } = useStorageStatusStore();

  if (acknowledged) return null;
  if (mode === 'sqlite' || mode === 'http') return null;

  const isFile = mode === 'file-fallback';
  const heading = isFile
    ? 'Switched to file-based storage'
    : 'Local database unavailable';
  const explanation = isFile
    ? 'OpenDraft could not open its local database, so your projects are now being saved as individual files in your app data folder. You can keep working — saving and loading still work normally, but version history is disabled until the database is reachable again.'
    : 'OpenDraft could not open its local database and the file-based fallback also failed. Your changes will be saved in the browser only and may be lost if storage is cleared.';

  return (
    <div className="dialog-overlay" onClick={acknowledge}>
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
                Underlying error:
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
            Continue
          </button>
        </div>
      </div>
    </div>
  );
};

export default StorageFallbackDialog;
