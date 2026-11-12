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
import { ModalOverlay } from './ModalOverlay';
import { FaCheck, FaChevronRight, FaCloud, FaDesktop, FaFileAlt, FaInfoCircle } from 'react-icons/fa';
import { Trans, useTranslation } from 'react-i18next';
import { formatDate as formatDateLocale } from '../i18n/format';
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
  return formatDateLocale(d, { day: 'numeric', month: 'short', year: 'numeric' });
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
  const { t } = useTranslation(['projects', 'common']);
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
    isCloud ? 'OpenDraft Cloud' /* i18n-ignore: product name */ : t('deleteScript.thisDevice'),
    projectName,
    pageCount ? t('deleteScript.pages', { count: pageCount }) : null,
    formatDate(updatedAt) ? t('deleteScript.modified', { date: formatDate(updatedAt) }) : null,
  ].filter(Boolean).join(' · ');

  return (
    <ModalOverlay className="dialog-overlay" onClick={() => { if (!busy) onCancel(); }}>
      <div
        className="dialog-box delete-script-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-script-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="dialog-header" id="delete-script-title">{t('deleteScript.title')}</div>

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
              ? t('deleteScript.warningCloud')
              : t('deleteScript.warningLocal')}
          </p>

          <div className="delete-script-confirm">
            <label htmlFor="delete-script-name">
              <Trans ns="projects" i18nKey="deleteScript.typeToConfirm" values={{ name: target }} components={{ strong: <strong /> }} />
            </label>
            <input
              id="delete-script-name"
              ref={inputRef}
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t('deleteScript.namePlaceholder')}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy}
            />
            {matched ? (
              <span className="delete-script-hint delete-script-hint--ok">
                <FaCheck aria-hidden="true" /> {t('deleteScript.nameMatches')}
              </span>
            ) : typed.trim() ? (
              <span className="delete-script-hint">{t('deleteScript.nameMismatch')}</span>
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
                <Trans ns="projects" i18nKey="deleteScript.alsoDeleteFile" values={{ file: fileNameOf(linkedFilePath) }} components={{ strong: <strong /> }} />
              </span>
            </label>
          )}

          <div className="delete-script-tip">
            <FaInfoCircle className="delete-script-tip-icon" aria-hidden="true" />
            <div className="delete-script-tip-text">
              <span>
                <Trans ns="projects" i18nKey="deleteScript.tip" components={{ strong: <strong /> }} />
              </span>
              <button type="button" className="delete-script-link" onClick={onOpenProject} disabled={busy}>
                {t('deleteScript.openProject', { name: projectName })} <FaChevronRight aria-hidden="true" />
              </button>
            </div>
          </div>

          {error && <div className="delete-script-error" role="alert">{t('deleteScript.failed', { error })}</div>}
        </div>

        <div className="dialog-actions">
          <button type="button" onClick={onCancel} disabled={busy}>{t('common:cancel')}</button>
          <button
            type="button"
            className="dialog-danger"
            onClick={() => { void handleConfirm(); }}
            disabled={!matched || busy}
          >
            {busy ? t('deleteScript.deleting') : t('deleteScript.deleteScript')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default DeleteScriptDialog;
