/**
 * The crash-recovery copy of the document being edited.
 *
 * Distinct from both of the things that already persist a script:
 *
 *   - Auto-save writes the *real* copy, but only for a script that lives in a
 *     project. A screenplay that was imported or started and never saved to the
 *     library has nothing writing it anywhere.
 *   - Automatic backups write .odraft snapshots to a folder the user picks, on
 *     every platform the app runs on (see backupService) — but only once the
 *     writer has chosen that folder, and only on the interval they set.
 *
 * Which leaves a gap against the thing that actually happens on mobile: iPadOS
 * suspending and then terminating the app, or the user force-quitting to escape
 * a screen (issue #68). This snapshot fills it on every platform, with no setup
 * at all.
 *
 * It is deliberately NOT the user's file. Restoring is always an explicit
 * choice, so a recovered draft can never silently overwrite a version the
 * writer deliberately saved.
 *
 * Storage is localStorage rather than SQLite: it survives process death, it is
 * synchronous — which is what makes the last-moment flush on `pagehide` viable,
 * since iOS gives no async window during termination — and it is the one store
 * available identically on desktop Tauri, both mobile Tauri platforms, and the
 * web build.
 */

import { uuid } from '../utils/uuid';
import { collectScratchIds } from '../utils/scratchRefs';

const STORAGE_KEY_BASE = 'opendraft:recovery';

/**
 * Identifies this run of the app.
 *
 * A snapshot is only worth offering back if it outlived the session that wrote
 * it — that is what "unsaved work from last time" means. Without this the
 * prompt fired on every remount of the editor, so opening the Beat Board and
 * coming back offered the writer their own document back, seconds after they
 * had been editing it.
 *
 * A module-level value rather than sessionStorage: route changes never reload
 * the page, so it stays put for exactly as long as the window lives, and a
 * relaunch (or a webview reload after a crash) starts a new one.
 */
const SESSION_ID = uuid();

/** Resolved once: a window's label cannot change while it is open. */
let cachedStorageKey: string | null = null;

/**
 * Where this window keeps its snapshot.
 *
 * Every window of the app shares one localStorage, so a single slot meant two
 * windows overwrote each other's unsaved work every ten seconds, and saving in
 * one threw away the other's protection. Since iPad gained real windows (issue
 * #63) that stopped being a desktop-only corner case.
 *
 * The slot is keyed by the Tauri window label, which is the one identifier that
 * is both unique among open windows and stable across launches — so a window
 * finds its own predecessor's snapshot after a crash, and never picks up one
 * belonging to a sibling that is still running. The main window keeps the
 * unsuffixed key so snapshots written by earlier versions are still offered
 * back after an update.
 *
 * Tauri publishes the label synchronously, which matters: the last-moment flush
 * on `pagehide` has no room to await anything.
 */
function storageKey(): string {
  if (cachedStorageKey !== null) return cachedStorageKey;

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
    // Not Tauri, or the internals moved: one shared slot is the old behaviour,
    // which is still correct for the single window a browser tab has.
    console.warn('[recovery] could not identify this window, using the shared slot:', err);
  }
  cachedStorageKey = key;
  return key;
}

/**
 * Refuse to store anything near the ~5 MB localStorage quota. Overshooting
 * throws and would take the *existing* snapshot down with it in some engines,
 * turning a "too big to protect" case into a "lost what we had" case.
 */
const MAX_SNAPSHOT_BYTES = 3_500_000;

/**
 * How long one window's claim on another window's snapshot holds.
 *
 * The claim exists only to stop two windows launching together from offering
 * the same work twice, which they either do within moments of each other or not
 * at all. Anything older is a window that died mid-decision, and its snapshot
 * should go back on offer rather than stay hidden for good.
 */
const OFFER_CLAIM_MS = 60_000;

export interface RecoverySnapshot {
  /** Bumped when the shape changes; older payloads are discarded, not migrated. */
  version: 1;
  /**
   * The run of the app that wrote this. Absent on snapshots written before
   * sessions were tracked, which are from a previous run by definition.
   */
  sessionId?: string;
  /**
   * The run currently asking the writer about it. Keeps two windows of the same
   * run from offering one snapshot twice.
   */
  offeredBy?: string;
  /** When {@link offeredBy} was stamped; see OFFER_CLAIM_MS. */
  offeredAt?: number;
  /** Epoch ms the snapshot was written. */
  savedAt: number;
  /** Document title, for naming the document in the recovery prompt. */
  title: string;
  /** Project/script the snapshot came from; null for a document never saved. */
  projectId: string | null;
  scriptId: string | null;
  /** A `buildSaveContent()` payload: the PM document plus `_`-prefixed state. */
  content: Record<string, unknown>;
}

export interface WriteRecoveryInput {
  content: Record<string, unknown>;
  title: string;
  projectId: string | null;
  scriptId: string | null;
}

/** Why a snapshot could not be written. */
export type RecoveryFailureReason = 'too-large' | 'storage' | 'serialize';

let unavailableHandler: ((reason: RecoveryFailureReason) => void) | null = null;

/**
 * Be told when the document cannot be protected.
 *
 * A failed write used to produce a `console.warn` and nothing else, so a writer
 * whose document was over the limit had no crash protection and no way to know
 * it — the one state where this feature silently isn't doing its job is exactly
 * the one they most need told about. It stays a notification rather than
 * anything blocking: a missing snapshot is not itself data loss.
 */
export function setRecoveryUnavailableHandler(
  fn: ((reason: RecoveryFailureReason) => void) | null,
): void {
  unavailableHandler = fn;
}

function reportUnavailable(reason: RecoveryFailureReason): false {
  try {
    unavailableHandler?.(reason);
  } catch (err) {
    console.warn('[recovery] the unavailable handler threw:', err);
  }
  return false;
}

/**
 * Persist the current editing state.
 *
 * Never throws: a failed recovery write is not data loss on its own, and it
 * must not be able to break the editor or the real save path.
 *
 * @returns true when the snapshot was stored.
 */
export function writeRecoverySnapshot(input: WriteRecoveryInput): boolean {
  const snapshot: RecoverySnapshot = {
    version: 1,
    sessionId: SESSION_ID,
    savedAt: Date.now(),
    title: input.title,
    projectId: input.projectId,
    scriptId: input.scriptId,
    content: input.content,
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(snapshot);
  } catch (err) {
    console.warn('[recovery] could not serialize the document:', err);
    return reportUnavailable('serialize');
  }

  if (serialized.length > MAX_SNAPSHOT_BYTES) {
    console.warn(
      `[recovery] document is ${Math.round(serialized.length / 1024)}KB, above the ` +
        `${Math.round(MAX_SNAPSHOT_BYTES / 1024)}KB recovery limit — not snapshotted.`,
    );
    return reportUnavailable('too-large');
  }

  try {
    localStorage.setItem(storageKey(), serialized);
    return true;
  } catch (err) {
    // Quota exceeded, or storage disabled (Safari private browsing).
    console.warn('[recovery] could not write the recovery snapshot:', err);
    return reportUnavailable('storage');
  }
}

/**
 * Read the stored snapshot, or null when there is none, it is unreadable, or
 * it was written by an incompatible version.
 *
 * A corrupt entry is dropped rather than left to fail on every launch.
 */
export function readRecoverySnapshot(): RecoverySnapshot | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey());
  } catch (err) {
    console.warn('[recovery] could not read the recovery snapshot:', err);
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as RecoverySnapshot;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.savedAt !== 'number' ||
      !parsed.content ||
      typeof parsed.content !== 'object'
    ) {
      clearRecoverySnapshot();
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn('[recovery] discarding an unreadable recovery snapshot:', err);
    clearRecoverySnapshot();
    return null;
  }
}

/** The slot the current prompt is offering, so the right one gets cleared. */
let offeredKey: string | null = null;

/** Every recovery slot in storage, this window's and other windows'. */
function allSlotKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key === STORAGE_KEY_BASE || key.startsWith(`${STORAGE_KEY_BASE}:`))) {
        keys.push(key);
      }
    }
  } catch (err) {
    console.warn('[recovery] could not list the recovery slots:', err);
  }
  return keys;
}

function readSlot(key: string): RecoverySnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecoverySnapshot;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.savedAt !== 'number' ||
      !parsed.content ||
      typeof parsed.content !== 'object'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The snapshot worth *offering back*: one an earlier run of the app left
 * behind.
 *
 * This is the question the recovery prompt asks, and it is not the same as
 * "is there a snapshot". The editor writes one continuously while a document is
 * open, so a snapshot from the current session is simply the work in progress —
 * offering to "recover" it would interrupt the writer with their own document
 * every time they came back from Settings or the Beat Board.
 *
 * It also looks beyond this window's own slot. iPadOS restores every scene the
 * app had open, and which of them it puts in front is not the app's decision —
 * so the work written by "main" can easily come back with "main-1" on screen.
 * Offering only the current window's slot means the writer is shown nothing,
 * while their unsaved pages sit in a window they cannot see.
 *
 * A snapshot is marked as it is offered, so two windows opening at once do not
 * both present the same one.
 */
export function readRecoverableSnapshot(): RecoverySnapshot | null {
  const own = readSlot(storageKey());
  if (own && own.sessionId !== SESSION_ID) {
    offeredKey = storageKey();
    markOffered(offeredKey, own);
    return own;
  }

  let best: { key: string; snapshot: RecoverySnapshot } | null = null;
  const now = Date.now();
  for (const key of allSlotKeys()) {
    const snapshot = readSlot(key);
    if (!snapshot || snapshot.sessionId === SESSION_ID) continue;
    // Another window of this run is already asking about it. The claim expires:
    // it was written to stop two windows opening together from presenting the
    // same snapshot twice, which is a matter of seconds, but it persisted, so a
    // window killed while its prompt was still up left the mark behind and the
    // work in that slot was skipped on every launch from then on.
    if (
      snapshot.offeredBy &&
      snapshot.offeredBy !== SESSION_ID &&
      typeof snapshot.offeredAt === 'number' &&
      now - snapshot.offeredAt < OFFER_CLAIM_MS
    ) {
      continue;
    }
    if (!best || snapshot.savedAt > best.snapshot.savedAt) best = { key, snapshot };
  }
  if (!best) return null;

  offeredKey = best.key;
  markOffered(best.key, best.snapshot);
  return best.snapshot;
}

/**
 * Note that this run is asking about a snapshot, without consuming it: if the
 * app dies while the prompt is up, the work is still there next time.
 */
function markOffered(key: string, snapshot: RecoverySnapshot): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ ...snapshot, offeredBy: SESSION_ID, offeredAt: Date.now() }),
    );
  } catch (err) {
    console.warn('[recovery] could not mark the snapshot as offered:', err);
  }
}

/**
 * Whether there is work from an earlier session waiting to be offered back.
 *
 * Deliberately synchronous, so the editor can ask before its first paint. Not
 * side-effect free: asking marks the snapshot as offered by this run, which is
 * what stops a sibling window presenting the same one. Launch has two modals competing for the same moment — this
 * one and "how would you like to start?" — and asking a writer to choose a
 * starting point while unsaved work is still queued behind it gets the order
 * exactly backwards.
 */
export function hasRecoverableSnapshot(): boolean {
  if (hasSeenRecoveryPrompt()) return false;
  return readRecoverableSnapshot() !== null;
}

/**
 * Whether the recovery prompt has already had its turn this session.
 *
 * The editor is unmounted and rebuilt every time the writer visits Settings,
 * the Beat Board or any other full-screen view, so "check on mount" is not the
 * same as "check on launch". One offer per run, and the answer is theirs to
 * make once.
 */
let recoveryPromptSeen = false;

export function hasSeenRecoveryPrompt(): boolean {
  return recoveryPromptSeen;
}

export function markRecoveryPromptSeen(): void {
  recoveryPromptSeen = true;
}

/**
 * Drop the snapshot — after an explicit save, or once the user has decided.
 *
 * Clears the slot that was offered as well as this window's own: the prompt may
 * have been showing another window's leftover work (see
 * readRecoverableSnapshot), and clearing only the local slot would leave it to
 * be offered again on the next launch.
 */
export function clearRecoverySnapshot(): void {
  const keys = offeredKey && offeredKey !== storageKey()
    ? [storageKey(), offeredKey]
    : [storageKey()];
  offeredKey = null;
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      console.warn('[recovery] could not clear the recovery snapshot:', err);
    }
  }
}

/**
 * Every scratch blob referenced by ANY window's snapshot, not just this one's.
 *
 * The scratch sweeper needs this. All windows share one localStorage, so a
 * sweep driven only by the document on screen would happily delete the images
 * belonging to unsaved work sitting in a sibling window's slot — or in this
 * window's own slot, waiting to be offered back after a crash. Getting the
 * keep-set wrong here is the one way this whole mechanism can lose a writer's
 * picture, so it reads every slot rather than assuming.
 */
export function collectRecoverySnapshotScratchIds(): Set<string> {
  const out = new Set<string>();
  for (const key of allSlotKeys()) {
    const snapshot = readSlot(key);
    if (!snapshot) continue;
    for (const id of collectScratchIds(snapshot.content)) out.add(id);
  }
  return out;
}

/**
 * Whether a snapshot describes the document the editor currently has open.
 *
 * Both-null counts as a match: that is the unsaved "Untitled Screenplay" the
 * app opens with, and it is exactly the document with no other protection.
 */
export function snapshotMatchesDocument(
  snapshot: RecoverySnapshot,
  projectId: string | null,
  scriptId: string | null,
): boolean {
  return snapshot.projectId === projectId && snapshot.scriptId === scriptId;
}
