import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { saveFile } from '../utils/fileOps';
interface Entry {
  name: string;
  size: number;
}
/** Raw source bytes, never an imported/reserialized document. */
export default function SourceBackupRecovery({ onClose }: { onClose(): void }) {
  const { t } = useTranslation(['backup', 'common']);
  const dialog = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    invoke<Entry[]>('list_source_backups')
      .then(setEntries)
      .catch((e) => setError(String(e)));
  }, []);
  async function recover(entry: Entry) {
    setBusy(true);
    setError('');
    try {
      const bytes = await invoke<number[]>('read_source_backup', {
        name: entry.name,
      });
      await saveFile(new Uint8Array(bytes), entry.name);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="external-save-review"
      aria-labelledby="source-backup-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <h2 id="source-backup-title">{t('sourceRecovery.title')}</h2>
      <p>{t('sourceRecovery.intro')}</p>
      {error && <p role="alert">{error}</p>}
      {!entries.length && (
        <p>{t('sourceRecovery.empty')}</p>
      )}
      <ul>
        {entries.map((entry) => (
          <li key={entry.name}>
            <button disabled={busy} onClick={() => void recover(entry)}>
              {t('sourceRecovery.entry', { name: entry.name, size: entry.size })}
            </button>
          </li>
        ))}
      </ul>
      <button disabled={busy} onClick={onClose}>
        {t('common:close')}
      </button>
    </dialog>
  );
}
