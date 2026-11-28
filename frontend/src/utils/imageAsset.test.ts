/**
 * Resolving an image node's attrs for the EXPORTERS.
 *
 * The distinction this file exists to pin: the editor renders an image by
 * putting a URL on an `<img>`, which can open a WebView-internal scheme; the
 * exporters have to get at the bytes, and their only route is `toLoadableUrl`.
 * Handing them a `convertFileSrc` URL looks right and cannot work — on Tauri
 * every fetch goes through a Rust command that answers with a string body typed
 * `application/json`, so no amount of fetching yields image bytes.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/scratchAssets', () => ({
  // A backend that CAN produce a synchronous URL — the Tauri case, and the one
  // that used to win here.
  getScratchUrlSync: (id: string) => `tauri://localhost/scratch/${id}.png`,
  getScratchObjectUrl: async () => null,
}));

vi.mock('../services/api', () => ({
  api: { getAssetUrl: (p: string, a: string) => `https://example.test/api/projects/${p}/assets/${a}` },
}));

const authedFetch = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
  async () => new Response(null, { status: 404 }),
);
vi.mock('../services/authedFetch', () => ({
  authedFetch: (url: string, init?: RequestInit) => authedFetch(url, init),
}));

const { resolveImageUrl, fetchPictureObjectUrl, loadImageData } = await import('./imageAsset');
const { PICTURE_ACCEPT } = await import('../services/platform');

describe('resolveImageUrl', () => {
  it('names a scratch image with the sentinel, never its synchronous URL', () => {
    // The sentinel is what routes the load through the filesystem plugin.
    expect(resolveImageUrl({ scratchId: 's1' })).toBe('scratch:s1');
  });

  it('still prefers a project asset endpoint, which is real HTTP', () => {
    expect(resolveImageUrl({ assetId: 'a1', projectId: 'p1' }))
      .toBe('https://example.test/api/projects/p1/assets/a1');
  });

  it('falls back to an inline data URL, and to nothing at all', () => {
    expect(resolveImageUrl({ src: 'data:image/png;base64,AAA' })).toBe('data:image/png;base64,AAA');
    expect(resolveImageUrl({})).toBeNull();
  });

  it('prefers the project asset over a scratch id when a node carries both', () => {
    // Promotion writes assetId+projectId and clears scratchId, but a document
    // mid-promotion (or restored by undo) can hold both.
    expect(resolveImageUrl({ assetId: 'a1', projectId: 'p1', scratchId: 's1' }))
      .toBe('https://example.test/api/projects/p1/assets/a1');
  });
});

/**
 * The desktop and mobile apps give an http_fetch call 10 s unless its Accept
 * names a picture. The editor's pictures and the exporters' used to send none,
 * so a few-MB picture on a slow link failed at 10 s: a broken picture in the
 * editor and an empty slot in the PDF or Word file.
 */
describe('fetchPictureObjectUrl', () => {
  it('asks for a picture, which is what earns the long transfer budget', async () => {
    authedFetch.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
      status: 200, headers: { 'Content-Type': 'image/png' },
    }));
    const got = await fetchPictureObjectUrl('https://example.test/api/projects/p1/assets/a1', 'image');
    expect(got?.url).toMatch(/^blob:/);
    got?.revoke();
    const init = authedFetch.mock.calls.at(-1)?.[1];
    expect(new Headers(init?.headers).get('Accept')).toBe(PICTURE_ACCEPT);
    expect(PICTURE_ACCEPT).toMatch(/image\//);
  });

  it('says why a picture failed instead of failing silently', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    authedFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await fetchPictureObjectUrl('https://example.test/a', 'export')).toBeNull();
    expect(warn.mock.calls.at(-1)?.[0]).toMatch(/\[export\].*answered 404/);

    authedFetch.mockRejectedValueOnce(new Error('Request to https://example.test/a failed: timed out after 300s'));
    expect(await fetchPictureObjectUrl('https://example.test/a', 'export')).toBeNull();
    expect(warn.mock.calls.at(-1)?.[1]).toMatch(/timed out after 300s/);
    warn.mockRestore();
  });

  it('is the route the exporters load an asset through', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    authedFetch.mockClear();
    authedFetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    expect(await loadImageData('https://example.test/api/projects/p1/assets/a1')).toBeNull();
    expect(new Headers(authedFetch.mock.calls.at(-1)?.[1]?.headers).get('Accept')).toBe(PICTURE_ACCEPT);
    warn.mockRestore();
  });
});
