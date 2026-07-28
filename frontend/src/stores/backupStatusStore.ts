/**
 * Ambient state for automatic backups: when the last snapshot landed, what
 * went wrong if one didn't, and whether the scheduler has given up.
 *
 * The anti-nagging rule lives here. A failed backup is not data loss — the
 * script is still saved in the library — so it must never block the editor or
 * repeat a toast every interval. Callers toast on the FIRST failure, stay quiet
 * for the next two, and on the third set `pausedByError`, which stops the
 * scheduler until the user changes a setting or backs up manually.
 */
import { create } from 'zustand';

/** Consecutive failures after which automatic backups stop trying. */
export const BACKUP_FAILURE_LIMIT = 3;

interface BackupStatusState {
  lastSuccessAt: number | null;
  lastPath: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  /** True once the scheduler has stopped trying; cleared by resume(). */
  pausedByError: boolean;
  /**
   * Bumped every time a document is opened — from the library, from a URL, or
   * imported from disk. The scheduler watches it and snapshots immediately
   * rather than leaving the newly opened script unprotected until the next
   * interval, which with a 60-minute setting is a long time to be exposed.
   *
   * A counter rather than a flag so re-opening the same script still registers.
   */
  documentOpenSeq: number;

  noteSuccess: (path: string) => void;
  /** Called by the editor once an opened document's content is in place. */
  noteDocumentOpened: () => void;
  /** Returns the new consecutive-failure count so callers can decide to toast. */
  noteFailure: (message: string) => number;
  /** Clear the failure state — a settings change or a successful manual backup. */
  resume: () => void;
}

export const useBackupStatusStore = create<BackupStatusState>((set, get) => ({
  lastSuccessAt: null,
  lastPath: null,
  lastError: null,
  consecutiveFailures: 0,
  pausedByError: false,
  documentOpenSeq: 0,

  noteDocumentOpened: () => set((s) => ({ documentOpenSeq: s.documentOpenSeq + 1 })),

  noteSuccess: (path) =>
    set({
      lastSuccessAt: Date.now(),
      lastPath: path,
      lastError: null,
      consecutiveFailures: 0,
      pausedByError: false,
    }),

  noteFailure: (message) => {
    const next = get().consecutiveFailures + 1;
    set({
      lastError: message,
      consecutiveFailures: next,
      pausedByError: next >= BACKUP_FAILURE_LIMIT,
    });
    return next;
  },

  resume: () => set({ consecutiveFailures: 0, pausedByError: false, lastError: null }),
}));

/**
 * Turn an OS error string into something a writer can act on. The Rust side
 * returns the raw `std::io::Error` text, which varies by platform but reliably
 * carries either an errno name or a numeric code.
 */
export function describeBackupError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('enoent') || s.includes('os error 2') || s.includes('no such file')) {
    return 'The backup folder no longer exists.';
  }
  if (
    s.includes('eacces') || s.includes('eperm') ||
    s.includes('os error 13') || s.includes('os error 5') ||
    s.includes('permission denied') || s.includes('access is denied')
  ) {
    return "OpenDraft doesn't have permission to write to the backup folder.";
  }
  if (s.includes('enospc') || s.includes('os error 28') || s.includes('no space')) {
    return 'The disk is full.';
  }
  if (s.includes('timed out') || s.includes('timeout')) {
    return 'The backup folder did not respond (is a network drive disconnected?).';
  }
  return raw;
}
