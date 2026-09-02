/**
 * In-app update notice (issue #106).
 *
 * Tells a writer once that a newer OpenDraft exists, and then leaves them
 * alone. The whole point of the feature is restraint, so the rules are:
 *
 *   Update        — opens the right store or download page for this build.
 *                   Deliberately does NOT record a dismissal: someone who
 *                   lands on the store page and backs out without installing
 *                   must still be reminded, or they sit on the old build
 *                   believing they updated.
 *   Remind later  — hidden until `SNOOZE_MS` has passed. Timestamped, so it
 *                   returns on its own; a mobile web view that never restarts
 *                   would otherwise swallow the reminder for weeks.
 *   Dismiss       — silent for that version and no other. Stored as the
 *                   version string rather than a flag, so a later release
 *                   speaks up again exactly once.
 *
 * ── Cost ────────────────────────────────────────────────────────────────────
 * This runs on every launch, so it is built to do as close to nothing as it
 * can get away with:
 *
 *   - Browsers never check at all. A reload already serves the newest build.
 *   - At most one network request per `CHECK_INTERVAL_MS`, across launches —
 *     opening the app ten times in a day costs one request, not ten.
 *   - No request at all while snoozed. The notice could not be shown either
 *     way, so the answer is not worth asking for.
 *   - No timer, no polling, no interval. One deferred check per launch, then
 *     the module is inert until something is clicked.
 *   - Deferred to idle so it never competes with opening a script.
 *   - The manifest is a few hundred bytes. `releases/latest` on the GitHub API
 *     is ~24 KB of asset metadata for the one field we want.
 *
 * The decision itself is a pure function of stored state, so the "shows once"
 * guarantee is proven in updateCheck.test.ts rather than asserted here.
 */

import { getOS, isWeb, openExternal } from './platform';
import { getAppVersion } from './diagnostics';

/** Published by deploy-manual.yml alongside the landing page. */
const MANIFEST_URL =
  'https://proteus-technologies-private-limited.github.io/OpenDraft/updates.json';

const KEY_LAST_CHECK = 'opendraft:updateLastCheck';
const KEY_LATEST = 'opendraft:updateLatestSeen';
const KEY_DISMISSED = 'opendraft:updateDismissedVersion';
const KEY_SNOOZED = 'opendraft:updateSnoozedUntil';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Longest a stored "latest version" is trusted before asking again. */
export const CHECK_INTERVAL_MS = DAY_MS;
/** How long "Remind me later" keeps the notice down. */
export const SNOOZE_MS = DAY_MS;
/** A check that cannot answer promptly is not worth holding a socket for. */
const FETCH_TIMEOUT_MS = 8000;

/**
 * Which download or store page this build should send someone to.
 *
 * Set at build time per CI job, because it cannot be told from the running
 * app: the Mac App Store build and the .dmg are the same binary on the same
 * OS, and pointing an App Store copy at a .dmg is both wrong and something
 * Apple objects to. The OS fallback is only for local and unset builds.
 */
export type UpdateChannel =
  | 'dmg' | 'mas' | 'ios' | 'play' | 'apk' | 'win' | 'linux' | 'web';

export interface AvailableUpdate {
  version: string;
  /** Where Update sends them — a store listing or a direct download. */
  url: string;
}

// ── Pure logic ───────────────────────────────────────────────────────────────

/**
 * Compares dotted numeric versions. Returns >0 when `a` is newer.
 *
 * Missing components count as zero so "2.0" and "2.0.0" are equal, and any
 * non-numeric component is treated as zero rather than throwing — a malformed
 * manifest should mean "no notice", never a crash on startup.
 */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] ?? '0', 10) || 0;
    const nb = parseInt(pb[i] ?? '0', 10) || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

export interface NoticeState {
  currentVersion: string;
  /** Newest version known, from cache or a fresh check. */
  latestVersion: string | null;
  /** The version Dismiss silenced, if any. */
  dismissedVersion: string | null;
  /** Epoch ms until which Remind me later applies. */
  snoozedUntil: number | null;
  now: number;
}

export type NoticeDecision =
  | { show: true; version: string }
  | { show: false; reason: 'unknown' | 'up-to-date' | 'dismissed' | 'snoozed' };

/**
 * Whether the notice should be on screen. The order matters: "dismissed" is
 * checked against the specific version so a newer release escapes it, while
 * the snooze is a blanket hold that any version waits out.
 */
export function decideNotice(s: NoticeState): NoticeDecision {
  if (!s.latestVersion) return { show: false, reason: 'unknown' };
  if (compareVersions(s.latestVersion, s.currentVersion) <= 0) {
    return { show: false, reason: 'up-to-date' };
  }
  if (s.dismissedVersion && compareVersions(s.latestVersion, s.dismissedVersion) <= 0) {
    return { show: false, reason: 'dismissed' };
  }
  if (s.snoozedUntil !== null && s.now < s.snoozedUntil) {
    return { show: false, reason: 'snoozed' };
  }
  return { show: true, version: s.latestVersion };
}

/**
 * Whether to spend a network request now.
 *
 * Nothing is asked while the notice is snoozed — the answer could not be
 * shown — and nothing is asked again inside the throttle window, which is what
 * keeps repeated launches free.
 */
export function shouldFetch(
  lastCheck: number | null,
  snoozedUntil: number | null,
  now: number,
): boolean {
  if (snoozedUntil !== null && now < snoozedUntil) return false;
  if (lastCheck === null) return true;
  return now - lastCheck >= CHECK_INTERVAL_MS;
}

// ── Stored state ─────────────────────────────────────────────────────────────

/** localStorage throws outright in some private-browsing modes. */
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* A notice that cannot remember its state is still better than a crash. */
  }
}

function readNumber(key: string): number | null {
  const raw = read(key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// ── Channel and manifest ─────────────────────────────────────────────────────

export function resolveChannel(): UpdateChannel {
  const declared = String(import.meta.env.VITE_OPENDRAFT_CHANNEL || '').trim();
  if (declared) return declared as UpdateChannel;

  if (isWeb()) return 'web';
  switch (getOS()) {
    case 'ios': return 'ios';
    // Sideloaded APKs cannot be told from Play installs without asking
    // Android, and the Play listing is the harmless answer for both.
    case 'android': return 'play';
    case 'windows': return 'win';
    case 'linux': return 'linux';
    case 'macos': return 'dmg';
    default: return 'web';
  }
}

interface Manifest {
  channels?: Record<string, { version?: string; url?: string } | undefined>;
}

/**
 * Reads the published manifest. Resolves to null on any failure — offline,
 * blocked, malformed, slow — because a failed update check is not something a
 * writer should ever be told about.
 */
async function fetchManifest(channel: UpdateChannel): Promise<AvailableUpdate | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as Manifest;
    const entry = data.channels?.[channel];
    if (!entry?.version || !entry?.url) return null;
    return { version: entry.version, url: entry.url };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

/** Remind me later: timestamped, so it comes back without a relaunch. */
export function snoozeUpdate(now: number = Date.now()): void {
  write(KEY_SNOOZED, String(now + SNOOZE_MS));
}

/** Dismiss: silent for this version, and only this one. */
export function dismissUpdate(version: string): void {
  write(KEY_DISMISSED, version);
}

/**
 * Update: open the page, then snooze rather than dismiss. They may not go
 * through with it, and the store cannot tell us whether they did.
 */
export async function openUpdatePage(update: AvailableUpdate): Promise<void> {
  snoozeUpdate();
  try {
    await openExternal(update.url);
  } catch (err) {
    console.warn('[updateCheck] could not open the update page:', err);
  }
}

// ── Entry point ─────────────────────────────────────────────────────────────

/** StrictMode mounts effects twice in development; one check per launch. */
let started = false;

/** Same publish/subscribe shape as Toast, so the banner can be told from
 *  anywhere — the launch check, or Help → Check for Updates. */
const listeners: Array<(u: AvailableUpdate) => void> = [];

export function onUpdateAvailable(fn: (u: AvailableUpdate) => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function announce(update: AvailableUpdate): void {
  listeners.forEach((fn) => fn(update));
}

function cachedLatest(): AvailableUpdate | null {
  const raw = read(KEY_LATEST);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AvailableUpdate;
    return parsed?.version && parsed?.url ? parsed : null;
  } catch {
    return null;
  }
}

export type CheckOutcome =
  /** Newer version found; the banner has been told. */
  | { status: 'available'; update: AvailableUpdate }
  | { status: 'up-to-date'; version: string }
  /** Offline, blocked, or the manifest was unreadable. */
  | { status: 'unreachable' };

/**
 * Runs a check and reports what came of it.
 *
 * `force` is the Help menu's manual check: it ignores the throttle, the
 * snooze and any dismissal, because someone who asks deserves an answer — and
 * unlike the silent launch check it must be able to say when it could not
 * reach the manifest, rather than leaving the menu looking broken.
 */
export async function checkForUpdate(force = false): Promise<CheckOutcome> {
  const current = getAppVersion();
  if (isWeb() && !force) return { status: 'up-to-date', version: current };

  const now = Date.now();
  let latest = cachedLatest();
  let reached = latest !== null;

  if (force || shouldFetch(readNumber(KEY_LAST_CHECK), readNumber(KEY_SNOOZED), now)) {
    const fetched = await fetchManifest(resolveChannel());
    // Only a successful check advances the throttle, so a spell offline does
    // not buy the next attempt another day of silence.
    if (fetched) {
      latest = fetched;
      reached = true;
      write(KEY_LAST_CHECK, String(now));
      write(KEY_LATEST, JSON.stringify(fetched));
    } else if (force) {
      // A manual check has nothing useful to say from a stale cache.
      reached = false;
    }
  }

  if (!reached || !latest) return { status: 'unreachable' };

  const decision = decideNotice({
    currentVersion: current,
    latestVersion: latest.version,
    dismissedVersion: force ? null : read(KEY_DISMISSED),
    snoozedUntil: force ? null : readNumber(KEY_SNOOZED),
    now,
  });

  if (decision.show) {
    announce(latest);
    return { status: 'available', update: latest };
  }
  return { status: 'up-to-date', version: current };
}

/**
 * Schedules the launch check for when the app is otherwise idle, so it never
 * competes with opening a script. Safe to call more than once.
 */
export function scheduleUpdateCheck(): void {
  if (started || isWeb()) return;
  started = true;

  const run = () => {
    checkForUpdate().catch((err) =>
      console.warn('[updateCheck] check failed:', err));
  };

  const idle = (window as any).requestIdleCallback;
  if (typeof idle === 'function') idle(run, { timeout: 10000 });
  else setTimeout(run, 3000);
}

/** Test seam — resets the once-per-launch guard. */
export function __resetForTests(): void {
  started = false;
  listeners.length = 0;
}
