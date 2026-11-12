/**
 * Project ▸ Storage (desktop, issue #135).
 *
 * Where a local project's scripts are kept: only in the OpenDraft library, or
 * also as files in a folder the writer chooses. From here a library project
 * can be saved to a folder, a folder project can be moved to another folder or
 * taken back into the library, and the format new script files are written in
 * can be changed.
 */
import React, { useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { FaFolder, FaDatabase } from 'react-icons/fa';
import { Trans, useTranslation } from 'react-i18next';
import type { ProjectInfo } from '../services/api';
import { api } from '../services/api';
import {
  LINKED_FILE_FORMATS, LINKED_FORMAT_LABELS, normalizeLinkedFormat,
  type LinkedFileFormat,
} from '../utils/linkedFileFormat';
import { useSettingsStore } from '../stores/settingsStore';
import { showToast } from './Toast';
import Select from './Select';

interface Props {
  project: ProjectInfo;
  onClose: () => void;
  /** The project changed (folder attached, moved or detached). */
  onProjectChanged: (project: ProjectInfo) => void;
  /** Scripts or their files changed; the list should be reloaded. */
  onScriptsChanged: () => void;
}

type StorageAction = 'save' | 'move' | 'detach' | 'check' | 'format' | 'reveal';

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ProjectStorageDialog: React.FC<Props> = ({ project, onClose, onProjectChanged, onScriptsChanged }) => {
  const { t } = useTranslation(['projects', 'common']);
  const folder = typeof project.properties.folder_path === 'string' && project.properties.folder_path.trim()
    ? project.properties.folder_path
    : null;
  const defaultFileFormat = useSettingsStore((s) => s.defaultFileFormat);
  const [format, setFormat] = useState<LinkedFileFormat>(
    normalizeLinkedFormat(project.properties.file_format ?? defaultFileFormat),
  );
  const [busy, setBusy] = useState<StorageAction | null>(null);
  const [confirmDetach, setConfirmDetach] = useState(false);

  /** What is happening, for the progress line. */
  const busyText = (action: StorageAction): string => {
    switch (action) {
      case 'save': return t('storage.busy.save');
      case 'move': return t('storage.busy.move');
      case 'detach': return t('storage.busy.detach');
      case 'check': return t('storage.busy.check');
      case 'format': return t('storage.busy.format');
      case 'reveal': return t('storage.busy.reveal');
    }
  };

  /** The toast when an action fails. */
  const failedText = (action: StorageAction, error: string): string => {
    switch (action) {
      case 'save': return t('storage.failed.save', { error });
      case 'move': return t('storage.failed.move', { error });
      case 'detach': return t('storage.failed.detach', { error });
      case 'check': return t('storage.failed.check', { error });
      case 'format': return t('storage.failed.format', { error });
      case 'reveal': return t('storage.failed.reveal', { error });
    }
  };

  const run = async (action: StorageAction, work: () => Promise<void>) => {
    setBusy(action);
    try {
      await work();
    } catch (err) {
      console.error(`[storage] ${action} failed:`, err);
      showToast(failedText(action, message(err)), 'error');
    } finally {
      setBusy(null);
    }
  };

  const refreshProject = async () => {
    onProjectChanged(await api.getProject(project.id));
    onScriptsChanged();
  };

  const saveToFolder = () => run('save', async () => {
    const lf = await import('../services/linkedFiles');
    const picked = await lf.pickFolder(
      t('storage.pickFolderFor', { name: project.name }),
      lf.defaultFolderFor(project.name) ?? undefined,
    );
    if (!picked) return;
    const scan = await lf.attachProjectFolder(project.id, picked, format);
    await refreshProject();
    showToast(
      scan.added > 0
        ? t('storage.savedToFolderWithFiles', { name: project.name, folder: lf.basenameOf(picked), count: scan.added })
        : t('storage.savedToFolder', { name: project.name, folder: lf.basenameOf(picked) }),
      'success',
    );
  });

  const moveFolder = () => run('move', async () => {
    const lf = await import('../services/linkedFiles');
    const picked = await lf.pickFolder(t('storage.pickMoveTo', { name: project.name }), folder ?? undefined);
    if (!picked) return;
    const { moved, failed } = await lf.moveProjectFolder(project.id, picked);
    await refreshProject();
    if (failed.length > 0) {
      showToast(t('storage.movedWithFailures', { count: moved, failed: failed.join(', ') }), 'error');
    } else {
      showToast(t('storage.moved', { count: moved, folder: lf.basenameOf(picked) }), 'success');
    }
  });

  const detach = () => run('detach', async () => {
    const lf = await import('../services/linkedFiles');
    await lf.detachProjectFolder(project.id);
    setConfirmDetach(false);
    await refreshProject();
    showToast(t('storage.detached', { name: project.name }), 'success');
  });

  const rescan = () => run('check', async () => {
    const lf = await import('../services/linkedFiles');
    const scan = await lf.scanProjectFolder(project.id);
    onScriptsChanged();
    const parts: string[] = [];
    if (scan.added) parts.push(t('storage.scan.added', { count: scan.added }));
    if (scan.missing) parts.push(t('storage.scan.missing', { count: scan.missing }));
    if (scan.failed.length) parts.push(t('storage.scan.failed', { files: scan.failed.join(', ') }));
    showToast(parts.length ? t('storage.scan.summary', { parts: parts.join('; ') }) : t('storage.scan.match'), parts.length ? 'info' : 'success');
  });

  const changeFormat = (next: LinkedFileFormat) => {
    setFormat(next);
    if (!folder) return;
    void run('format', async () => {
      const lf = await import('../services/linkedFiles');
      onProjectChanged(await lf.setProjectFileFormat(project.id, next));
    });
  };

  const reveal = () => run('reveal', async () => {
    if (!folder) return;
    const lf = await import('../services/linkedFiles');
    await lf.revealPath(folder);
  });

  return (
    <ModalOverlay className="dialog-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 560 }}>
        <div className="dialog-header">{t('storage.title', { name: project.name })}</div>
        <div className="dialog-body">
          {folder ? (
            <>
              <p style={{ margin: '0 0 8px', fontSize: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <FaFolder style={{ flexShrink: 0, marginTop: 3 }} />
                <span>
                  <Trans
                    ns="projects"
                    i18nKey="storage.folderInfo"
                    values={{ folder }}
                    components={{ strong: <strong style={{ wordBreak: 'break-all' }} /> }}
                  />
                </span>
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 14px' }}>
                <button className="dialog-btn" disabled={!!busy} onClick={() => void reveal()}>{t('storage.showInFolder')}</button>
                <button className="dialog-btn" disabled={!!busy} onClick={() => void rescan()}>{t('storage.checkNewFiles')}</button>
                <button className="dialog-btn" disabled={!!busy} onClick={() => void moveFolder()}>{t('storage.moveFolder')}</button>
                <button className="dialog-btn" disabled={!!busy} onClick={() => setConfirmDetach(true)}>{t('storage.detachAsk')}</button>
              </div>
              {confirmDetach && (
                <div className="settings-hint settings-hint-warning" style={{ marginBottom: 12 }}>
                  {t('storage.detachWarning')}{' '}
                  <button className="dialog-btn" disabled={!!busy} onClick={() => void detach()}>{t('storage.detachConfirm')}</button>{' '}
                  <button className="dialog-btn" disabled={!!busy} onClick={() => setConfirmDetach(false)}>{t('common:cancel')}</button>
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 8px', fontSize: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <FaDatabase style={{ flexShrink: 0, marginTop: 3 }} />
                <span>
                  {t('storage.libraryInfo')}
                </span>
              </p>
              <div style={{ margin: '8px 0 14px' }}>
                <button className="dialog-btn dialog-btn-primary" disabled={!!busy} onClick={() => void saveToFolder()}>
                  {t('storage.saveToFolder')}
                </button>
              </div>
            </>
          )}

          <div className="dialog-row">
            <label>{t('storage.saveScriptsAs')}</label>
            <Select
              className="dialog-input"
              value={format}
              disabled={!!busy}
              onChange={(e) => changeFormat(normalizeLinkedFormat(e.target.value))}
            >
              {LINKED_FILE_FORMATS.map((f) => (
                <option key={f} value={f}>{f === 'odraft' ? t('storage.formatOdraft') : LINKED_FORMAT_LABELS[f]}</option>
              ))}
            </Select>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fd-text-muted)' }}>
            {folder
              ? t('storage.formatHintFolder')
              : t('storage.formatHintLibrary')}
            {' '}{t('storage.treatmentsHint')}
          </p>
          {busy && <p style={{ margin: '10px 0 0', fontSize: 13 }}>{t('storage.progress', { action: busyText(busy) })}</p>}
        </div>
        <div className="dialog-actions">
          <button disabled={!!busy} onClick={onClose}>{t('common:close')}</button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default ProjectStorageDialog;
