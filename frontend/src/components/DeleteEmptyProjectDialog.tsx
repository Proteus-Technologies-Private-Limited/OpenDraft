/**
 * Asked once a project's last script has been deleted: delete the now-empty
 * project as well, or keep it for the next draft.
 *
 * Keeping it is the default — the button that has focus, and what Escape or a
 * click outside does — because an empty project costs nothing and may be
 * exactly where the writer means to start again.
 */

import React, { useEffect, useRef, useState } from 'react';
import { FaCheck } from 'react-icons/fa';

export interface DeleteEmptyProjectDialogProps {
  projectName: string;
  source: 'local' | 'cloud';
  /** Title of the script just deleted, when this follows a delete. */
  deletedScriptTitle?: string | null;
  /** Check-ins in the project's version history, when known. */
  versionCount?: number;
  /** Folder the project saves to on disk, when it has one. */
  folderPath?: string | null;
  onKeep: () => void;
  /** Delete the project. Rejects with a message to show if it failed. */
  onDelete: () => Promise<void>;
}

const DeleteEmptyProjectDialog: React.FC<DeleteEmptyProjectDialogProps> = ({
  projectName,
  source,
  deletedScriptTitle,
  versionCount,
  folderPath,
  onKeep,
  onDelete,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  const handleDelete = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      console.error('[delete-project] delete failed', err);
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const history = versionCount && versionCount > 0
    ? `Its version history (${versionCount} check-in${versionCount === 1 ? '' : 's'})`
    : 'Its version history';

  return (
    <div className="dialog-overlay" onClick={() => { if (!busy) onKeep(); }}>
      <div
        className="dialog-box delete-script-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-empty-project-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape' && !busy) { e.stopPropagation(); onKeep(); } }}
      >
        <div className="dialog-header" id="delete-empty-project-title">Delete the Project Too?</div>

        <div className="dialog-body delete-script-body">
          {deletedScriptTitle && (
            <span className="delete-script-hint delete-script-hint--ok delete-empty-done">
              <FaCheck aria-hidden="true" /> <span><strong>{deletedScriptTitle}</strong> was deleted.</span>
            </span>
          )}

          <p className="delete-script-warning">
            <strong>{projectName}</strong> has no scripts left. Do you want to delete the project
            as well?
          </p>

          <div className="delete-script-card delete-empty-list">
            <span className="delete-script-card-meta">Deleting the project also removes</span>
            <ul>
              <li>Its assets</li>
              <li>{history}</li>
              <li>Project properties and the submission log</li>
            </ul>
          </div>

          <p className="delete-empty-note">
            {source === 'cloud'
              ? 'It is removed from OpenDraft Cloud on every device, and can’t be undone.'
              : 'This can’t be undone.'}
            {folderPath ? ` The files in ${folderPath} stay on disk.` : ''}
            {' '}Keep it if you plan to add a new draft here.
          </p>

          {error && <div className="delete-script-error" role="alert">Delete failed: {error}</div>}
        </div>

        <div className="dialog-actions">
          <button type="button" className="dialog-danger-outline" onClick={() => { void handleDelete(); }} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete Project'}
          </button>
          <button type="button" ref={keepRef} className="dialog-primary" onClick={onKeep} disabled={busy}>
            Keep Project
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteEmptyProjectDialog;
