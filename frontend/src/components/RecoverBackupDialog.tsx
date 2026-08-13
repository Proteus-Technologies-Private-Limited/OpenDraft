/**
 * File → Backups → Recover Backup.
 *
 * Browse the snapshots in the configured folder and bring one back.
 *
 * Two restore paths, and the default is deliberately the non-destructive one:
 *
 *   - **Open as New Script** creates a new script and navigates to it, so the
 *     normal load path does all the store hydration. Nothing is overwritten,
 *     and there is no second hydration implementation to drift out of sync.
 *   - **Replace Current Script** overwrites, behind a confirmation, and takes a
 *     snapshot of the current state first so the replace is itself undoable.
 *
 * This is NOT `restoreVersion` (services/local-storage.ts), which deletes every
 * script in the project and re-inserts from a commit. Backup restore is
 * single-script and additive; the two must not share code or vocabulary.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectStore } from '../stores/projectStore';
import { scriptApi } from '../services/scriptApi';
import { api } from '../services/api';
import {
  listSnapshots, readSnapshot, deleteSnapshot, revealSnapshot, writeSnapshot,
  supportsRevealBackup,
  type BackupEntry,
} from '../services/backupService';
import { unpackAssets } from '../services/snapshotAssets';
import { parseOdraftLoose, type ParsedOdraft } from '../utils/odraftFormat';
import { relativeTime } from '../utils/relativeTime';
import { docHasAnyText } from '../utils/docText';
import { openTextFile } from '../utils/fileOps';
import { showToast } from './Toast';

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Supplies the current editor state so "Replace Current Script" can save a
   * safety copy first. Optional — without it the replace still works, just
   * without the undo.
   */
  onBeforeReplace?: () => { content: Record<string, unknown>; title: string } | undefined;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** First N characters of body text, for the preview pane. */
function previewText(content: Record<string, unknown>, limit = 1500): string {
  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (parts.join('').length > limit) return;
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === 'hardBreak') { parts.push('\n'); return; }
    if (typeof n.text === 'string') { parts.push(n.text); return; }
    if (Array.isArray(n.content)) {
      n.content.forEach((c, i) => { if (i > 0) parts.push('\n'); walk(c); });
    }
  };
  walk(content);
  return parts.join('').slice(0, limit).trim();
}

const RecoverBackupDialog: React.FC<Props> = ({ open, onClose, onBeforeReplace }) => {
  const navigate = useNavigate();
  const { currentProject, currentScriptId, triggerScriptReload } = useProjectStore();

  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BackupEntry | null>(null);
  const [preview, setPreview] = useState<ParsedOdraft | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEntries(await listSnapshots());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setSelected(null);
    setPreview(null);
    setConfirmReplace(false);
    void refresh();
  }, [open, refresh]);

  // Read the selected snapshot lazily — the list can be long and each file
  // carries its images.
  useEffect(() => {
    if (!selected) { setPreview(null); setPreviewError(null); return; }
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    readSnapshot(selected.path)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((err) => { if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [selected]);

  /**
   * One group per script. Keyed by project folder too, so two scripts that
   * share a title in different projects don't collapse into one list.
   */
  const grouped = useMemo(() => {
    const groups = new Map<string, BackupEntry[]>();
    for (const e of entries) {
      const label = e.project ? `${e.project} — ${e.title}` : e.title;
      const list = groups.get(label);
      if (list) list.push(e);
      else groups.set(label, [e]);
    }
    return Array.from(groups.entries());
  }, [entries]);

  const restoreAsNew = useCallback(async () => {
    if (!selected || !preview) return;
    if (!currentProject) {
      showToast('Open or create a project first, then restore into it', 'error');
      return;
    }
    if (!docHasAnyText(preview.content)) {
      showToast('That backup has no script content', 'error');
      return;
    }
    setBusy(true);
    try {
      const stamp = selected.date.toLocaleString();
      const created = await api.createScript(currentProject.id, {
        title: `${preview.meta.title || selected.title} (restored ${stamp})`,
        content: preview.content,
      });
      if (preview.assets.length > 0) {
        await unpackAssets(currentProject.id, preview.assets);
      }
      showToast('Backup restored as a new script', 'success');
      onClose();
      // Navigating makes the normal script loader hydrate every store, so
      // there is no separate restore path that could miss something.
      navigate(`/project/${currentProject.id}/edit/${created.meta.id}`);
    } catch (err) {
      showToast(`Restore failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [selected, preview, currentProject, navigate, onClose]);

  const replaceCurrent = useCallback(async () => {
    if (!selected || !preview || !currentProject || !currentScriptId) return;
    if (!docHasAnyText(preview.content)) {
      showToast('That backup has no script content', 'error');
      return;
    }
    setBusy(true);
    try {
      // Snapshot the current state first, so replacing is itself undoable.
      // Marked 'manual' so retention never prunes the safety copy. A failure
      // here is not fatal — warn and let the user decide.
      const current = onBeforeReplace?.();
      if (current) {
        try {
          await writeSnapshot({
            content: current.content,
            title: current.title,
            projectId: currentProject.id,
            scriptId: currentScriptId,
            projectTitle: currentProject.name,
            kind: 'manual',
          });
        } catch (err) {
          console.warn('[backup] safety snapshot before replace failed', err);
          showToast('Could not save a safety copy first — replacing anyway', 'info');
        }
      }

      await scriptApi.saveScript(currentProject.id, currentScriptId, { content: preview.content });
      if (preview.assets.length > 0) {
        await unpackAssets(currentProject.id, preview.assets);
      }
      triggerScriptReload();
      showToast('Current script replaced from backup', 'success');
      onClose();
    } catch (err) {
      showToast(`Restore failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
      setConfirmReplace(false);
    }
  }, [selected, preview, currentProject, currentScriptId, triggerScriptReload, onClose, onBeforeReplace]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    try {
      await deleteSnapshot(selected.path);
      setSelected(null);
      await refresh();
      showToast('Backup deleted', 'success');
    } catch (err) {
      showToast(`Could not delete: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [selected, refresh]);

  /** Recover a snapshot the user moved somewhere else. */
  const handleImportFile = useCallback(async () => {
    try {
      const file = await openTextFile([{ name: 'OpenDraft', extensions: ['odraft'] }]);
      if (!file) return;
      const parsed = parseOdraftLoose(file.content);
      setSelected({
        path: file.name, name: file.name, title: parsed.meta.title || file.name,
        scriptKey: 'external', date: new Date(), kind: 'external',
        sizeBytes: file.content.length, project: '',
      });
      setPreview(parsed);
    } catch (err) {
      showToast(`Could not read that file: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, []);

  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog recover-backup-dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">Recover Backup</h2>

        <div className="recover-backup-body">
          <div className="recover-backup-list">
            {loading && <div className="recover-backup-empty">Loading…</div>}

            {!loading && loadError && (
              <div className="recover-backup-empty">
                Can't read the backup folder — {loadError}
              </div>
            )}

            {!loading && !loadError && entries.length === 0 && (
              <div className="recover-backup-empty">
                No backups yet. Turn on automatic backups in Settings, or use
                File → Backups → Back Up Now.
              </div>
            )}

            {grouped.map(([title, items]) => (
              <div key={title} className="recover-backup-group">
                <div className="recover-backup-group-title">{title}</div>
                {items.map((e) => (
                  <button
                    key={e.path}
                    className={`recover-backup-item${selected?.path === e.path ? ' selected' : ''}`}
                    onClick={() => setSelected(e)}
                  >
                    <span className="recover-backup-when">{relativeTime(e.date)}</span>
                    <span className="recover-backup-meta">
                      {e.date.toLocaleString()} · {formatBytes(e.sizeBytes)}
                      {e.kind === 'manual' && <span className="recover-backup-badge">Manual</span>}
                      {e.kind === 'external' && <span className="recover-backup-badge">Imported</span>}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="recover-backup-preview">
            {!selected && <div className="recover-backup-empty">Select a backup to preview it.</div>}
            {selected && previewError && (
              <div className="recover-backup-empty">Could not read this backup — {previewError}</div>
            )}
            {selected && !preview && !previewError && <div className="recover-backup-empty">Reading…</div>}
            {preview && (
              <>
                <div className="recover-backup-preview-meta">
                  <div><strong>{preview.meta.title || selected?.title}</strong></div>
                  {preview.meta.author && <div>{preview.meta.author}</div>}
                  {preview.meta.page_count > 0 && <div>{preview.meta.page_count} pages</div>}
                  {selected && <div>Saved {selected.date.toLocaleString()}</div>}
                  {preview.meta.assets_omitted && (
                    <div className="settings-hint settings-hint-warning">
                      Images are not included in this backup — a restored script
                      will be missing them.
                    </div>
                  )}
                  {preview.assets.length > 0 && (
                    <div className="settings-hint">
                      Includes {preview.assets.length} image{preview.assets.length === 1 ? '' : 's'}.
                    </div>
                  )}
                </div>
                <pre className="recover-backup-preview-text">{previewText(preview.content)}</pre>
              </>
            )}
          </div>
        </div>

        {confirmReplace ? (
          <div className="recover-backup-confirm">
            Replace the script you have open with this backup? Its current
            contents will be overwritten. A backup of the current state is saved
            first, so this can be undone.
            <div className="dialog-actions">
              <button className="dialog-btn" onClick={() => setConfirmReplace(false)}>Cancel</button>
              <button className="dialog-btn dialog-btn-danger" disabled={busy} onClick={() => void replaceCurrent()}>
                Replace Script
              </button>
            </div>
          </div>
        ) : (
          <div className="dialog-actions">
            <button className="dialog-btn" onClick={() => void handleImportFile()}>Import from a file…</button>
            {/* Desktop only — neither mobile platform can open Files at a
                particular document. */}
            {supportsRevealBackup() && (
              <button
                className="dialog-btn"
                disabled={!selected || selected.kind === 'external'}
                onClick={() => selected && void revealSnapshot(selected.path)}
              >
                Reveal
              </button>
            )}
            <button
              className="dialog-btn dialog-btn-danger"
              disabled={!selected || selected.kind === 'external'}
              onClick={() => void handleDelete()}
            >
              Delete
            </button>
            <button
              className="dialog-btn"
              disabled={!preview || busy || !currentScriptId}
              onClick={() => setConfirmReplace(true)}
            >
              Replace Current Script…
            </button>
            <button
              className="dialog-btn dialog-btn-primary"
              disabled={!preview || busy}
              onClick={() => void restoreAsNew()}
            >
              Open as New Script
            </button>
            <button className="dialog-btn" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecoverBackupDialog;
