import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Signed-in web users were being signed out every so often (reported from a
 * GitHub discussion: "it just keeps kicking me out"). Access tokens last 15
 * minutes and refresh tokens 7 days, but several paths treated an expired
 * access token — or any failed refresh — as the end of the session and threw
 * the refresh token away with it. These pin the rules:
 *
 *   - an expired access token is renewed, never a reason to sign out;
 *   - only a refresh token the server refuses (400/401/403) ends the session;
 *     a rate limit, server error or network failure keeps it;
 *   - a pair another tab rotated is adopted rather than spent again.
 */

const fetchMock = vi.fn();
vi.mock('./platform', () => ({
  platformFetch: (...a: unknown[]) => fetchMock(...a),
}));
vi.mock('../config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config')>()),
  getApiBase: () => 'https://cloud.test/api',
}));

const AUTH_KEY = 'opendraft:collabAuth';
const USER = { id: 'u1', email: 'writer@example.com', displayName: 'Writer', emailVerified: true };

function jwt(expiresInSeconds: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }));
  return `h.${payload}.s`;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function isRefresh(url: unknown): boolean {
  return String(url).endsWith('/auth/refresh');
}

async function load(auth: { accessToken: string | null; refreshToken: string | null }) {
  vi.resetModules();
  localStorage.setItem(AUTH_KEY, JSON.stringify({ ...auth, user: USER }));
  const store = await import('../stores/settingsStore');
  const fetching = await import('./authedFetch');
  const collabAuth = await import('./collabAuth');
  const api = await import('./api');
  return { ...store, ...fetching, ...collabAuth, ...api };
}

describe('session renewal', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renews an expired access token instead of signing out', async () => {
    const m = await load({ accessToken: jwt(-60), refreshToken: 'r1' });
    const fresh = jwt(900);
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: fresh, refreshToken: 'r2' }));

    expect(await m.ensureCollabAuthenticated()).toBe('ok');
    expect(m.useSettingsStore.getState().collabAuth).toMatchObject({ accessToken: fresh, refreshToken: 'r2' });
    expect(JSON.parse(localStorage.getItem(AUTH_KEY)!).refreshToken).toBe('r2');
  });

  it('reports signed-out when there is no session at all', async () => {
    const m = await load({ accessToken: null, refreshToken: null });
    expect(await m.ensureCollabAuthenticated()).toBe('signed-out');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not touch the network while the access token is still good', async () => {
    const m = await load({ accessToken: jwt(900), refreshToken: 'r1' });
    expect(await m.ensureCollabAuthenticated()).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([429, 500, 502, 504])('keeps the session when refresh answers %i', async (status) => {
    const m = await load({ accessToken: jwt(-60), refreshToken: 'r1' });
    fetchMock.mockResolvedValueOnce(json(status, { error: 'busy' }));

    expect(await m.ensureCollabAuthenticated()).toBe('unavailable');
    expect(m.useSettingsStore.getState().collabAuth.refreshToken).toBe('r1');
    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull();
  });

  it('keeps the session when the refresh request cannot reach the server', async () => {
    const m = await load({ accessToken: jwt(-60), refreshToken: 'r1' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    expect(await m.ensureCollabAuthenticated()).toBe('unavailable');
    expect(m.useSettingsStore.getState().collabAuth.refreshToken).toBe('r1');
  });

  it.each([400, 401, 403])('signs out when the server refuses the refresh token (%i)', async (status) => {
    const m = await load({ accessToken: jwt(-60), refreshToken: 'r1' });
    fetchMock.mockResolvedValueOnce(json(status, { error: 'Invalid or expired refresh token' }));

    expect(await m.ensureCollabAuthenticated()).toBe('signed-out');
    expect(m.useSettingsStore.getState().collabAuth.refreshToken).toBeNull();
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
  });

  it('adopts a pair another tab already rotated instead of spending the old one', async () => {
    const m = await load({ accessToken: jwt(-60), refreshToken: 'r1' });
    // Another tab refreshed: localStorage moved on, this tab's memory did not.
    const theirs = jwt(900);
    localStorage.setItem(AUTH_KEY, JSON.stringify({ accessToken: theirs, refreshToken: 'r2', user: USER }));

    expect(await m.ensureCollabAuthenticated()).toBe('ok');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.useSettingsStore.getState().collabAuth).toMatchObject({ accessToken: theirs, refreshToken: 'r2' });
  });

  it('does not sign out when its refresh lost a race to another tab', async () => {
    const m = await load({ accessToken: jwt(-60), refreshToken: 'r1' });
    const theirs = jwt(900);
    fetchMock.mockImplementationOnce(async () => {
      // The other tab rotated r1 while our request was in flight.
      localStorage.setItem(AUTH_KEY, JSON.stringify({ accessToken: theirs, refreshToken: 'r2', user: USER }));
      return json(401, { error: 'Invalid or expired refresh token' });
    });

    expect(await m.ensureCollabAuthenticated()).toBe('ok');
    expect(m.useSettingsStore.getState().collabAuth).toMatchObject({ accessToken: theirs, refreshToken: 'r2' });
  });

  it('collapses parallel renewals onto one refresh request', async () => {
    const m = await load({ accessToken: jwt(-60), refreshToken: 'r1' });
    fetchMock.mockResolvedValueOnce(json(200, { accessToken: jwt(900), refreshToken: 'r2' }));

    const results = await Promise.all([m.ensureCollabAuthenticated(), m.ensureCollabAuthenticated()]);
    expect(results).toEqual(['ok', 'ok']);
    expect(fetchMock.mock.calls.filter(([url]) => isRefresh(url))).toHaveLength(1);
  });

  it('retries a 401 request with the renewed token', async () => {
    const m = await load({ accessToken: jwt(-60), refreshToken: 'r1' });
    const fresh = jwt(900);
    fetchMock
      .mockResolvedValueOnce(json(401, { detail: 'expired' }))
      .mockResolvedValueOnce(json(200, { accessToken: fresh, refreshToken: 'r2' }))
      .mockResolvedValueOnce(json(200, { ok: true }));

    const res = await m.authedFetch('https://cloud.test/api/projects');
    expect(res.status).toBe(200);
    const retried = fetchMock.mock.calls[2][1] as RequestInit;
    expect(new Headers(retried.headers).get('Authorization')).toBe(`Bearer ${fresh}`);
  });

  it('an API 401 after a transient refresh failure keeps the user signed in', async () => {
    const m = await load({ accessToken: jwt(-60), refreshToken: 'r1' });
    fetchMock
      .mockResolvedValueOnce(json(401, { detail: 'expired' }))
      .mockResolvedValueOnce(json(429, { error: 'Too many requests' }));

    const res = await m.authedFetch('https://cloud.test/api/projects');
    // handled=false: no sign-in prompt; the caller reports a retryable error.
    await expect(m.handleNonOkResponse(res, 'API')).rejects.toMatchObject({ status: 401, handled: false });
    expect(m.useSettingsStore.getState().collabAuth.refreshToken).toBe('r1');
  });

  it('an API 401 with no session left still prompts for sign-in', async () => {
    const m = await load({ accessToken: jwt(-60), refreshToken: null });
    await expect(m.handleNonOkResponse(json(401, { detail: 'expired' }), 'API')).rejects.toMatchObject({
      status: 401,
      handled: true,
    });
    expect(m.useSettingsStore.getState().collabAuth.accessToken).toBeNull();
  });
});

describe('cross-tab session sync', () => {
  // The test setup's window swallows listeners; route them to a real target.
  let target: EventTarget;

  beforeEach(() => {
    localStorage.clear();
    target = new EventTarget();
    vi.spyOn(window, 'addEventListener').mockImplementation(
      target.addEventListener.bind(target) as typeof window.addEventListener,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function storageEvent(key: string | null): Event {
    return Object.assign(new Event('storage'), { key });
  }

  it('picks up tokens another tab wrote', async () => {
    vi.resetModules();
    localStorage.setItem(AUTH_KEY, JSON.stringify({ accessToken: 'a1', refreshToken: 'r1', user: USER }));
    const { useSettingsStore } = await import('../stores/settingsStore');

    localStorage.setItem(AUTH_KEY, JSON.stringify({ accessToken: 'a2', refreshToken: 'r2', user: USER }));
    target.dispatchEvent(storageEvent(AUTH_KEY));

    expect(useSettingsStore.getState().collabAuth).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
    expect(useSettingsStore.getState().authVerified).toBe(true);
  });

  it('signs out here when another tab signs out', async () => {
    vi.resetModules();
    localStorage.setItem(AUTH_KEY, JSON.stringify({ accessToken: 'a1', refreshToken: 'r1', user: USER }));
    const { useSettingsStore } = await import('../stores/settingsStore');

    localStorage.removeItem(AUTH_KEY);
    target.dispatchEvent(storageEvent(AUTH_KEY));

    expect(useSettingsStore.getState().collabAuth).toEqual({ accessToken: null, refreshToken: null, user: null });
    expect(useSettingsStore.getState().authVerified).toBe(false);
  });

  it('ignores other keys', async () => {
    vi.resetModules();
    localStorage.setItem(AUTH_KEY, JSON.stringify({ accessToken: 'a1', refreshToken: 'r1', user: USER }));
    const { useSettingsStore } = await import('../stores/settingsStore');

    localStorage.setItem(AUTH_KEY, JSON.stringify({ accessToken: 'a2', refreshToken: 'r2', user: USER }));
    target.dispatchEvent(storageEvent('opendraft:somethingElse'));

    expect(useSettingsStore.getState().collabAuth.accessToken).toBe('a1');
  });
});
