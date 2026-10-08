/**
 * Settings → Saving.
 *
 * Whether OpenDraft saves on its own, and how often; and, on the desktop,
 * where new projects are kept (issue #135). Library scripts and files on disk
 * are switched separately: one is the app's own copy, the other is the
 * writer's file, which an auto-save rewrites in whatever format it is in.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useSettingsStore, AUTO_SAVE_INTERVAL_OPTIONS } from '../stores/settingsStore';
import { supportsOpenInPlace } from '../utils/fileOps';
import { isDesktopTauri } from '../services/platform';
import { isUnderOneDrive } from '../services/diagnostics';
import {
  LINKED_FILE_FORMATS, LINKED_FORMAT_LABELS, normalizeLinkedFormat,
} from '../utils/linkedFileFormat';
import { showToast } from './Toast';

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

type FolderStatus = 'unknown' | 'ok' | 'missing' | 'unwritable';

const SaveSettingsSection: React.FC = () => {
  const {
    autoSaveLibrary, setAutoSaveLibrary,
    autoSaveFiles, setAutoSaveFiles,
    autoSaveIntervalSeconds, setAutoSaveIntervalSeconds,
    defaultProjectFolder, setDefaultProjectFolder,
    defaultFileFormat, setDefaultFileFormat,
  } = useSettingsStore();

  const filesSupported = supportsOpenInPlace();
  const desktop = isDesktopTauri();
  const fileMenuLabel = desktop ? 'Open File from Disk' : 'Open from Files';

  // A value set by hand (or by an older build) that is not one of the options
  // is still shown, so the select never claims a different interval than the
  // one in effect.
  const intervalOptions: number[] = (AUTO_SAVE_INTERVAL_OPTIONS as readonly number[]).includes(autoSaveIntervalSeconds)
    ? [...AUTO_SAVE_INTERVAL_OPTIONS]
    : [...AUTO_SAVE_INTERVAL_OPTIONS, autoSaveIntervalSeconds].sort((a, b) => a - b);

  // ── Projects folder (desktop) ──
  const [folderStatus, setFolderStatus] = useState<FolderStatus>('unknown');
  const [folderDetail, setFolderDetail] = useState('');

  const probeFolder = useCallback(async (path: string) => {
    if (!desktop || !path) { setFolderStatus('unknown'); return; }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const probe = await invoke<{ exists: boolean; writable: boolean; error?: string | null }>('probe_directory', { path });
      if (!probe.exists) { setFolderStatus('missing'); setFolderDetail(probe.error || 'Folder not found'); return; }
      if (!probe.writable) { setFolderStatus('unwritable'); setFolderDetail(probe.error || 'Folder is not writable'); return; }
      setFolderStatus('ok');
      setFolderDetail('');
    } catch (err) {
      setFolderStatus('missing');
      setFolderDetail(err instanceof Error ? err.message : String(err));
    }
  }, [desktop]);

  useEffect(() => { void probeFolder(defaultProjectFolder); }, [defaultProjectFolder, probeFolder]);

  const chooseFolder = useCallback(async (): Promise<boolean> => {
    try {
      const { pickFolder } = await import('../services/linkedFiles');
      const picked = await pickFolder('Folder for new projects', defaultProjectFolder || undefined);
      if (!picked) return false;
      setDefaultProjectFolder(picked);
      return true;
    } catch (err) {
      showToast(`Could not open the folder picker: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return false;
    }
  }, [defaultProjectFolder, setDefaultProjectFolder]);

  const createFolder = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('ensure_dir', { path: defaultProjectFolder });
      await probeFolder(defaultProjectFolder);
    } catch (err) {
      showToast(`Could not create the folder: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [defaultProjectFolder, probeFolder]);

  const revealFolder = useCallback(async () => {
    try {
      const { revealPath } = await import('../services/linkedFiles');
      await revealPath(defaultProjectFolder);
    } catch {
      showToast('Could not open the folder', 'error');
    }
  }, [defaultProjectFolder]);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Saving</h2>
      <p className="settings-section-desc">
        Choose whether OpenDraft saves your work on its own. With auto-save off,
        nothing is written until you choose <strong>Save</strong>. OpenDraft asks
        before you close a script, open another one or close the window. A
        recovery copy is still kept in case the app quits unexpectedly.
      </p>

      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={autoSaveLibrary}
            onChange={(e) => setAutoSaveLibrary(e.target.checked)}
          />{' '}
          Auto-save scripts in my OpenDraft library
        </label>
        {desktop && (
          <div className="settings-hint">
            Including scripts saved to a project folder or with Save to File
            As — each save updates their file too.
          </div>
        )}
      </div>

      {filesSupported && (
        <div className="settings-row">
          <label>
            <input
              type="checkbox"
              checked={autoSaveFiles}
              onChange={(e) => setAutoSaveFiles(e.target.checked)}
            />{' '}
            Auto-save files opened with {fileMenuLabel}
          </label>
          <div className="settings-hint">
            Each save writes over the original file. A Final Draft or Fountain file can
            only keep what its format supports, so notes and other
            OpenDraft-only details are not saved into it.
          </div>
        </div>
      )}

      <div className="settings-row">
        <label>Auto-save every</label>
        <select
          className="dialog-input"
          value={autoSaveIntervalSeconds}
          disabled={!autoSaveLibrary && !(filesSupported && autoSaveFiles)}
          onChange={(e) => setAutoSaveIntervalSeconds(Number(e.target.value))}
        >
          {intervalOptions.map((sec) => (
            <option key={sec} value={sec}>{formatInterval(sec)}</option>
          ))}
        </select>
      </div>

      {desktop && (
        <>
          <h3 className="settings-subsection-title" style={{ margin: '18px 0 6px', fontSize: 14 }}>Project folders</h3>
          <p className="settings-section-desc">
            A project can be kept in a folder on disk — a RAID, a network drive,
            a folder you already use. Each script is saved there as its own
            file, so the latest version is always in that folder. OpenDraft
            keeps a working copy too, for versions, notes and images.
          </p>

          <div className="settings-row">
            <label>New projects are saved in</label>
            <select
              className="dialog-input"
              value={defaultProjectFolder ? 'folder' : 'library'}
              onChange={async (e) => {
                if (e.target.value === 'library') setDefaultProjectFolder('');
                else await chooseFolder();
              }}
            >
              <option value="library">The OpenDraft library</option>
              <option value="folder">A folder on disk</option>
            </select>
            <div className="settings-hint">
              You can still choose for each project when you create it.
            </div>
          </div>

          {defaultProjectFolder && (
            <div className="settings-row">
              <label>Projects folder</label>
              <div className="settings-url-row">
                <input className="dialog-input settings-url-input" value={defaultProjectFolder} readOnly />
                <button className="dialog-btn dialog-btn-primary" onClick={() => void chooseFolder()}>Browse…</button>
                <button className="dialog-btn" disabled={folderStatus !== 'ok'} onClick={() => void revealFolder()}>Open</button>
              </div>
              <div className="settings-hint">Each new project gets a folder of its own inside this one.</div>
              {folderStatus === 'missing' && (
                <div className="settings-status settings-status-fail">
                  Folder not found — {folderDetail}{' '}
                  <button className="dialog-btn" onClick={() => void createFolder()}>Create it</button>
                </div>
              )}
              {folderStatus === 'unwritable' && (
                <div className="settings-status settings-status-fail">OpenDraft can&apos;t write here — {folderDetail}</div>
              )}
              {isUnderOneDrive(defaultProjectFolder) && (
                <div className="settings-hint settings-hint-warning">
                  This folder is inside OneDrive. That works, but if a script is
                  edited on two computers before OneDrive syncs, OpenDraft will
                  ask which version to keep.
                </div>
              )}
            </div>
          )}

          <div className="settings-row">
            <label>Save scripts in folders as</label>
            <select
              className="dialog-input"
              value={normalizeLinkedFormat(defaultFileFormat)}
              onChange={(e) => setDefaultFileFormat(e.target.value)}
            >
              {LINKED_FILE_FORMATS.map((f) => (
                <option key={f} value={f}>{LINKED_FORMAT_LABELS[f]}</option>
              ))}
            </select>
            <div className="settings-hint">
              .odraft keeps everything. Final Draft and Fountain files open in
              other apps, but notes, tags and other OpenDraft-only details are
              kept only in OpenDraft&apos;s working copy. Treatments are always saved
              as .odraft.
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default SaveSettingsSection;
