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

/** Where this tab remembers which slot is its own, across reloads. */
const TAB_SLOT_KEY = 'opendraft:recoveryTab';

/**
 * Where this window or tab keeps its snapshot.
 *
 * Every window of the app shares one localStorage, so a single slot meant two
 * windows overwrote each other's unsaved work every ten seconds, and saving in
 * one threw away the other's protection. Since iPad gained real windows (issue
 * #63) that stopped being a desktop-only corner case.
 *
 * Under Tauri the slot is keyed by the window label, which is both unique among
 * open windows and stable across launches — so a window finds its own
 * predecessor's snapshot after a crash, and never picks up one belonging to a
 * sibling that is still running. The main window keeps the unsuffixed key so
 * snapshots written by earlier versions are still offered back after an update.
 *
 * In a browser there is no label, and every tab was therefore sharing the one
 * unsuffixed slot — so opening the app in a second tab quietly destroyed the
 * unsaved work the first tab was protecting, within ten seconds and with
 * nothing said. A tab gets a slot of its own instead, remembered in
 * sessionStorage so a reload comes back to the same one.
 *
 * Both paths are synchronous, which matters: the last-moment flush on
 * `pagehide` has no room to await anything.
 */
function storageKey(): string {
  if (cachedStorageKey !== null) return cachedStorageKey;
  cachedStorageKey = resolveStorageKey();
  return cachedStorageKey;
}

function resolveStorageKey(): string {
  try {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
      }
    ).__TAURI_INTERNALS__;
    if (internals) {
      const label = internals.metadata?.currentWindow?.label;
      return typeof label === 'string' && label.length > 0 && label !== 'main'
        ? `${STORAGE_KEY_BASE}:${label}`
        : STORAGE_KEY_BASE;
    }
  } catch (err) {
    console.warn('[recovery] could not identify this window:', err);
  }

  const suffix = browserTabSuffix();
  return suffix ? `${STORAGE_KEY_BASE}:${suffix}` : STORAGE_KEY_BASE;
}

/**
 * This tab's own slot name, minted once and kept in sessionStorage.
 *
 * A tab keeps the slot it had. Finding its own last snapshot still in there is
 * the normal case rather than a clash: the tab reloaded, or the browser came
 * back after a crash, and that work is exactly what the launch prompt is about
 * to offer back — the same way a Tauri window finds its predecessor's.
 *
 * The one case sessionStorage cannot tell apart at load is a duplicated tab,
 * which inherits the original's storage and would point straight at its slot.
 * That is settled at the first write instead — see {@link slotTakenByLiveTab}.
 */
function browserTabSuffix(): string | null {
  try {
    return sessionStorage.getItem(TAB_SLOT_KEY) ?? mintTabSlot();
  } catch (err) {
    // Storage disabled (Safari private browsing): the one shared slot is the
    // old behaviour, and still correct for a single tab.
    console.warn('[recovery] no per-tab slot available, using the shared one:', err);
    return null;
  }
}

function mintTabSlot(): string {
  const id = `tab-${uuid().slice(0, 8)}`;
  sessionStorage.setItem(TAB_SLOT_KEY, id);
  return id;
}

/**
 * Stop answering other tabs.
 *
 * A closed tab stops answering by simply ceasing to exist, so this is for
 * teardown — and for tests, which need a way to retire one simulated tab
 * without ending the process it is running in.
 */
export function closeRecoveryPresence(): void {
  try {
    presenceChannel?.close();
  } catch (err) {
    console.warn('[recovery] could not close the presence channel:', err);
  }
  presenceChannel = null;
}

/**
 * The storage slot this window or tab writes to.
 *
 * Exposed for diagnostics and for tests that need to plant or inspect a
 * snapshot where this run will actually look for it.
 */
export function recoverySlotKey(): string {
  return storageKey();
}

/** When this run of the app started; see {@link slotTakenByLiveTab}. */
const RUN_STARTED_AT = Date.now();

/**
 * Which slots belong to tabs that are open right now.
 *
 * "A snapshot from another session" is not the same as "work nobody is looking
 * after". Opening a second tab while the first has unsaved pages found the
 * first tab's snapshot, saw a session id that was not its own, and offered the
 * writer their own live document back as unsaved work from last time — with
 * the prompt itself admitting it had been "edited just now".
 *
 * Recency cannot tell the two apart: a snapshot written five seconds ago came
 * either from a tab that is alive or from one that died five seconds ago, and
 * a tab in the background is throttled and writes nothing at all while still
 * very much alive. So the tabs are asked instead. Every run answers a ping
 * with the slot it is using, and a run that has ended answers nothing.
 */
const PRESENCE_CHANNEL = 'opendraft:recovery-presence';

const liveSlots = new Set<string>();
let presenceChannel: BroadcastChannel | null = null;
let presenceAsked = false;
/** Whether the tabs can be asked at all — false only on a very old engine. */
let presenceSupported = false;

interface PresenceMessage {
  type: 'who' | 'here';
  sessionId: string;
  slot?: string;
}

/**
 * Join the conversation between tabs: answer pings, and send one.
 *
 * Called as this module loads, so replies are in long before the launch prompt
 * — which waits for the editor to be ready — asks anything. Failure is not
 * worth reporting: `BroadcastChannel` is missing only in very old engines, and
 * {@link recentEnoughToBeLive} covers that case.
 */
function openPresenceChannel(): void {
  if (presenceAsked) return;
  presenceAsked = true;
  try {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(PRESENCE_CHANNEL);
    channel.onmessage = (event: MessageEvent<PresenceMessage>) => {
      const message = event.data;
      if (!message || message.sessionId === SESSION_ID) return;
      if (message.type === 'who') {
        // Someone just opened. Tell them which slot is spoken for.
        channel.postMessage({ type: 'here', sessionId: SESSION_ID, slot: storageKey() });
      } else if (message.type === 'here' && typeof message.slot === 'string') {
        liveSlots.add(message.slot);
      }
    };
    // Node's implementation holds the event loop open; a browser's has no unref.
    (channel as unknown as { unref?: () => void }).unref?.();
    presenceChannel = channel;
    presenceSupported = true;
    channel.postMessage({ type: 'who', sessionId: SESSION_ID });
  } catch (err) {
    console.warn('[recovery] could not ask other tabs what they are using:', err);
  }
}

/**
 * How fresh a snapshot has to be to be taken for a live tab's when nothing has
 * answered the ping.
 *
 * Only reached where `BroadcastChannel` is missing. Ten seconds is the
 * snapshot interval, so anything inside this window is more likely a tab still
 * at work than one that died in the last moment — and a snapshot wrongly held
 * back is not lost, it is offered at the next launch instead.
 */
const LIVE_SLOT_MS = 30_000;

function recentEnoughToBeLive(snapshot: RecoverySnapshot): boolean {
  return Date.now() - snapshot.savedAt < LIVE_SLOT_MS;
}

/**
 * Is this slot being used by a tab that is open right now?
 *
 * Its work is not lost and must not be offered back — nor written over.
 */
function slotIsLive(key: string, snapshot: RecoverySnapshot): boolean {
  if (snapshot.sessionId === SESSION_ID) return false;
  if (liveSlots.has(key)) return true;
  // Nothing can be asked, so fall back to how recently the slot was written.
  return !presenceSupported && recentEnoughToBeLive(snapshot);
}

/**
 * Is another tab, running right now, writing to this slot?
 *
 * Either it said so when it answered the ping, or the snapshot in the slot was
 * written *after this run began* — which only a tab that is still running can
 * have done. Work left by an earlier run, this tab before a reload or a tab
 * that has since closed, was written before by definition and is left alone to
 * be offered back.
 */
function slotTakenByLiveTab(key: string): boolean {
  if (liveSlots.has(key)) return true;
  const existing = readSlot(key);
  if (!existing || existing.sessionId === SESSION_ID) return false;
  return existing.savedAt > RUN_STARTED_AT;
}

/**
 * Move to a slot of our own, leaving the live tab the one it is using.
 *
 * Only possible in a browser, where the slot name is ours to choose; a Tauri
 * window's label is fixed, and two of them cannot collide in the first place.
 */
function moveToFreeSlot(): void {
  try {
    mintTabSlot();
    cachedStorageKey = null;
    console.warn('[recovery] another tab is using this slot — moved to a new one.');
  } catch (err) {
    console.warn('[recovery] could not move to a free recovery slot:', err);
  }
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

  // A duplicated tab starts out pointed at the original's slot; stepping off
  // it here is what stops the two overwriting each other's unsaved work.
  if (slotTakenByLiveTab(storageKey())) moveToFreeSlot();

  try {
    localStorage.setItem(storageKey(), serialized);
    return true;
  } catch (err) {
    // Quota exceeded, or storage disabled (Safari private browsing). Since a
    // tab keeps a slot of its own, a machine that has been through many
    // sessions can be holding several snapshots nobody ever answered for, and
    // between them and the document being typed right now, the document being
    // typed right now wins.
    if (dropOldestStrandedSlot()) {
      try {
        localStorage.setItem(storageKey(), serialized);
        return true;
      } catch (retryErr) {
        console.warn('[recovery] still could not write after freeing a slot:', retryErr);
        return reportUnavailable('storage');
      }
    }
    console.warn('[recovery] could not write the recovery snapshot:', err);
    return reportUnavailable('storage');
  }
}

/**
 * Free the least recently written slot belonging to neither this run nor the
 * prompt currently on screen.
 *
 * Only ever called because storage is full and the open document would
 * otherwise go unprotected. An unreadable slot goes first — it is occupying
 * space and can be offered to nobody.
 *
 * @returns true when something was freed and the write is worth retrying.
 */
function dropOldestStrandedSlot(): boolean {
  const own = storageKey();
  let oldest: { key: string; savedAt: number } | null = null;
  for (const key of allSlotKeys()) {
    if (key === own || key === offeredKey) continue;
    const snapshot = readSlot(key);
    if (!snapshot) {
      try {
        localStorage.removeItem(key);
        return true;
      } catch {
        continue;
      }
    }
    if (!oldest || snapshot.savedAt < oldest.savedAt) {
      oldest = { key, savedAt: snapshot.savedAt };
    }
  }
  if (!oldest) return false;
  console.warn(
    '[recovery] storage is full — dropping the oldest unclaimed snapshot from '
    + `${new Date(oldest.savedAt).toISOString()} so the open document stays protected.`,
  );
  try {
    localStorage.removeItem(oldest.key);
    return true;
  } catch (err) {
    console.warn('[recovery] could not free a slot:', err);
    return false;
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
  if (own && own.sessionId !== SESSION_ID && !slotIsLive(storageKey(), own)) {
    offeredKey = storageKey();
    markOffered(offeredKey, own);
    return own;
  }

  let best: { key: string; snapshot: RecoverySnapshot } | null = null;
  const now = Date.now();
  for (const key of allSlotKeys()) {
    const snapshot = readSlot(key);
    if (!snapshot || snapshot.sessionId === SESSION_ID) continue;
    // A tab that is open right now is looking after its own work; offering it
    // back would hand the writer their own live document as something lost.
    if (slotIsLive(key, snapshot)) continue;
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

// Ask as the module loads, so the answers are in by the time the launch prompt
// runs — it waits for the editor to be ready, which is far longer than a
// same-origin message takes.
openPresenceChannel();
