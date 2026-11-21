/**
 * Asking for a store rating — at a good moment, rarely, and only on the phone
 * and tablet apps that have a store to rate in.
 *
 * The request itself is the platform's own sheet (StoreKit on iOS, Google
 * Play's in-app review on Android), never a dialog of ours. Apple's guideline
 * 5.6.1 asks apps to use that API, and both stores forbid steering people to a
 * rating depending on how they feel about the app, so there is no "Enjoying
 * OpenDraft?" question in front of it either. The platform also rations the
 * sheet itself and never says whether it appeared, so this only decides when
 * it is worth asking.
 *
 * Privacy: OpenDraft promises no tracking, so everything here is a handful of
 * counters kept in this device's localStorage. Nothing is sent anywhere.
 */
import { getOS, isMobileTauri, isTauri, openExternal } from './platform';
import { getAppVersion } from './appVersion';

export interface ReviewState {
  /** When the app was first seen on this device, ms since the epoch. */
  firstSeen: number;
  /** Launches. */
  sessions: number;
  /** Exports completed since the last request — what the writer was glad to get done. */
  moments: number;
  /** When a request was last made, or null. */
  lastAsked: number | null;
  /** The app version that last asked, so one version asks once. */
  askedVersion: string | null;
  /** Requests ever made. */
  asks: number;
}

/** Tuned for "has used it for a while", not "just installed it". */
export const REVIEW_RULES = {
  minSessions: 4,
  minDays: 5,
  /** Exports since the last request. */
  minMoments: 2,
  minGapDays: 90,
  /** Apple allows three a year anyway; stop well before that matters. */
  maxAsks: 3,
  /** Let a share sheet or the export confirmation finish before asking. */
  delayMs: 4000,
  /** Typing, tapping or scrolling this recently means the writer is busy. */
  idleMs: 4000,
  /** How often to look again while the writer is busy. */
  retryMs: 3000,
  /** Give up after this long; the exports stay counted for the next one. */
  maxWaitMs: 60000,
} as const;

const DAY = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'opendraft.storeReview.v1';

export function freshState(now: number): ReviewState {
  return { firstSeen: now, sessions: 0, moments: 0, lastAsked: null, askedVersion: null, asks: 0 };
}

/** The whole decision, free of storage and platform so it can be tested. */
export function shouldRequestReview(state: ReviewState, now: number, version: string): boolean {
  if (state.asks >= REVIEW_RULES.maxAsks) return false;
  if (state.askedVersion === version) return false;
  if (state.lastAsked !== null && now - state.lastAsked < REVIEW_RULES.minGapDays * DAY) return false;
  if (now - state.firstSeen < REVIEW_RULES.minDays * DAY) return false;
  if (state.sessions < REVIEW_RULES.minSessions) return false;
  if (state.moments < REVIEW_RULES.minMoments) return false;
  return true;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Reads the counters, treating anything unreadable as a first launch. */
export function loadState(now: number = Date.now()): ReviewState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReviewState>;
      if (parsed && isNumber(parsed.firstSeen)) {
        return {
          firstSeen: parsed.firstSeen,
          sessions: isNumber(parsed.sessions) ? parsed.sessions : 0,
          moments: isNumber(parsed.moments) ? parsed.moments : 0,
          lastAsked: isNumber(parsed.lastAsked) ? parsed.lastAsked : null,
          askedVersion: typeof parsed.askedVersion === 'string' ? parsed.askedVersion : null,
          asks: isNumber(parsed.asks) ? parsed.asks : 0,
        };
      }
    }
  } catch (err) {
    // Blocked or corrupt storage: start again rather than ask on a bad count.
    console.warn('[storeReview] could not read the counters:', err);
  }
  return freshState(now);
}

function saveState(state: ReviewState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[storeReview] could not save the counters:', err);
  }
}

/** Only the iOS and Android apps have a store to rate in. */
export function canRequestReview(): boolean {
  if (!isTauri() || !isMobileTauri()) return false;
  const os = getOS();
  return os === 'ios' || os === 'android';
}

/** Count one launch. Call once when the app starts. */
export function recordSession(now: number = Date.now()): void {
  if (!canRequestReview()) return;
  const state = loadState(now);
  state.sessions += 1;
  saveState(state);
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

// ── Not in the writer's way ──────────────────────────────────────────────
// The sheet covers the app, so it must never land on someone who has gone
// back to writing, or on top of a dialog. The last keystroke, tap or scroll is
// noted (listeners go on only once an export makes a request due) and the
// request waits for a quiet moment.

let lastActivity = 0;
let watchingActivity = false;
const ACTIVITY_EVENTS = ['keydown', 'beforeinput', 'pointerdown', 'touchstart', 'wheel', 'scroll'] as const;

function noteActivity(): void {
  lastActivity = Date.now();
}

function watchActivity(): void {
  if (watchingActivity || typeof window === 'undefined') return;
  watchingActivity = true;
  for (const type of ACTIVITY_EVENTS) window.addEventListener(type, noteActivity, { capture: true, passive: true });
}

function stopWatchingActivity(): void {
  if (!watchingActivity || typeof window === 'undefined') return;
  watchingActivity = false;
  for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, noteActivity, { capture: true });
}

/** A dialog, menu or sheet of ours is open — the writer is in the middle of something. */
function overlayOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], .dialog-overlay, [role="menu"]');
}

/** Whether now is a quiet moment: nothing typed, tapped or scrolled lately, and nothing open. */
export function writerIsIdle(now: number = Date.now()): boolean {
  return now - lastActivity >= REVIEW_RULES.idleMs && !overlayOpen();
}

/** Test hook: forget recorded activity and any pending request. */
export function resetReviewTiming(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  lastActivity = 0;
  stopWatchingActivity();
}

/**
 * Note that the writer just exported a script, then — if they have been around
 * long enough — ask once the moment has passed and the writer is not busy.
 */
export function recordHappyMoment(now: number = Date.now()): void {
  if (!canRequestReview()) return;
  const state = loadState(now);
  state.moments += 1;
  saveState(state);
  if (!shouldRequestReview(state, now, getAppVersion())) return;
  if (pendingTimer) return;
  // The export itself was a tap: the quiet period counts from here.
  lastActivity = Date.now();
  watchActivity();
  const giveUpAt = Date.now() + REVIEW_RULES.maxWaitMs;
  const attempt = () => {
    pendingTimer = null;
    if (!writerIsIdle()) {
      if (Date.now() + REVIEW_RULES.retryMs <= giveUpAt) {
        pendingTimer = setTimeout(attempt, REVIEW_RULES.retryMs);
      } else {
        // Busy the whole time: skip this one. Nothing is marked as asked, so
        // the next export tries again.
        console.info('[storeReview] writer stayed busy; not asking this time');
        stopWatchingActivity();
      }
      return;
    }
    stopWatchingActivity();
    void requestReviewNow();
  };
  pendingTimer = setTimeout(attempt, REVIEW_RULES.delayMs);
}

/**
 * Make the request, if it is still a good time. Returns whether one was made.
 * Re-checks everything because the delay above can span the app going to the
 * background, and a rating sheet over somebody else's app is a wasted request.
 */
export async function requestReviewNow(now: number = Date.now()): Promise<boolean> {
  try {
    if (!canRequestReview()) return false;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
    const version = getAppVersion();
    const state = loadState(now);
    if (!shouldRequestReview(state, now, version)) return false;

    const { invoke } = await import('@tauri-apps/api/core');
    // The native side answers false when something covers the app — a share
    // sheet still open, another app in front — and then nothing is counted.
    const requested = await invoke<boolean>('request_store_review');
    if (!requested) {
      console.info('[storeReview] the app was busy; not asking this time');
      return false;
    }

    // Counted as asked even though the platform may stay silent: that is its
    // rationing, and asking again sooner would not change the answer.
    saveState({
      ...state,
      moments: 0,
      lastAsked: now,
      askedVersion: version,
      asks: state.asks + 1,
    });
    return true;
  } catch (err) {
    // A missed request costs nothing; never bother the writer about it.
    console.warn('[storeReview] request failed:', err);
    return false;
  }
}

/** The app's page in the store it was installed from, opened on its reviews. */
export function storeReviewUrl(os: ReturnType<typeof getOS> = getOS()): string | null {
  if (os === 'ios') return 'https://apps.apple.com/app/id6761807809?action=write-review';
  if (os === 'android') return 'https://play.google.com/store/apps/details?id=com.proteus.opendraft';
  return null;
}

/** Help ▸ Rate OpenDraft — the writer's own, unprompted way to leave a rating. */
export async function openStoreReviewPage(): Promise<boolean> {
  const url = canRequestReview() ? storeReviewUrl() : null;
  if (!url) return false;
  try {
    await openExternal(url);
    return true;
  } catch (err) {
    console.error('[storeReview] could not open the store page:', err);
    return false;
  }
}
