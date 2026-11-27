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

/**
 * `http_fetch` used to carry text only: a multipart upload arrived with no body
 * (FastAPI answered 422) and a picture's bytes came back mangled into U+FFFD.
 * Pictures syncing between a device project and the cloud found it.
 */
describe('platformFetch binary bodies', () => {
  beforeEach(() => {
    invoke.mockReset();
    (window as any).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as any).__TAURI_INTERNALS__;
  });

  it('sends FormData as multipart bytes with its boundary', async () => {
    invoke.mockResolvedValue({ status: 200, body: '{"id":"a1"}', encoding: 'text' });
    const { platformFetch, base64ToBytes } = await loadPlatform();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff])], { type: 'image/png' }), 'pic.png');
    const res = await platformFetch('https://open-draft.com/api/projects/p/device-assets/a1', { method: 'PUT', body: form });
    const p = lastPayload();
    expect(p.body).toBeUndefined();
    expect(p.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const sent = new TextDecoder('latin1').decode(base64ToBytes(p.bodyBase64));
    expect(sent).toContain('name="file"; filename="pic.png"');
    expect(sent).toContain('\x89PNG\xff');
    expect(p.timeoutSecs).toBeGreaterThan(10);
    expect(await res.json()).toEqual({ id: 'a1' });
  });

  it('keeps a string body as text with the usual timeout', async () => {
    invoke.mockResolvedValue({ status: 200, body: '{}', encoding: 'text' });
    const { platformFetch } = await loadPlatform();
    await platformFetch('https://open-draft.com/api/x', { method: 'POST', body: '{"a":1}', headers: { 'Content-Type': 'application/json' } });
    const p = lastPayload();
    expect(p.body).toBe('{"a":1}');
    expect(p.bodyBase64).toBeUndefined();
    expect(p.timeoutSecs).toBeUndefined();
  });

  it('returns a base64 response as the original bytes', async () => {
    const { platformFetch, bytesToBase64 } = await loadPlatform();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
    invoke.mockResolvedValue({ status: 200, body: bytesToBase64(bytes), encoding: 'base64', content_type: 'image/png' });
    const res = await platformFetch('https://open-draft.com/api/projects/p/assets/a1', {
      headers: { Accept: 'application/octet-stream, */*' },
    });
    expect(lastPayload().timeoutSecs).toBeGreaterThan(10);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('gives a picture download from the editor or an export the long budget', async () => {
    // useImageSrc and the exporters send PICTURE_ACCEPT; before they did, a
    // few-MB picture on a slow link failed at the default 10 s.
    const { platformFetch, PICTURE_ACCEPT } = await loadPlatform();
    invoke.mockResolvedValue({ status: 200, body: '', encoding: 'text' });
    await platformFetch('https://open-draft.com/api/projects/p/assets/a1', {
      headers: new Headers({ Accept: PICTURE_ACCEPT }),
    });
    expect(lastPayload().timeoutSecs).toBe(300);
  });

  it('accepts a 204 with no body', async () => {
    invoke.mockResolvedValue({ status: 204, body: '', encoding: 'text' });
    const { platformFetch } = await loadPlatform();
    const res = await platformFetch('https://open-draft.com/api/x', { method: 'DELETE' });
    expect(res.status).toBe(204);
  });

  it('round-trips a large buffer through base64', async () => {
    const { bytesToBase64, base64ToBytes } = await loadPlatform();
    const big = new Uint8Array(300_000).map((_, i) => (i * 31) & 0xff);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
});
