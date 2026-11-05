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
import { Trans, useTranslation } from 'react-i18next';
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
import { formatNumber } from '../i18n/format';
import { showToast } from './Toast';
import Select from './Select';

const ONE_DECIMAL = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

const BackupSettingsSection: React.FC = () => {
  const { t } = useTranslation(['backup', 'common']);
  const formatBytes = (n: number): string => {
    if (n < 1024) return t('backupSettings.sizeBytes', { value: formatNumber(n) });
    if (n < 1024 * 1024) return t('backupSettings.sizeKb', { value: formatNumber(n / 1024, ONE_DECIMAL) });
    return t('backupSettings.sizeMb', { value: formatNumber(n / (1024 * 1024), ONE_DECIMAL) });
  };
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
        setFolderDetail(probe.error || t('backupSettings.folderNotFoundDetail'));
        setStats(null);
        return;
      }
      if (!probe.writable) {
        setFolderStatus('unwritable');
        setFolderDetail(probe.error || t('backupSettings.folderNotWritableDetail'));
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
  }, [supported, t]);

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
      showToast(t('folderPrompt.pickerFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    }
  }, [backupFolder, applyFolder, t]);

  const handleUseDefault = useCallback(async () => {
    try {
      const { documentDir, join } = await import('@tauri-apps/api/path');
      const dir = await join(await documentDir(), 'OpenDraft Backups');
      // Not created here — it appears when the first snapshot is written, so
      // enabling and then changing your mind leaves nothing behind.
      await applyFolder(dir, dir);
    } catch (err) {
      showToast(t('backupSettings.defaultFolderFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    }
  }, [applyFolder, t]);

  const handleCreateFolder = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('ensure_dir', { path: backupFolder });
      await refreshFolder(backupFolder);
      showToast(t('backupSettings.folderCreated'), 'success');
    } catch (err) {
      showToast(t('backupSettings.createFolderFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    }
  }, [backupFolder, refreshFolder, t]);

  const handleToggleEnabled = useCallback(async (next: boolean) => {
    if (next && !backupFolder) {
      // Enabling with nowhere to write would silently do nothing.
      await handleBrowse();
      if (!useSettingsStore.getState().backupFolder) return;
    }
    if (next && folderStatus === 'unwritable') {
      showToast(t('backupSettings.chooseWritable'), 'error');
      return;
    }
    setBackupEnabled(next);
    resumeBackups();
  }, [backupFolder, folderStatus, handleBrowse, setBackupEnabled, resumeBackups, t]);

  if (!supported) {
    return (
      <section className="settings-section">
        <h2 className="settings-section-title">{t('backupSettings.title')}</h2>
        <p className="settings-section-desc">
          <Trans ns="backup" i18nKey="backupSettings.webOnly" components={{ strong: <strong /> }} />
        </p>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{t('backupSettings.title')}</h2>
      <p className="settings-section-desc">
        <Trans ns="backup" i18nKey="backupSettings.description" components={{ strong: <strong /> }} />
      </p>

      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={backupEnabled}
            onChange={(e) => void handleToggleEnabled(e.target.checked)}
          />{' '}
          {t('backupSettings.enable')}
        </label>
      </div>

      <div className="settings-row">
        <label>{t('backupSettings.folder')}</label>
        <div className="settings-url-row">
          <input
            className="dialog-input settings-url-input"
            value={backupFolderLabel || backupFolder}
            readOnly
            placeholder={t('backupSettings.noFolder')}
          />
          <button className="dialog-btn dialog-btn-primary" onClick={() => void handleBrowse()}>
            {desktop ? t('backupSettings.browse') : t('backupSettings.chooseFolder')}
          </button>
          {desktop && (
            <button className="dialog-btn" onClick={() => void handleUseDefault()}>
              {t('backupSettings.useDefault')}
            </button>
          )}
          {canReveal && (
            <button
              className="dialog-btn"
              disabled={!backupFolder || folderStatus !== 'ok'}
              onClick={() => void revealSnapshot(backupFolder).catch(() => showToast(t('backupSettings.openFolderFailed'), 'error'))}
            >
              {t('common:open')}
            </button>
          )}
        </div>

        {!desktop && (
          <div className="settings-hint">
            {t('backupSettings.mobileHint')}
          </div>
        )}

        {folderStatus === 'ok' && stats && (
          <div className="settings-status settings-status-ok">
            {t('backupSettings.folderOk', { count: stats.count, size: formatBytes(stats.bytes) })}
          </div>
        )}
        {folderStatus === 'missing' && backupFolder && (
          <div className="settings-status settings-status-fail">
            {t('backupSettings.folderMissing', { detail: folderDetail })}{' '}
            {desktop && (
              <button className="dialog-btn" onClick={() => void handleCreateFolder()}>{t('backupSettings.createIt')}</button>
            )}
          </div>
        )}
        {folderStatus === 'unwritable' && (
          <div className="settings-status settings-status-fail">
            {t('backupSettings.folderUnwritable', { detail: folderDetail })}
          </div>
        )}
        {isUnderOneDrive(backupFolder) && (
          <div className="settings-hint settings-hint-warning">
            {t('backupSettings.oneDrive')}
          </div>
        )}
        {pausedByError && (
          <div className="settings-status settings-status-fail">
            {t('backupSettings.paused', { error: lastError })}{' '}
            <button className="dialog-btn" onClick={() => { resumeBackups(); void refreshFolder(backupFolder); }}>
              {t('backupSettings.resume')}
            </button>
          </div>
        )}
      </div>

      <div className="settings-row">
        <label>{t('backupSettings.every')}</label>
        <Select
          className="dialog-input"
          value={backupIntervalMinutes}
          onChange={(e) => setBackupIntervalMinutes(Number(e.target.value))}
        >
          {BACKUP_INTERVAL_OPTIONS.map((m) => (
            <option key={m} value={m}>{t('backupSettings.intervalMinutes', { count: m })}</option>
          ))}
        </Select>
        {!desktop && (
          <div className="settings-hint">
            {t('backupSettings.leaveHint')}
          </div>
        )}
      </div>

      <div className="settings-row">
        <label>{t('backupSettings.keep')}</label>
        <Select
          className="dialog-input"
          value={backupRetentionCount}
          onChange={(e) => setBackupRetentionCount(Number(e.target.value))}
        >
          {BACKUP_RETENTION_OPTIONS.map((n) => (
            <option key={n} value={n}>{n === 0 ? t('backupSettings.keepAll') : t('backupSettings.keepRecent', { count: n })}</option>
          ))}
        </Select>
        <div className="settings-hint">
          <Trans ns="backup" i18nKey="backupSettings.keepHint" components={{ strong: <strong /> }} />
        </div>
      </div>

      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={backupIncludeImages}
            onChange={(e) => setBackupIncludeImages(e.target.checked)}
          />{' '}
          {t('backupSettings.includeImages')}
        </label>
        <div className="settings-hint">
          {t('backupSettings.includeImagesHint')}
        </div>
      </div>

      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={backupUnsavedDocs}
            onChange={(e) => setBackupUnsavedDocs(e.target.checked)}
          />{' '}
          {t('backupSettings.unsaved')}
        </label>
      </div>
    </section>
  );
};

export default BackupSettingsSection;
