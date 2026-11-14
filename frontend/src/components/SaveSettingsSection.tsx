/**
 * Settings → Saving.
 *
 * Whether OpenDraft saves on its own, and how often; and, on the desktop,
 * where new projects are kept (issue #135). Library scripts and files on disk
 * are switched separately: one is the app's own copy, the other is the
 * writer's file, which an auto-save rewrites in whatever format it is in.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useSettingsStore, AUTO_SAVE_INTERVAL_OPTIONS } from '../stores/settingsStore';
import { supportsOpenInPlace } from '../utils/fileOps';
import { isDesktopTauri } from '../services/platform';
import { isUnderOneDrive } from '../services/diagnostics';
import {
  LINKED_FILE_FORMATS, LINKED_FORMAT_LABELS, normalizeLinkedFormat,
} from '../utils/linkedFileFormat';
import { showToast } from './Toast';
import Select from './Select';

type FolderStatus = 'unknown' | 'ok' | 'missing' | 'unwritable';

const SaveSettingsSection: React.FC = () => {
  const { t } = useTranslation(['settings', 'common']);
  const formatInterval = (seconds: number): string => {
    if (seconds < 60) return t('saving.intervalSeconds', { count: seconds });
    return t('saving.intervalMinutes', { count: seconds / 60 });
  };
  const {
    autoSaveLibrary, setAutoSaveLibrary,
    autoSaveFiles, setAutoSaveFiles,
    autoSaveIntervalSeconds, setAutoSaveIntervalSeconds,
    defaultProjectFolder, setDefaultProjectFolder,
    defaultFileFormat, setDefaultFileFormat,
  } = useSettingsStore();

  const filesSupported = supportsOpenInPlace();
  const desktop = isDesktopTauri();
  const fileMenuLabel = desktop ? t('saving.menuOpenFileFromDisk') : t('saving.menuOpenFromFiles');

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
      if (!probe.exists) { setFolderStatus('missing'); setFolderDetail(probe.error || t('saving.folderNotFoundDetail')); return; }
      if (!probe.writable) { setFolderStatus('unwritable'); setFolderDetail(probe.error || t('saving.folderNotWritableDetail')); return; }
      setFolderStatus('ok');
      setFolderDetail('');
    } catch (err) {
      setFolderStatus('missing');
      setFolderDetail(err instanceof Error ? err.message : String(err));
    }
  }, [desktop, t]);

  useEffect(() => { void probeFolder(defaultProjectFolder); }, [defaultProjectFolder, probeFolder]);

  const chooseFolder = useCallback(async (): Promise<boolean> => {
    try {
      const { pickFolder } = await import('../services/linkedFiles');
      const picked = await pickFolder(t('saving.pickerTitle'), defaultProjectFolder || undefined);
      if (!picked) return false;
      setDefaultProjectFolder(picked);
      return true;
    } catch (err) {
      showToast(t('saving.pickerFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
      return false;
    }
  }, [defaultProjectFolder, setDefaultProjectFolder, t]);

  const createFolder = useCallback(async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('ensure_dir', { path: defaultProjectFolder });
      await probeFolder(defaultProjectFolder);
    } catch (err) {
      showToast(t('saving.createFolderFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    }
  }, [defaultProjectFolder, probeFolder, t]);

  const revealFolder = useCallback(async () => {
    try {
      const { revealPath } = await import('../services/linkedFiles');
      await revealPath(defaultProjectFolder);
    } catch {
      showToast(t('saving.openFolderFailed'), 'error');
    }
  }, [defaultProjectFolder, t]);

  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{t('saving.title')}</h2>
      <p className="settings-section-desc">
        <Trans ns="settings" i18nKey="saving.description" components={{ strong: <strong /> }} />
      </p>

      <div className="settings-row">
        <label>
          <input
            type="checkbox"
            checked={autoSaveLibrary}
            onChange={(e) => setAutoSaveLibrary(e.target.checked)}
          />{' '}
          {t('saving.library')}
        </label>
        {desktop && (
          <div className="settings-hint">
            {t('saving.libraryHint')}
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
            {t('saving.files', { menu: fileMenuLabel })}
          </label>
          <div className="settings-hint">
            {t('saving.filesHint')}
          </div>
        </div>
      )}

      <div className="settings-row">
        <label htmlFor="settings-save-interval">{t('saving.every')}</label>
        <Select
          id="settings-save-interval"
          className="dialog-input"
          value={autoSaveIntervalSeconds}
          disabled={!autoSaveLibrary && !(filesSupported && autoSaveFiles)}
          onChange={(e) => setAutoSaveIntervalSeconds(Number(e.target.value))}
        >
          {intervalOptions.map((sec) => (
            <option key={sec} value={sec}>{formatInterval(sec)}</option>
          ))}
        </Select>
      </div>

      {desktop && (
        <>
          <h3 className="settings-subsection-title" style={{ margin: '18px 0 6px', fontSize: 14 }}>{t('saving.projectFolders')}</h3>
          <p className="settings-section-desc">
            {t('saving.projectFoldersDesc')}
          </p>

          <div className="settings-row">
            <label>{t('saving.newProjectsIn')}</label>
            <Select
              className="dialog-input"
              value={defaultProjectFolder ? 'folder' : 'library'}
              onChange={async (e) => {
                if (e.target.value === 'library') setDefaultProjectFolder('');
                else await chooseFolder();
              }}
            >
              <option value="library">{t('saving.optionLibrary')}</option>
              <option value="folder">{t('saving.optionFolder')}</option>
            </Select>
            <div className="settings-hint">
              {t('saving.newProjectsHint')}
            </div>
          </div>

          {defaultProjectFolder && (
            <div className="settings-row">
              <label>{t('saving.projectsFolder')}</label>
              <div className="settings-url-row">
                <input className="dialog-input settings-url-input" value={defaultProjectFolder} readOnly />
                <button className="dialog-btn dialog-btn-primary" onClick={() => void chooseFolder()}>{t('saving.browse')}</button>
                <button className="dialog-btn" disabled={folderStatus !== 'ok'} onClick={() => void revealFolder()}>{t('common:open')}</button>
              </div>
              <div className="settings-hint">{t('saving.projectsFolderHint')}</div>
              {folderStatus === 'missing' && (
                <div className="settings-status settings-status-fail">
                  {t('saving.folderMissing', { detail: folderDetail })}{' '}
                  <button className="dialog-btn" onClick={() => void createFolder()}>{t('saving.createIt')}</button>
                </div>
              )}
              {folderStatus === 'unwritable' && (
                <div className="settings-status settings-status-fail">{t('saving.folderUnwritable', { detail: folderDetail })}</div>
              )}
              {isUnderOneDrive(defaultProjectFolder) && (
                <div className="settings-hint settings-hint-warning">
                  {t('saving.oneDrive')}
                </div>
              )}
            </div>
          )}

          <div className="settings-row">
            <label>{t('saving.fileFormat')}</label>
            <Select
              className="dialog-input"
              value={normalizeLinkedFormat(defaultFileFormat)}
              onChange={(e) => setDefaultFileFormat(e.target.value)}
            >
              {LINKED_FILE_FORMATS.map((f) => (
                <option key={f} value={f}>{LINKED_FORMAT_LABELS[f]}</option>
              ))}
            </Select>
            <div className="settings-hint">
              {t('saving.fileFormatHint')}
            </div>
          </div>
        </>
      )}
    </section>
  );
};

export default SaveSettingsSection;
