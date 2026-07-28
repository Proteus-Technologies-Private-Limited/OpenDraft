/**
 * Timed backup snapshots.
 *
 * A separate timer from the 30-second auto-save in ScreenplayEditor, on
 * purpose:
 *   - the intervals differ by orders of magnitude (30s vs 5–60min)
 *   - auto-save bails out for a document that was never saved to the library,
 *     whereas those are exactly the documents a backup most needs to protect
 *   - a slow disk or a stalled network share must never delay or fail the
 *     database save, which is the writer's real copy
 *
 * Failure handling is deliberately quiet — see backupStatusStore. A failed
 * backup is not data loss, so it never blocks the editor and never nags.
 */
import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useBackupStatusStore, describeBackupError, BACKUP_FAILURE_LIMIT } from '../stores/backupStatusStore';
import { writeSnapshot } from '../services/backupService';
import { isDesktopTauri } from '../services/platform';
import { docHasAnyText } from '../utils/docText';
import { showToast } from '../components/Toast';

/** How many times the initial snapshot waits for the editor to finish loading. */
const INITIAL_ATTEMPTS = 4;
const INITIAL_RETRY_MS = 5_000;

export interface BackupSchedulerOptions {
  /** Builds the payload to snapshot; returns undefined when there's nothing. */
  buildSaveContent: () => Record<string, unknown> | undefined;
  documentTitle: string;
  projectId?: string | null;
  scriptId?: string | null;
  projectTitle?: string;
  /** Shared with auto-save: true while the editor is swapping documents. */
  scriptSwitchingRef: React.MutableRefObject<boolean>;
  isCollabGuest: boolean;
  isHistoryMode: boolean;
}

export function useBackupScheduler(opts: BackupSchedulerOptions): void {
  const backupEnabled = useSettingsStore((s) => s.backupEnabled);
  const backupFolder = useSettingsStore((s) => s.backupFolder);
  const intervalMinutes = useSettingsStore((s) => s.backupIntervalMinutes);
  const backupUnsavedDocs = useSettingsStore((s) => s.backupUnsavedDocs);
  const pausedByError = useBackupStatusStore((s) => s.pausedByError);

  // Latest values, so the interval doesn't need re-creating on every keystroke.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Serialized payload of the last snapshot, to skip unchanged documents. */
  const lastSnapshotKeyRef = useRef<string>('');
  const isWritingRef = useRef(false);

  // Switching scripts must always produce a first snapshot for the new one.
  useEffect(() => {
    lastSnapshotKeyRef.current = '';
  }, [opts.scriptId]);

  useEffect(() => {
    if (!isDesktopTauri()) return;
    if (!backupEnabled || !backupFolder) return;
    if (pausedByError) return;

    /**
     * Returns false only when this document could still become snapshottable
     * shortly — the editor is mid-load, mid-switch, or a write is in flight.
     * Everything else (nothing to back up here, or a write that failed) counts
     * as settled, so the initial retry below stops instead of hammering.
     */
    const tick = async (): Promise<boolean> => {
      const current = optsRef.current;
      if (current.isCollabGuest || current.isHistoryMode) return true;
      if (current.scriptSwitchingRef.current) return false;
      if (isWritingRef.current) return false;

      const content = current.buildSaveContent();
      if (!content) return false;

      // Never snapshot a blank document — inherits the same editor-reset
      // protection the auto-save guard relies on. Also the state a freshly
      // mounted editor is in before its content arrives, hence "not settled".
      if (!docHasAnyText(content)) return false;

      if (!current.scriptId && !backupUnsavedDocs) return true;

      // Skip when nothing changed. Deliberately excludes assets, so unchanged
      // images never trigger an expensive re-pack.
      const key = JSON.stringify(content);
      if (key === lastSnapshotKeyRef.current) return true;

      isWritingRef.current = true;
      try {
        const result = await writeSnapshot({
          content,
          title: current.documentTitle || 'Untitled',
          projectId: current.projectId ?? null,
          scriptId: current.scriptId ?? null,
          projectTitle: current.projectTitle,
          kind: 'auto',
        });
        lastSnapshotKeyRef.current = key;
        useBackupStatusStore.getState().noteSuccess(result.path);
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        const reason = describeBackupError(raw);
        const failures = useBackupStatusStore.getState().noteFailure(reason);
        // First failure gets one toast; the next are console-only; the last
        // says we've stopped. At most two toasts per broken session.
        if (failures === 1) {
          showToast(`Backup failed — ${reason}`, 'error');
        } else if (failures >= BACKUP_FAILURE_LIMIT) {
          showToast(`Automatic backups paused — ${reason} Fix the folder in Settings to resume.`, 'error');
        } else {
          console.warn('[backup]', reason);
        }
      } finally {
        isWritingRef.current = false;
      }
      return true;
    };

    // An initial snapshot the moment backups are switched on (and on launch
    // when they already are). Waiting a full interval for the first copy is the
    // one window where the feature looks enabled but protects nothing — and it
    // is exactly when the writer goes looking in the folder to check it works.
    // Unchanged documents are deduped by lastSnapshotKeyRef, so this never
    // doubles up with the interval or with a settings tweak.
    let cancelled = false;
    let retryId: ReturnType<typeof setTimeout> | null = null;
    const runInitial = async (attempt: number) => {
      if (cancelled) return;
      const settled = await tick();
      // On launch the editor is still loading its document, so the first
      // attempt usually finds a blank doc. Retry a few times, then leave it to
      // the interval.
      if (!settled && !cancelled && attempt + 1 < INITIAL_ATTEMPTS) {
        retryId = setTimeout(() => void runInitial(attempt + 1), INITIAL_RETRY_MS);
      }
    };
    void runInitial(0);

    const id = setInterval(() => void tick(), Math.max(1, intervalMinutes) * 60_000);
    return () => {
      cancelled = true;
      if (retryId) clearTimeout(retryId);
      clearInterval(id);
    };
  }, [backupEnabled, backupFolder, intervalMinutes, backupUnsavedDocs, pausedByError]);
}
