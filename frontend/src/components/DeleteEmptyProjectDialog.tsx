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
import { Trans, useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('projects');
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
    ? t('deleteEmpty.historyWithCount', { count: versionCount })
    : t('deleteEmpty.history');

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
        <div className="dialog-header" id="delete-empty-project-title">{t('deleteEmpty.title')}</div>

        <div className="dialog-body delete-script-body">
          {deletedScriptTitle && (
            <span className="delete-script-hint delete-script-hint--ok delete-empty-done">
              <FaCheck aria-hidden="true" /> <span><Trans ns="projects" i18nKey="deleteEmpty.scriptDeleted" values={{ title: deletedScriptTitle }} components={{ strong: <strong /> }} /></span>
            </span>
          )}

          <p className="delete-script-warning">
            <Trans ns="projects" i18nKey="deleteEmpty.noScriptsLeft" values={{ name: projectName }} components={{ strong: <strong /> }} />
          </p>

          <div className="delete-script-card delete-empty-list">
            <span className="delete-script-card-meta">{t('deleteEmpty.alsoRemoves')}</span>
            <ul>
              <li>{t('deleteEmpty.assets')}</li>
              <li>{history}</li>
              <li>{t('deleteEmpty.propertiesAndLog')}</li>
            </ul>
          </div>

          <p className="delete-empty-note">
            {source === 'cloud'
              ? t('deleteEmpty.undoneCloud')
              : t('deleteEmpty.undoneLocal')}
            {folderPath ? ` ${t('deleteEmpty.filesStay', { path: folderPath })}` : ''}
            {' '}{t('deleteEmpty.keepHint')}
          </p>

          {error && <div className="delete-script-error" role="alert">{t('deleteEmpty.failed', { error })}</div>}
        </div>

        <div className="dialog-actions">
          <button type="button" className="dialog-danger-outline" onClick={() => { void handleDelete(); }} disabled={busy}>
            {busy ? t('deleteEmpty.deleting') : t('deleteEmpty.deleteProject')}
          </button>
          <button type="button" ref={keepRef} className="dialog-primary" onClick={onKeep} disabled={busy}>
            {t('deleteEmpty.keepProject')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeleteEmptyProjectDialog;
