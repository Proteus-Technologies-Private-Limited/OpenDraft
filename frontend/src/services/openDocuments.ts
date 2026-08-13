/**
 * Which document each window has open (issue #63).
 *
 * With more than one window, the same screenplay can be opened twice — and two
 * editors auto-saving the same script take turns overwriting each other, so the
 * last one to tick wins and the other window's work is quietly gone. The writer
 * has no way to tell: both windows look right.
 *
 * So each window records what it is showing, and a window about to open a
 * document checks whether another one already has it.
 *
 * The record lives in localStorage, which every window of the app shares. It
 * cannot say whether the window that wrote an entry still exists — a crash
 * leaves its entry behind — so the list of open windows is asked of Tauri and
 * anything not in it is discarded.
 */
import { isTauri } from './platform';

const STORAGE_KEY = 'opendraft:open-documents';

interface Entry {
  /** Tauri window label, the identity the backend also knows. */
  window: string;
  /** Identifies the document; see documentKey. */
  key: string;
  /** For naming the document in the prompt. */
  title: string;
  /** Epoch ms, for breaking ties if two windows claim the same document. */
  at: number;
}

export interface OpenElsewhere {
  window: string;
  title: string;
}

/** This window's label, or null in a browser tab (where there is one window). */
export function currentWindowLabel(): string | null {
  try {
    const label = (
      window as unknown as {
        __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
      }
    ).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
    return typeof label === 'string' && label.length > 0 ? label : null;
  } catch {
    return null;
  }
}

/**
 * A stable name for the document being edited, or null when there is nothing
 * worth guarding.
 *
 * Only documents that live somewhere are worth guarding: a stored script, or a
 * file being edited in place. An unsaved "Untitled Screenplay" exists solely in
 * its own window, so two of them cannot overwrite each other.
 */
export function documentKey(
  projectId: string | null,
  scriptId: string | null,
  originPath: string | null,
): string | null {
  if (originPath) return `file:${originPath}`;
  if (scriptId) return `script:${projectId ?? 'none'}/${scriptId}`;
  return null;
}

function readEntries(): Entry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is Entry =>
        !!e && typeof e.window === 'string' && typeof e.key === 'string',
    );
  } catch (err) {
    console.warn('[windows] could not read the open-document list:', err);
    return [];
  }
}

function writeEntries(entries: Entry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    // Not worth failing an open over: the guard is a courtesy, the document
    // still opens.
    console.warn('[windows] could not record the open document:', err);
  }
}

/** Record what this window is showing. Pass null when it holds nothing. */
export function claimOpenDocument(key: string | null, title: string): void {
  const label = currentWindowLabel();
  if (!label) return;

  const others = readEntries().filter((e) => e.window !== label);
  writeEntries(
    key ? [...others, { window: label, key, title, at: Date.now() }] : others,
  );
}

/** Give up this window's claim — on close, or when it moves on. */
export function releaseOpenDocument(): void {
  claimOpenDocument(null, '');
}

/**
 * The other window that already has this document open, if there is one.
 *
 * Entries for windows that no longer exist are dropped as they are found, so a
 * window that crashed mid-edit cannot block the document for good.
 */
export async function findWindowWithDocument(
  key: string,
): Promise<OpenElsewhere | null> {
  const label = currentWindowLabel();
  if (!label || !isTauri()) return null;

  const entries = readEntries();
  const claims = entries.filter((e) => e.key === key && e.window !== label);
  if (claims.length === 0) return null;

  let live: { label: string; title: string }[];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    live = await invoke<{ label: string; title: string }[]>('list_windows');
  } catch (err) {
    // Without an authoritative list there is no way to tell a live claim from
    // a stale one, and blocking on a guess would be worse than not guarding.
    console.warn('[windows] could not list the open windows:', err);
    return null;
  }

  const liveLabels = new Set(live.map((w) => w.label));
  const stale = entries.some((e) => !liveLabels.has(e.window));
  if (stale) writeEntries(entries.filter((e) => liveLabels.has(e.window)));

  const claim = claims.find((c) => liveLabels.has(c.window));
  return claim ? { window: claim.window, title: claim.title } : null;
}

/** Ask the backend to bring another window forward. */
export async function focusWindow(label: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('focus_window', { label });
}
