/**
 * File → Delete Script…: deletes the script open in the editor, once the
 * writer has typed its name.
 *
 * Typing the name is the confirmation because this delete starts from a menu,
 * a click away from Close Script and Save, rather than from the script's own
 * card. The project screen keeps its one-click confirm for clearing out many
 * drafts at once, and this dialog points there.
 */

import React, { useEffect, useRef, useState } from 'react';
import { FaCheck, FaChevronRight, FaCloud, FaDesktop, FaFileAlt, FaInfoCircle } from 'react-icons/fa';
import { confirmNameMatches, confirmTargetName } from '../utils/deleteConfirm';

export interface DeleteScriptDialogProps {
  scriptTitle: string;
  projectName: string;
  source: 'local' | 'cloud';
  pageCount?: number | null;
  updatedAt?: string | null;
  /** The file on disk this script is also saved to, when it has one. */
  linkedFilePath?: string | null;
  /** Leave the editor for this project's page in Manage Projects. */
  onOpenProject: () => void;
  onCancel: () => void;
  /** Delete it. Rejects with a message to show if the delete failed. */
  onConfirm: (deleteLinkedFile: boolean) => Promise<void>;
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const DeleteScriptDialog: React.FC<DeleteScriptDialogProps> = ({
  scriptTitle,
  projectName,
  source,
  pageCount,
  updatedAt,
  linkedFilePath,
  onOpenProject,
  onCancel,
  onConfirm,
}) => {
  const [typed, setTyped] = useState('');
  const [deleteFile, setDeleteFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const target = confirmTargetName(scriptTitle);
  const matched = confirmNameMatches(typed, scriptTitle);
  const isCloud = source === 'cloud';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleConfirm = async () => {
    if (!matched || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(deleteFile);
    } catch (err) {
      console.error('[delete-script] delete failed', err);
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && matched) {
      e.preventDefault();
      void handleConfirm();
    }
  };

  const meta = [
    isCloud ? 'OpenDraft Cloud' : 'This device',
    projectName,
    pageCount ? `${pageCount} page${pageCount === 1 ? '' : 's'}` : null,
    formatDate(updatedAt) ? `Modified ${formatDate(updatedAt)}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="dialog-overlay" onClick={() => { if (!busy) onCancel(); }}>
      <div
        className="dialog-box delete-script-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-script-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-header" id="delete-script-title">Delete Script</div>

        <div className="dialog-body delete-script-body">
          <div className="delete-script-card">
            <FaFileAlt className="delete-script-card-icon" aria-hidden="true" />
            <div className="delete-script-card-text">
              <span className="delete-script-card-title">{target}</span>
              <span className="delete-script-card-meta">
                {isCloud ? <FaCloud aria-hidden="true" /> : <FaDesktop aria-hidden="true" />}
                <span>{meta}</span>
              </span>
            </div>
          </div>

          <p className="delete-script-warning">
            {isCloud
              ? 'This removes the script from your OpenDraft Cloud account, on every device you use. It can’t be undone.'
              : 'This removes the script from OpenDraft. It can’t be undone.'}
          </p>

          <div className="delete-script-confirm">
            <label htmlFor="delete-script-name">
              Type <strong>{target}</strong> to confirm
            </label>
            <input
              id="delete-script-name"
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Script name"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy}
            />
            {matched ? (
              <span className="delete-script-hint delete-script-hint--ok">
                <FaCheck aria-hidden="true" /> Name matches
              </span>
            ) : typed.trim() ? (
              <span className="delete-script-hint">Doesn’t match the script name yet</span>
            ) : null}
          </div>

          {linkedFilePath && (
            <label className="delete-script-file">
              <input
                type="checkbox"
                checked={deleteFile}
                onChange={(e) => setDeleteFile(e.target.checked)}
                disabled={busy}
              />
              <span>
                Also delete <strong>{fileNameOf(linkedFilePath)}</strong> from disk. Otherwise
                the file stays where it is.
              </span>
            </label>
          )}

          <div className="delete-script-tip">
            <FaInfoCircle className="delete-script-tip-icon" aria-hidden="true" />
            <div className="delete-script-tip-text">
              <span>
                Tidying up several drafts? In <strong>Manage Projects</strong>, every script and
                project has a <strong>⋮</strong> menu with <strong>Delete</strong>, so you can
                clear out a whole project from one screen.
              </span>
              <button type="button" className="delete-script-link" onClick={onOpenProject} disabled={busy}>
                Open {projectName} in Manage Projects <FaChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>

          {error && <div className="delete-script-error" role="alert">Delete failed: {error}</div>}
        </div>

        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="dialog-danger"
            onClick={() => { void handleConfirm(); }}
            disabled={!matched || busy}
          >
            {busy ? 'Deleting…' : 'Delete Script'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteScriptDialog;
