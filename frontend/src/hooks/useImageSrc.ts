/**
 * Turning image node attrs into something an `<img>` can load.
 *
 * There are four ways an image can be stored and they resolve very differently,
 * which is why this had grown three near-identical copies — the editor node
 * view, the title-page thumbnail, and the exporters' own resolver. They drifted:
 * only one of them knew about the scratch store, so a title-page image on the
 * web rendered a raw sentinel string.
 *
 * Resolution order, and why:
 *
 *   1. `src` — a legacy inline data URL. Loads directly, synchronously.
 *   2. `scratchId` — bytes in the scratch store. On Tauri this resolves
 *      synchronously through `convertFileSrc`, which is what keeps a document
 *      full of images from flashing empty on open. On the web it needs an
 *      object URL, so it falls through to the async path.
 *   3. `assetId` + `projectId` on Tauri — synchronous `asset://` URL.
 *   4. `assetId` + `projectId` on the web — the asset endpoint requires a bearer
 *      token that a bare `<img src>` cannot send, so the bytes are fetched with
 *      auth and handed over as a blob URL.
 *
 * `missing` is deliberately part of the result. A scratch blob can be legitimately
 * unreachable — a `.odraft` opened on another machine, or a blob swept after its
 * document was abandoned — and callers should show a placeholder at the stored
 * size rather than let the browser collapse a broken image and shift pagination.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { authedFetch } from '../services/authedFetch';
import { isTauri } from '../services/platform';
import { getScratchObjectUrl, getScratchUrlSync } from '../services/scratchAssets';

export interface ImageSrcAttrs {
  assetId?: string | null;
  projectId?: string | null;
  scratchId?: string | null;
  filename?: string | null;
  src?: string | null;
}

export interface ImageSrcResult {
  /** URL to put on the `<img>`, or '' while resolving or unresolvable. */
  url: string;
  /** True once we know there is nothing to show. */
  missing: boolean;
}

export function useImageSrc(attrs: ImageSrcAttrs): ImageSrcResult {
  const src = attrs.src ?? null;
  const scratchId = attrs.scratchId ?? null;
  const assetId = attrs.assetId ?? null;
  const projectId = attrs.projectId ?? null;
  const filename = attrs.filename ?? null;

  // Everything resolvable without awaiting. Computed first so the common cases
  // paint on the first render.
  const syncUrl = useMemo(() => {
    if (src) return src;
    if (scratchId) {
      const url = getScratchUrlSync(scratchId);
      if (url) return url;
    }
    if (assetId && projectId && isTauri()) {
      try {
        return api.getAssetUrl(projectId, assetId, filename || undefined);
      } catch {
        return '';
      }
    }
    return '';
  }, [src, scratchId, assetId, projectId, filename]);

  // Which image the async result belongs to. Stored alongside the result rather
  // than cleared at the top of the effect: resetting state synchronously there
  // costs a cascading render on every attr change, and a stale result is already
  // detectable by comparing keys.
  const key = `${scratchId ?? ''}|${assetId ?? ''}|${projectId ?? ''}|${filename ?? ''}`;
  const [resolved, setResolved] = useState<{ key: string; url: string; failed: boolean } | null>(null);
  const current = resolved && resolved.key === key ? resolved : null;

  useEffect(() => {
    if (syncUrl) return;

    let revoke: (() => void) | null = null;
    let cancelled = false;
    const setAsyncUrl = (url: string) => setResolved({ key, url, failed: false });
    const setFailed = (failed: boolean) => setResolved({ key, url: '', failed });

    (async () => {
      try {
        // Scratch bytes on the web, or on Tauri before the store has finished
        // initialising — `getScratchUrlSync` returns null in both cases, which
        // is why it means "use the async path" rather than "missing".
        if (scratchId) {
          const got = await getScratchObjectUrl(scratchId);
          if (!got) { if (!cancelled) setFailed(true); return; }
          revoke = got.revoke;
          if (cancelled) { got.revoke(); return; }
          setAsyncUrl(got.url);
          return;
        }

        if (assetId && projectId) {
          const res = await authedFetch(api.getAssetUrl(projectId, assetId, filename || undefined));
          if (!res.ok) { if (!cancelled) setFailed(true); return; }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          revoke = () => URL.revokeObjectURL(url);
          if (cancelled) { revoke(); return; }
          setAsyncUrl(url);
          return;
        }

        if (!cancelled) setFailed(true);
      } catch (err) {
        console.warn('[image] could not resolve an image:', err);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (revoke) revoke();
    };
  }, [syncUrl, key, scratchId, assetId, projectId, filename]);

  const url = syncUrl || current?.url || '';
  // Nothing referenced at all is also "missing" — an image node with no source
  // is exactly the broken state the placeholder exists for.
  const nothingReferenced = !src && !scratchId && !(assetId && projectId);
  return { url, missing: !url && (current?.failed === true || nothingReferenced) };
}
