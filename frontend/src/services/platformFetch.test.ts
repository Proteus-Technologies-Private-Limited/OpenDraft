import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * `http_fetch` on the Rust side used to accept only Content-Type and
 * Authorization, so every other header a caller set was dropped in transit.
 * `X-Device-Id` was the casualty: collabAuth attaches it to each auth request
 * and backend/app/api/auth.py forwards it to the collab server so a session can
 * be named after the device it came from — but on desktop and mobile it never
 * arrived. These pin the header contract across the invoke boundary.
 */

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

async function loadPlatform() {
  vi.resetModules();
  return await import('./platform');
}

function lastPayload() {
  return invoke.mock.calls.at(-1)?.[1] as Record<string, any>;
}

describe('platformFetch header forwarding', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue({ status: 200, body: '{}' });
    (window as any).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('forwards X-Device-Id from a plain object', async () => {
    const { platformFetch } = await loadPlatform();
    await platformFetch('https://open-draft.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Id': 'dev-123' },
    });
    expect(lastPayload().headers).toEqual({ 'X-Device-Id': 'dev-123' });
  });

  it('forwards X-Device-Id from a Headers instance', async () => {
    const { platformFetch } = await loadPlatform();
    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    headers.set('X-Device-Id', 'dev-456');
    await platformFetch('https://open-draft.com/api/auth/refresh', { method: 'POST', headers });
    // Headers lowercases names; what matters is the value survives the trip.
    const sent = lastPayload().headers;
    const found = Object.entries(sent).find(([k]) => k.toLowerCase() === 'x-device-id');
    expect(found?.[1]).toBe('dev-456');
  });

  it('forwards X-Device-Id from a name/value tuple array', async () => {
    const { platformFetch } = await loadPlatform();
    await platformFetch('https://open-draft.com/api/auth/login', {
      method: 'POST',
      headers: [['Content-Type', 'application/json'], ['X-Device-Id', 'dev-789']],
    });
    expect(lastPayload().headers).toEqual({ 'X-Device-Id': 'dev-789' });
  });

  it('keeps Content-Type and Authorization on their dedicated params, not duplicated', async () => {
    const { platformFetch } = await loadPlatform();
    await platformFetch('https://open-draft.com/api/auth/devices', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok',
        'X-Device-Id': 'dev-1',
      },
    });
    const p = lastPayload();
    expect(p.contentType).toBe('application/json');
    expect(p.authorization).toBe('Bearer tok');
    expect(p.headers).toEqual({ 'X-Device-Id': 'dev-1' });
  });

  it('sends an empty map when there are no extra headers', async () => {
    const { platformFetch } = await loadPlatform();
    await platformFetch('https://open-draft.com/api/demo-info');
    expect(lastPayload().headers).toEqual({});
  });
});
