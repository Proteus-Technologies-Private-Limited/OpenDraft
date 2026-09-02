/**
 * The update notice's whole value is that it stays quiet (issue #106), so the
 * quiet is what is tested: shown once, gone for good on Dismiss, back after
 * the snooze, and never asking the network more than it has to.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  compareVersions,
  decideNotice,
  shouldFetch,
  checkForUpdate,
  onUpdateAvailable,
  snoozeUpdate,
  dismissUpdate,
  __resetForTests,
  CHECK_INTERVAL_MS,
  SNOOZE_MS,
} from './updateCheck';

const NOW = 1_760_000_000_000;

/** A writer on 1.0.0 with 1.1.0 published, nothing dismissed or snoozed. */
const fresh = (over: Partial<Parameters<typeof decideNotice>[0]> = {}) => ({
  currentVersion: '1.0.0',
  latestVersion: '1.1.0',
  dismissedVersion: null,
  snoozedUntil: null,
  now: NOW,
  ...over,
});

describe('compareVersions', () => {
  it('orders releases', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.1.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('treats missing components as zero', () => {
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('2.0.1', '2.0')).toBeGreaterThan(0);
  });

  it('sorts 2.0.0 above the App Store 1.8, and above 0.26.3', () => {
    // The unification this release performs: both old numbers must be behind.
    expect(compareVersions('2.0.0', '1.8')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '0.26.3')).toBeGreaterThan(0);
    // Numeric, not lexical — "0.26.3" must not beat "0.9.0" as a string would.
    expect(compareVersions('0.26.3', '0.9.0')).toBeGreaterThan(0);
  });

  it('never throws on a malformed manifest', () => {
    expect(() => compareVersions('', 'x.y.z')).not.toThrow();
    expect(compareVersions('x.y.z', '0.0.0')).toBe(0);
  });
});

describe('decideNotice', () => {
  it('shows when a newer version exists', () => {
    expect(decideNotice(fresh())).toEqual({ show: true, version: '1.1.0' });
  });

  it('says nothing when up to date or ahead', () => {
    expect(decideNotice(fresh({ latestVersion: '1.0.0' })).show).toBe(false);
    expect(decideNotice(fresh({ latestVersion: '0.9.0' })).show).toBe(false);
  });

  it('says nothing when the check has never answered', () => {
    expect(decideNotice(fresh({ latestVersion: null }))).toEqual({
      show: false, reason: 'unknown',
    });
  });

  // ── The issue's own worked example ────────────────────────────────────────
  it('never speaks about a dismissed version again', () => {
    const dismissed = fresh({ dismissedVersion: '1.1.0' });
    expect(decideNotice(dismissed)).toEqual({ show: false, reason: 'dismissed' });
    // Not just now — a year of launches later, still silent.
    expect(decideNotice({ ...dismissed, now: NOW + 365 * 24 * 3600_000 }).show).toBe(false);
  });

  it('speaks once more when a newer version than the dismissed one arrives', () => {
    expect(decideNotice(fresh({ latestVersion: '2.0.0', dismissedVersion: '1.1.0' })))
      .toEqual({ show: true, version: '2.0.0' });
  });

  it('stays silent for a version older than the one dismissed', () => {
    // A storefront rolling back, or a stale cache: dismissing 1.2.0 covers it.
    expect(decideNotice(fresh({ latestVersion: '1.1.0', dismissedVersion: '1.2.0' })).show)
      .toBe(false);
  });

  // ── Remind me later ───────────────────────────────────────────────────────
  it('holds its tongue for the whole snooze, without needing a relaunch', () => {
    const snoozedUntil = NOW + SNOOZE_MS;
    expect(decideNotice(fresh({ snoozedUntil })).show).toBe(false);
    expect(decideNotice(fresh({ snoozedUntil, now: NOW + SNOOZE_MS - 1 })).show).toBe(false);
  });

  it('comes back on its own the moment the snooze expires', () => {
    const snoozedUntil = NOW + SNOOZE_MS;
    expect(decideNotice(fresh({ snoozedUntil, now: snoozedUntil })))
      .toEqual({ show: true, version: '1.1.0' });
  });

  it('lets Dismiss win over an active snooze', () => {
    // Snooze then dismiss must not resurrect the notice when the snooze lapses.
    const s = fresh({ dismissedVersion: '1.1.0', snoozedUntil: NOW + SNOOZE_MS });
    expect(decideNotice({ ...s, now: NOW + SNOOZE_MS * 2 }).show).toBe(false);
  });
});

describe('shouldFetch', () => {
  it('checks once on a first run', () => {
    expect(shouldFetch(null, null, NOW)).toBe(true);
  });

  it('does not check again inside the throttle window', () => {
    expect(shouldFetch(NOW, null, NOW)).toBe(false);
    expect(shouldFetch(NOW, null, NOW + CHECK_INTERVAL_MS - 1)).toBe(false);
  });

  it('checks again once the window has passed', () => {
    expect(shouldFetch(NOW, null, NOW + CHECK_INTERVAL_MS)).toBe(true);
  });

  it('spends nothing on the network while snoozed', () => {
    // The answer could not be shown, so it is not worth asking for — this is
    // what keeps a snoozed app from making a daily request for nothing.
    expect(shouldFetch(null, NOW + SNOOZE_MS, NOW)).toBe(false);
    expect(shouldFetch(NOW - CHECK_INTERVAL_MS * 2, NOW + SNOOZE_MS, NOW)).toBe(false);
  });

  it('ten launches in a day cost one request', () => {
    let lastCheck: number | null = null;
    let requests = 0;
    for (let i = 0; i < 10; i++) {
      const now = NOW + i * 2 * 3600_000; // every two hours
      if (shouldFetch(lastCheck, null, now)) { requests++; lastCheck = now; }
    }
    expect(requests).toBe(1);
  });
});

// ── The manual check (Help → Check for Updates) ──────────────────────────────

/** Serves one manifest, counting how often it is actually asked. */
function stubManifest(version: string | null) {
  const calls = { n: 0 };
  vi.stubGlobal('fetch', async () => {
    calls.n++;
    if (version === null) throw new Error('offline');
    return {
      ok: true,
      json: async () => ({ channels: { web: { version, url: 'https://example.test/dl' } } }),
    } as unknown as Response;
  });
  return calls;
}

describe('checkForUpdate (forced)', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetForTests();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('reports up-to-date when nothing newer is published', async () => {
    stubManifest('0.0.1');
    await expect(checkForUpdate(true)).resolves.toMatchObject({ status: 'up-to-date' });
  });

  it('says it could not reach the manifest rather than pretending', async () => {
    // The silent launch check swallows this; a menu item must not.
    stubManifest(null);
    await expect(checkForUpdate(true)).resolves.toEqual({ status: 'unreachable' });
  });

  it('finds an update and tells the banner', async () => {
    stubManifest('999.0.0');
    const seen: string[] = [];
    onUpdateAvailable((u) => seen.push(u.version));
    const outcome = await checkForUpdate(true);
    expect(outcome.status).toBe('available');
    expect(seen).toEqual(['999.0.0']);
  });

  it('answers even when snoozed or dismissed — asking overrides both', async () => {
    stubManifest('999.0.0');
    snoozeUpdate();
    dismissUpdate('999.0.0');
    await expect(checkForUpdate(true)).resolves.toMatchObject({ status: 'available' });
  });

  it('honours the snooze and the throttle when NOT forced', async () => {
    const calls = stubManifest('999.0.0');
    snoozeUpdate();
    // isWeb() is true under test, so the unforced path returns without asking.
    await expect(checkForUpdate()).resolves.toMatchObject({ status: 'up-to-date' });
    expect(calls.n).toBe(0);
  });
});
