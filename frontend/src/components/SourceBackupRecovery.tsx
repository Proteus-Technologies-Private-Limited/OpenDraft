import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { saveFile } from '../utils/fileOps';
import { formatDateTime } from '../i18n/format';
interface Entry {
  name: string;
  size: number;
  originalName?: string;
  sourcePath?: string | null;
  modifiedAt?: number;
}
/** Raw source bytes, never an imported/reserialized document. */
export default function SourceBackupRecovery({ onClose }: { onClose(): void }) {
  const { t } = useTranslation(['backup', 'common']);
  const descriptionId = useId();
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
      const originalName = entry.originalName || entry.name.replace(/^\d+-\d+-/, '');
      await saveFile(new Uint8Array(bytes), originalName);
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
      style={{ maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto' }}
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
        {entries.map((entry, index) => (
          <li key={entry.name}>
            <button disabled={busy} style={{ maxWidth: '100%', overflowWrap: 'anywhere' }} aria-describedby={`${descriptionId}-${index}`} onClick={() => void recover(entry)}>
              {t('sourceRecovery.entry', { name: entry.originalName || entry.name.replace(/^\d+-\d+-/, ''), size: entry.size })}
            </button>
            <small id={`${descriptionId}-${index}`} style={{ display: 'block', overflowWrap: 'anywhere' }}>
              {entry.sourcePath && <span style={{ display: 'block' }}>{entry.sourcePath}</span>}
              {!!entry.modifiedAt && <time dateTime={new Date(entry.modifiedAt).toISOString()}>{formatDateTime(entry.modifiedAt, {
                year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
              })}</time>}
            </small>
          </li>
        ))}
      </ul>
      <button disabled={busy} onClick={onClose}>
        {t('common:close')}
      </button>
    </dialog>
  );
}
