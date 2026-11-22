import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platform', () => ({
  getOS: vi.fn(() => 'ios'),
  isMobileTauri: vi.fn(() => true),
  isTauri: vi.fn(() => true),
  openExternal: vi.fn(async () => undefined),
}));
vi.mock('./appVersion', () => ({ getAppVersion: vi.fn(() => '2.15.0') }));
const invoke = vi.fn(async (_cmd: string) => true);
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string) => invoke(cmd) }));

import * as platform from './platform';
import {
  REVIEW_RULES,
  freshState,
  loadState,
  openStoreReviewPage,
  recordHappyMoment,
  recordSession,
  requestReviewNow,
  resetReviewTiming,
  shouldRequestReview,
  storeReviewUrl,
  type ReviewState,
} from './storeReview';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 21);
const KEY = 'opendraft.storeReview.v1';

/** A writer who has been around a while and is due. */
const due = (over: Partial<ReviewState> = {}): ReviewState => ({
  ...freshState(NOW - 10 * DAY),
  sessions: REVIEW_RULES.minSessions,
  moments: REVIEW_RULES.minMoments,
  ...over,
});

describe('shouldRequestReview', () => {
  it('asks a writer who has used the app for a while and exported twice', () => {
    expect(shouldRequestReview(due(), NOW, '2.15.0')).toBe(true);
  });

  it('does not ask a new install', () => {
    expect(shouldRequestReview(due({ firstSeen: NOW - 1 * DAY }), NOW, '2.15.0')).toBe(false);
  });

  it('needs enough launches', () => {
    expect(shouldRequestReview(due({ sessions: REVIEW_RULES.minSessions - 1 }), NOW, '2.15.0')).toBe(false);
  });

  it('needs enough exports since the last request', () => {
    expect(shouldRequestReview(due({ moments: REVIEW_RULES.minMoments - 1 }), NOW, '2.15.0')).toBe(false);
  });

  it('asks at most once per version', () => {
    expect(shouldRequestReview(due({ askedVersion: '2.15.0', lastAsked: NOW - 200 * DAY, asks: 1 }), NOW, '2.15.0')).toBe(false);
    expect(shouldRequestReview(due({ askedVersion: '2.14.2', lastAsked: NOW - 200 * DAY, asks: 1 }), NOW, '2.15.0')).toBe(true);
  });

  it('waits out the gap between requests', () => {
    expect(shouldRequestReview(due({ lastAsked: NOW - 30 * DAY, asks: 1, askedVersion: '2.14.2' }), NOW, '2.15.0')).toBe(false);
    expect(shouldRequestReview(due({ lastAsked: NOW - 91 * DAY, asks: 1, askedVersion: '2.14.2' }), NOW, '2.15.0')).toBe(true);
  });

  it('stops after the lifetime cap', () => {
    expect(shouldRequestReview(due({ asks: REVIEW_RULES.maxAsks, lastAsked: NOW - 400 * DAY, askedVersion: '2.1.0' }), NOW, '2.15.0')).toBe(false);
  });
});

describe('storage', () => {
  beforeEach(() => localStorage.clear());

  it('starts a first launch when nothing is stored', () => {
    expect(loadState(NOW)).toEqual(freshState(NOW));
  });

  it('starts again rather than trust corrupt data', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadState(NOW)).toEqual(freshState(NOW));
    localStorage.setItem(KEY, JSON.stringify({ firstSeen: 'yesterday' }));
    expect(loadState(NOW)).toEqual(freshState(NOW));
  });

  it('survives storage that throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    });
    expect(loadState(NOW)).toEqual(freshState(NOW));
    expect(() => recordSession(NOW)).not.toThrow();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });
});

describe('recording', () => {
  beforeEach(() => {
    localStorage.clear();
    invoke.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    resetReviewTiming();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('counts launches and exports on the phone apps', () => {
    recordSession(NOW);
    recordSession(NOW);
    recordHappyMoment(NOW);
    const state = loadState(NOW);
    expect(state.sessions).toBe(2);
    expect(state.moments).toBe(1);
  });

  it('records nothing on desktop or the web', () => {
    vi.mocked(platform.isMobileTauri).mockReturnValueOnce(false);
    recordSession(NOW);
    expect(localStorage.getItem(KEY)).toBeNull();
    vi.mocked(platform.isTauri).mockReturnValueOnce(false);
    recordHappyMoment(NOW);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('asks once, after the delay, when an export makes the writer due', async () => {
    localStorage.setItem(KEY, JSON.stringify(due({ moments: REVIEW_RULES.minMoments - 1 })));
    recordHappyMoment(NOW);
    recordHappyMoment(NOW); // a second export in the window must not queue a second ask
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.delayMs + 10);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('request_store_review');
    const after = loadState(NOW);
    expect(after.asks).toBe(1);
    expect(after.askedVersion).toBe('2.15.0');
    expect(after.moments).toBe(0);
    // Stamped when the ask is made, which is after the delay.
    expect(after.lastAsked).toBe(NOW + REVIEW_RULES.delayMs);
  });

  it('waits until the writer stops typing', async () => {
    const page = new EventTarget();
    vi.stubGlobal('window', page);
    vi.stubGlobal('document', { visibilityState: 'visible', querySelector: () => null });
    localStorage.setItem(KEY, JSON.stringify(due({ moments: REVIEW_RULES.minMoments - 1 })));
    recordHappyMoment(NOW);
    // Back to writing 3.5 s after the export.
    await vi.advanceTimersByTimeAsync(3500);
    page.dispatchEvent(new Event('keydown'));
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.delayMs - 3500 + REVIEW_RULES.retryMs);
    expect(invoke).not.toHaveBeenCalled(); // 7 s: only 3.5 s since the last key
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.retryMs);
    expect(invoke).toHaveBeenCalledTimes(1); // 10 s: quiet for 6.5 s
  });

  it('does not ask over an open dialog, and keeps the exports for next time', async () => {
    let dialog: object | null = {};
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'visible', querySelector: () => dialog });
    localStorage.setItem(KEY, JSON.stringify(due({ moments: REVIEW_RULES.minMoments - 1 })));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    recordHappyMoment(NOW);
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.maxWaitMs + REVIEW_RULES.retryMs);
    expect(invoke).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('stayed busy'));
    const kept = loadState(Date.now());
    expect(kept.asks).toBe(0);
    expect(kept.moments).toBe(REVIEW_RULES.minMoments);
    // The next export, with nothing open, asks.
    dialog = null;
    recordHappyMoment(Date.now());
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.delayMs + 10);
    expect(invoke).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });

  it('asks once the share sheet that covered the app has closed', async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'visible', querySelector: () => null });
    localStorage.setItem(KEY, JSON.stringify(due({ moments: REVIEW_RULES.minMoments - 1 })));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    // The native side reports the app covered twice, then free.
    invoke.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    recordHappyMoment(NOW);
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.delayMs + 10);
    expect(invoke).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.retryMs * 2);
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(loadState(Date.now()).asks).toBe(1);
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.maxWaitMs);
    expect(invoke).toHaveBeenCalledTimes(3); // asked: no more tries
    info.mockRestore();
  });

  it('waits out a share chooser that hides the page, then asks', async () => {
    const page = { visibilityState: 'hidden', querySelectorAll: () => [] as Element[] };
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', page);
    localStorage.setItem(KEY, JSON.stringify(due({ moments: REVIEW_RULES.minMoments - 1 })));
    recordHappyMoment(NOW);
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.delayMs + REVIEW_RULES.retryMs * 3);
    expect(invoke).not.toHaveBeenCalled();
    page.visibilityState = 'visible';
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.retryMs + 10);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('ignores a closed menu left in the page', async () => {
    const hiddenMenu = { getClientRects: () => [] };
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'visible', querySelectorAll: () => [hiddenMenu] });
    localStorage.setItem(KEY, JSON.stringify(due({ moments: REVIEW_RULES.minMoments - 1 })));
    recordHappyMoment(NOW);
    await vi.advanceTimersByTimeAsync(REVIEW_RULES.delayMs + 10);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('does not ask while the app is in the background', async () => {
    localStorage.setItem(KEY, JSON.stringify(due()));
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    expect(await requestReviewNow(NOW)).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not count a request the platform declined to make', async () => {
    localStorage.setItem(KEY, JSON.stringify(due()));
    invoke.mockResolvedValueOnce(false);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    expect(await requestReviewNow(NOW)).toBe(false);
    info.mockRestore();
    expect(loadState(NOW).asks).toBe(0);
  });

  it('swallows a failing native call', async () => {
    localStorage.setItem(KEY, JSON.stringify(due()));
    invoke.mockRejectedValueOnce(new Error('no activity'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(requestReviewNow(NOW)).resolves.toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('store page', () => {
  it('points each phone platform at its own store, and nowhere else', () => {
    expect(storeReviewUrl('ios')).toBe('https://apps.apple.com/app/id6761807809?action=write-review');
    expect(storeReviewUrl('android')).toBe('https://play.google.com/store/apps/details?id=com.proteus.opendraft');
    expect(storeReviewUrl('macos')).toBeNull();
    expect(storeReviewUrl('windows')).toBeNull();
    expect(storeReviewUrl('linux')).toBeNull();
  });

  it('opens the page through the platform opener', async () => {
    expect(await openStoreReviewPage()).toBe(true);
    expect(platform.openExternal).toHaveBeenCalledWith('https://apps.apple.com/app/id6761807809?action=write-review');
  });

  it('reports a failed open instead of throwing', async () => {
    vi.mocked(platform.openExternal).mockRejectedValueOnce(new Error('blocked'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await openStoreReviewPage()).toBe(false);
    err.mockRestore();
  });
});
