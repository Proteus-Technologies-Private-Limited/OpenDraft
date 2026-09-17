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

vi.mock('../services/authedFetch', () => ({ authedFetch: async () => new Response(null, { status: 404 }) }));

const { resolveImageUrl } = await import('./imageAsset');

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
