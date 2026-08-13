/**
 * Settings → Automatic Backups.
 *
 * The same controls on every platform the app runs on. Only the folder row
 * differs: the desktop knows a path, where mobile only ever shows the folder's
 * name, because the handle behind it is a bookmark or a content URI (see
 * backupService). On the web the section renders as an explanation instead —
 * nothing there can hold on to a folder across a reload.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  useSettingsStore, BACKUP_INTERVAL_OPTIONS, BACKUP_RETENTION_OPTIONS,
} from '../stores/settingsStore';
import { useBackupStatusStore } from '../stores/backupStatusStore';
import { isDesktopTauri } from '../services/platform';
import { isUnderOneDrive } from '../services/diagnostics';
import {
  probeBackupFolder, listSnapshots, revealSnapshot, pickBackupFolder,
  backupsSupported, supportsRevealBackup,
} from '../services/backupService';
import { showToast } from './Toast';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const BackupSettingsSection: React.FC = () => {
  const {
    backupEnabled, setBackupEnabled,
    backupFolder, backupFolderLabel, setBackupFolder,
    backupIntervalMinutes, setBackupIntervalMinutes,
    backupRetentionCount, setBackupRetentionCount,
    backupIncludeImages, setBackupIncludeImages,
    backupUnsavedDocs, setBackupUnsavedDocs,
  } = useSettingsStore();
  const resumeBackups = useBackupStatusStore((s) => s.resume);
  const pausedByError = useBackupStatusStore((s) => s.pausedByError);
  const lastError = useBackupStatusStore((s) => s.lastError);

  const supported = backupsSupported();
  const desktop = isDesktopTauri();
  const canReveal = supportsRevealBackup();
  const [folderStatus, setFolderStatus] = useState<'unknown' | 'ok' | 'missing' | 'unwritable'>('unknown');
  const [folderDetail, setFolderDetail] = useState('');
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null);

  /** Probe the folder and, if usable, summarise what is already in it. */
  const refreshFolder = useCallback(async (handle: string) => {
    if (!supported || !handle) {
      setFolderStatus('unknown');
      setStats(null);
      return;
    }
    try {
      const probe = await probeBackupFolder(handle);
      if (!probe.exists) {
        setFolderStatus('missing');
        setFolderDetail(probe.error || 'Folder not found');
        setStats(null);
        return;
      }
      if (!probe.writable) {
        setFolderStatus('unwritable');
        setFolderDetail(probe.error || 'Folder is not writable');
        setStats(null);
        return;
      }
      setFolderStatus('ok');
      setFolderDetail('');
      const entries = await listSnapshots();
      setStats({ count: entries.length, bytes: entries.reduce((n, e) => n + e.sizeBytes, 0) });
    } catch (err) {
      setFolderStatus('missing');
      setFolderDetail(err instanceof Error ? err.message : String(err));
      setStats(null);
    }
  }, [supported]);

  useEffect(() => { void refreshFolder(backupFolder); }, [backupFolder, refreshFolder]);

  const applyFolder = useCallback(async (handle: string, label: string) => {
    setBackupFolder(handle, label);
    // Any settings change is treated as "the user has addressed it", so a
    // scheduler that gave up starts trying again.
    resumeBackups();
    await refreshFolder(handle);
  }, [setBackupFolder, resumeBackups, refreshFolder]);

  const handleBrowse = useCallback(async () => {
    try {
      const picked = await pickBackupFolder(backupFolder);
      if (picked) await applyFolder(picked.handle, picked.label);
    } catch (err) {
      showToast(`Could not open the folder picker: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [backupFolder, applyFolder]);

  const handleUseDefault = useCallback(async () => {
    try {
      const { documentDir, join } = await import('@tauri-apps/api/path');
      const dir = await join(await documentDir(), 'OpenDraft Backups');
      // Not created here — it appears when the first snapshot is written, so
      // enabling and then changing your mind leaves nothing behind.
      await applyFolder(dir, dir);
    } catch (err) {
      showToast(`Could not resolve a default folder: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [applyFolder]);

  const handleCreateFolder = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('ensure_dir', { path: backupFolder });
      await refreshFolder(backupFolder);
      showToast('Backup folder created', 'success');
    } catch (err) {
      showToast(`Could not create the folder: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [backupFolder, refreshFolder]);

  const handleToggleEnabled = useCallback(async (next: boolean) => {
    if (next && !backupFolder) {
      // Enabling with nowhere to write would silently do nothing.
      await handleBrowse();
      if (!useSettingsStore.getState().backupFolder) return;
    }
    if (next && folderStatus === 'unwritable') {
      showToast('Choose a folder OpenDraft can write to first', 'error');
      return;
    }
    setBackupEnabled(next);
    resumeBackups();
  }, [backupFolder, folderStatus, handleBrowse, setBackupEnabled, resumeBackups]);

  if (!supported) {
    return (
      <section className="settings-section">
        <h2 className="settings-section-title">Automatic Backups</h2>
        <p className="settings-section-desc">
          Timed backups write files to a folder you choose, which needs the
          OpenDraft app — a browser tab cannot hold on to a folder. In the
          browser, use <strong>File → Export → OpenDraft (.odraft)</strong> to
          save a copy wherever you like.
        </p>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">Automatic Backups</h2>
      <p className="settings-section-desc">
        OpenDraft can save timestamped copies of your script to a folder you
        choose while you write. Each project gets its own folder inside it, and
        the first copy is written as soon as you turn this on. Backups live
        outside the app's database, so they survive even if something happens to
        it. This is separate from <strong>Version History</strong>, which stores
        checkpoints inside the database.
      </p>

      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={backupEnabled}
            onChange={(e) => void handleToggleEnabled(e.target.checked)}
          />{' '}
          Back up my work automatically
        </label>
      </div>

      <div className="settings-row">
        <label>Backup folder</label>
        <div className="settings-url-row">
          <input
            className="dialog-input settings-url-input"
            value={backupFolderLabel || backupFolder}
            readOnly
            placeholder="No folder chosen"
          />
          <button className="dialog-btn dialog-btn-primary" onClick={() => void handleBrowse()}>
            {desktop ? 'Browse…' : 'Choose Folder…'}
          </button>
          {desktop && (
            <button className="dialog-btn" onClick={() => void handleUseDefault()}>
              Use Default
            </button>
          )}
          {canReveal && (
            <button
              className="dialog-btn"
              disabled={!backupFolder || folderStatus !== 'ok'}
              onClick={() => void revealSnapshot(backupFolder).catch(() => showToast('Could not open the folder', 'error'))}
            >
              Open
            </button>
          )}
        </div>

        {!desktop && (
          <div className="settings-hint">
            Pick somewhere outside the app — a folder in Files, iCloud Drive,
            Google Drive or Dropbox — so your backups survive if OpenDraft is
            ever removed or reinstalled.
          </div>
        )}

        {folderStatus === 'ok' && stats && (
          <div className="settings-status settings-status-ok">
            Folder is writable — {stats.count} backup{stats.count === 1 ? '' : 's'}, {formatBytes(stats.bytes)}
          </div>
        )}
        {folderStatus === 'missing' && backupFolder && (
          <div className="settings-status settings-status-fail">
            Folder not found — {folderDetail}{' '}
            {desktop && (
              <button className="dialog-btn" onClick={() => void handleCreateFolder()}>Create it</button>
            )}
          </div>
        )}
        {folderStatus === 'unwritable' && (
          <div className="settings-status settings-status-fail">
            OpenDraft can't write here — {folderDetail}
          </div>
        )}
        {isUnderOneDrive(backupFolder) && (
          <div className="settings-hint settings-hint-warning">
            This folder is inside OneDrive. Cloud sync can interfere with files
            as they're written — a local folder is safer for backups.
          </div>
        )}
        {pausedByError && (
          <div className="settings-status settings-status-fail">
            Automatic backups are paused — {lastError}{' '}
            <button className="dialog-btn" onClick={() => { resumeBackups(); void refreshFolder(backupFolder); }}>
              Resume
            </button>
          </div>
        )}
      </div>

      <div className="settings-row">
        <label>Back up every</label>
        <select
          className="dialog-input"
          value={backupIntervalMinutes}
          onChange={(e) => setBackupIntervalMinutes(Number(e.target.value))}
        >
          {BACKUP_INTERVAL_OPTIONS.map((m) => (
            <option key={m} value={m}>{m} minutes</option>
          ))}
        </select>
        {!desktop && (
          <div className="settings-hint">
            A copy is also written whenever you leave OpenDraft, so work is
            saved before the system suspends the app.
          </div>
        )}
      </div>

      <div className="settings-row">
        <label>Keep</label>
        <select
          className="dialog-input"
          value={backupRetentionCount}
          onChange={(e) => setBackupRetentionCount(Number(e.target.value))}
        >
          {BACKUP_RETENTION_OPTIONS.map((n) => (
            <option key={n} value={n}>{n === 0 ? 'All backups' : `${n} most recent`}</option>
          ))}
        </select>
        <div className="settings-hint">
          Applies per script. Backups you make yourself with <strong>Back Up Now</strong> are never deleted automatically.
        </div>
      </div>

      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={backupIncludeImages}
            onChange={(e) => setBackupIncludeImages(e.target.checked)}
          />{' '}
          Include images in backups
        </label>
        <div className="settings-hint">
          Makes backups larger, but a restored script comes back complete.
          Without this, images in a restored script will be missing.
        </div>
      </div>

      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={backupUnsavedDocs}
            onChange={(e) => setBackupUnsavedDocs(e.target.checked)}
          />{' '}
          Also back up documents I haven't saved yet
        </label>
      </div>
    </section>
  );
};

export default BackupSettingsSection;
