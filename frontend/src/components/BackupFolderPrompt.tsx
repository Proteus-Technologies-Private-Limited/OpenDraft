/**
 * File ▸ Backups with no backup folder chosen yet.
 *
 * Back Up Now used to answer that with a toast and a jump to Settings, which
 * left the editor and opened Settings at the top — easy to read as "the menu
 * item just opens Settings". This asks for the folder where the writer is, then
 * carries on with what they asked for.
 */
import React, { useState } from 'react';
import { pickBackupFolder } from '../services/backupService';
import { isDesktopTauri } from '../services/platform';
import { useSettingsStore } from '../stores/settingsStore';
import { useBackupStatusStore } from '../stores/backupStatusStore';
import { showToast } from './Toast';

interface Props {
  /** What happens once the folder is chosen, said in the dialog. */
  then: 'backup' | 'open';
  onClose: () => void;
  /** The folder is set; run the original action. */
  onFolderChosen: () => void;
}

const BackupFolderPrompt: React.FC<Props> = ({ then, onClose, onFolderChosen }) => {
  const [busy, setBusy] = useState(false);
  const desktop = isDesktopTauri();

  const apply = (handle: string, label: string) => {
    useSettingsStore.getState().setBackupFolder(handle, label);
    // A folder change counts as the writer dealing with any earlier failure.
    useBackupStatusStore.getState().resume();
    onClose();
    onFolderChosen();
  };

  const choose = async () => {
    setBusy(true);
    try {
      const picked = await pickBackupFolder(useSettingsStore.getState().backupFolder || undefined);
      if (picked) apply(picked.handle, picked.label);
    } catch (err) {
      console.error('[backup] folder picker failed:', err);
      showToast(`Could not open the folder picker: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  // Desktop only: the same default Settings offers. It is created by the first
  // backup written into it.
  const chooseDocumentsFolder = async () => {
    setBusy(true);
    try {
      const { documentDir, join } = await import('@tauri-apps/api/path');
      const dir = await join(await documentDir(), 'OpenDraft Backups');
      apply(dir, dir);
    } catch (err) {
      console.error('[backup] could not resolve the Documents folder:', err);
      showToast(`Could not find your Documents folder: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="dialog-box" role="dialog" aria-modal="true" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">Choose a Backup Folder</div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 10px', fontSize: 14 }}>
            Backups are dated copies of your script, kept in a folder outside
            OpenDraft — so they survive whatever happens to the app. Choose where
            they go{then === 'backup' ? ' and this script is backed up straight away' : ''}.
            You can change the folder later in Settings ▸ Backups.
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--fd-text-muted)' }}>
            To have OpenDraft also back up on its own while you write, turn on
            automatic backups in Settings ▸ Backups.
          </p>
          {busy && <p style={{ margin: '10px 0 0', fontSize: 13 }}>Waiting for a folder…</p>}
        </div>
        <div className="dialog-actions">
          <button disabled={busy} onClick={onClose}>Cancel</button>
          {desktop && (
            <button disabled={busy} onClick={() => void chooseDocumentsFolder()} title="Documents/OpenDraft Backups">
              Use Documents Folder
            </button>
          )}
          <button className="dialog-primary" disabled={busy} onClick={() => void choose()}>
            Choose Folder…
          </button>
        </div>
      </div>
    </div>
  );
};

export default BackupFolderPrompt;
