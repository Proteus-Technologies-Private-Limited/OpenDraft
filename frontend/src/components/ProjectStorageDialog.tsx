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
import { FaFolder, FaDatabase } from 'react-icons/fa';
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

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ProjectStorageDialog: React.FC<Props> = ({ project, onClose, onProjectChanged, onScriptsChanged }) => {
  const folder = typeof project.properties.folder_path === 'string' && project.properties.folder_path.trim()
    ? project.properties.folder_path
    : null;
  const defaultFileFormat = useSettingsStore((s) => s.defaultFileFormat);
  const [format, setFormat] = useState<LinkedFileFormat>(
    normalizeLinkedFormat(project.properties.file_format ?? defaultFileFormat),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDetach, setConfirmDetach] = useState(false);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    try {
      await work();
    } catch (err) {
      console.error(`[storage] ${label} failed:`, err);
      showToast(`${label} failed: ${message(err)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const refreshProject = async () => {
    onProjectChanged(await api.getProject(project.id));
    onScriptsChanged();
  };

  const saveToFolder = () => run('Saving to the folder', async () => {
    const lf = await import('../services/linkedFiles');
    const picked = await lf.pickFolder(
      `Folder for ${project.name}`,
      lf.defaultFolderFor(project.name) ?? undefined,
    );
    if (!picked) return;
    const scan = await lf.attachProjectFolder(project.id, picked, format);
    await refreshProject();
    showToast(
      scan.added > 0
        ? `${project.name} is now saved to ${lf.basenameOf(picked)}. ${scan.added} file${scan.added === 1 ? '' : 's'} already there joined the project.`
        : `${project.name} is now saved to ${lf.basenameOf(picked)}.`,
      'success',
    );
  });

  const moveFolder = () => run('Moving the project', async () => {
    const lf = await import('../services/linkedFiles');
    const picked = await lf.pickFolder(`Move ${project.name} to`, folder ?? undefined);
    if (!picked) return;
    const { moved, failed } = await lf.moveProjectFolder(project.id, picked);
    await refreshProject();
    if (failed.length > 0) {
      showToast(`Moved ${moved} file${moved === 1 ? '' : 's'}; ${failed.join(', ')} could not be written there and stayed where they were.`, 'error');
    } else {
      showToast(`Moved ${moved} file${moved === 1 ? '' : 's'} to ${lf.basenameOf(picked)}.`, 'success');
    }
  });

  const detach = () => run('Moving the project to the library', async () => {
    const lf = await import('../services/linkedFiles');
    await lf.detachProjectFolder(project.id);
    setConfirmDetach(false);
    await refreshProject();
    showToast(`${project.name} is now saved in the OpenDraft library only. Its files are still in the folder.`, 'success');
  });

  const rescan = () => run('Checking the folder', async () => {
    const lf = await import('../services/linkedFiles');
    const scan = await lf.scanProjectFolder(project.id);
    onScriptsChanged();
    const parts: string[] = [];
    if (scan.added) parts.push(`${scan.added} new file${scan.added === 1 ? '' : 's'} added`);
    if (scan.missing) parts.push(`${scan.missing} file${scan.missing === 1 ? ' is' : 's are'} missing`);
    if (scan.failed.length) parts.push(`could not read ${scan.failed.join(', ')}`);
    showToast(parts.length ? `${parts.join('; ')}.` : 'The folder and the project match.', parts.length ? 'info' : 'success');
  });

  const changeFormat = (next: LinkedFileFormat) => {
    setFormat(next);
    if (!folder) return;
    void run('Changing the file format', async () => {
      const lf = await import('../services/linkedFiles');
      onProjectChanged(await lf.setProjectFileFormat(project.id, next));
    });
  };

  const reveal = () => run('Opening the folder', async () => {
    if (!folder) return;
    const lf = await import('../services/linkedFiles');
    await lf.revealPath(folder);
  });

  return (
    <div className="dialog-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 560 }}>
        <div className="dialog-header">Storage — {project.name}</div>
        <div className="dialog-body">
          {folder ? (
            <>
              <p style={{ margin: '0 0 8px', fontSize: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <FaFolder style={{ flexShrink: 0, marginTop: 3 }} />
                <span>
                  Each script is saved as a file in{' '}
                  <strong style={{ wordBreak: 'break-all' }}>{folder}</strong>. OpenDraft
                  also keeps a working copy for versions, notes and images.
                </span>
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 14px' }}>
                <button className="dialog-btn" disabled={!!busy} onClick={() => void reveal()}>Show in Folder</button>
                <button className="dialog-btn" disabled={!!busy} onClick={() => void rescan()}>Check for New Files</button>
                <button className="dialog-btn" disabled={!!busy} onClick={() => void moveFolder()}>Move to Another Folder…</button>
                <button className="dialog-btn" disabled={!!busy} onClick={() => setConfirmDetach(true)}>Save in Library Only…</button>
              </div>
              {confirmDetach && (
                <div className="settings-hint settings-hint-warning" style={{ marginBottom: 12 }}>
                  Scripts will stop being saved to the folder. The files already
                  there are left as they are.{' '}
                  <button className="dialog-btn" disabled={!!busy} onClick={() => void detach()}>Save in Library Only</button>{' '}
                  <button className="dialog-btn" disabled={!!busy} onClick={() => setConfirmDetach(false)}>Cancel</button>
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ margin: '0 0 8px', fontSize: 14, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <FaDatabase style={{ flexShrink: 0, marginTop: 3 }} />
                <span>
                  This project is saved in the OpenDraft library on this computer.
                  Save it to a folder — a RAID, a network drive, a folder you
                  already use — and each script is kept there as its own file,
                  always up to date.
                </span>
              </p>
              <div style={{ margin: '8px 0 14px' }}>
                <button className="dialog-btn dialog-btn-primary" disabled={!!busy} onClick={() => void saveToFolder()}>
                  Save to a Folder…
                </button>
              </div>
            </>
          )}

          <div className="dialog-row">
            <label>Save scripts as:</label>
            <Select
              className="dialog-input"
              value={format}
              disabled={!!busy}
              onChange={(e) => changeFormat(normalizeLinkedFormat(e.target.value))}
            >
              {LINKED_FILE_FORMATS.map((f) => (
                <option key={f} value={f}>{LINKED_FORMAT_LABELS[f]}</option>
              ))}
            </Select>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--fd-text-muted)' }}>
            {folder
              ? 'Applies to scripts added from now on; existing files keep their format.'
              : 'The format each script is written in when the project is saved to a folder.'}
            {' '}Treatments are always saved as .odraft.
          </p>
          {busy && <p style={{ margin: '10px 0 0', fontSize: 13 }}>{busy}…</p>}
        </div>
        <div className="dialog-actions">
          <button disabled={!!busy} onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default ProjectStorageDialog;
