/**
 * The script the writer had open when the app last ran.
 *
 * OpenDraft has always launched into a blank "Untitled Screenplay". With the
 * editor as the app's front door that reads, after a crash, as "everything is
 * gone" — and the writer has no way to tell whether it is. Reproducing issue
 * #68 on iPad showed both halves of that: a line typed and lost, *and* the
 * saved script it belonged to nowhere on screen, though it was sitting intact
 * in the library the whole time. The lost line is one bug; being unable to see
 * that the rest survived is what makes it feel total.
 *
 * Deliberately narrow. This records an identity, never content:
 *
 *   - Content is the recovery snapshot's job (see recoveryService), and the two
 *     must not compete — the snapshot is offered explicitly and can decline to
 *     be restored, while this only reopens what was already saved.
 *   - Only library scripts are recorded. A file opened from disk is reached
 *     through a security-scoped bookmark that is not ours to re-acquire without
 *     the writer, and an unsaved document has no identity to record at all.
 *
 * Kept per window, for the same reason the recovery slots are: two windows
 * share one localStorage, and a window returning from a crash should find what
 * *it* had open rather than its sibling's script.
 */

const STORAGE_KEY_BASE = 'opendraft:last-session';

/** Stale entries are ignored rather than reopened weeks later. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface LastSessionScript {
  projectId: string;
  scriptId: string;
  /** Epoch ms this was recorded. */
  at: number;
}

let cachedKey: string | null = null;

/** Mirrors recoveryService.storageKey: the main window keeps the bare key. */
function storageKey(): string {
  if (cachedKey !== null) return cachedKey;
  let key = STORAGE_KEY_BASE;
  try {
    const label = (
      window as unknown as {
        __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
      }
    ).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    if (typeof label === 'string' && label.length > 0 && label !== 'main') {
      key = `${STORAGE_KEY_BASE}:${label}`;
    }
  } catch (err) {
    console.warn('[last-session] could not identify this window, using the shared slot:', err);
  }
  cachedKey = key;
  return key;
}

/**
 * Record the script now open, or clear the record when there is none.
 *
 * Never throws: failing to remember which script was open must not be able to
 * disturb the editor.
 */
export function rememberLastSession(
  projectId: string | null,
  scriptId: string | null,
): void {
  try {
    if (!projectId || !scriptId) {
      localStorage.removeItem(storageKey());
      return;
    }
    const entry: LastSessionScript = { projectId, scriptId, at: Date.now() };
    localStorage.setItem(storageKey(), JSON.stringify(entry));
  } catch (err) {
    console.warn('[last-session] could not record the open script:', err);
  }
}

/** The script to reopen, or null when there is nothing worth reopening. */
export function readLastSession(): LastSessionScript | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey());
  } catch (err) {
    console.warn('[last-session] could not read the last open script:', err);
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as LastSessionScript;
    if (
      !parsed ||
      typeof parsed.projectId !== 'string' ||
      typeof parsed.scriptId !== 'string' ||
      typeof parsed.at !== 'number' ||
      Date.now() - parsed.at > MAX_AGE_MS
    ) {
      clearLastSession();
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[last-session] discarding an unreadable record:', err);
    clearLastSession();
    return null;
  }
}

/** Forget the open script — on close, or on a deliberate reset to blank. */
export function clearLastSession(): void {
  try {
    localStorage.removeItem(storageKey());
  } catch (err) {
    console.warn('[last-session] could not clear the record:', err);
  }
}
