import { api } from '../services/api';
import { authedFetch } from '../services/authedFetch';
import { getScratchObjectUrl, getScratchUrlSync } from '../services/scratchAssets';

interface ImageNodeAttrs {
  assetId?: string | null;
  projectId?: string | null;
  scratchId?: string | null;
  filename?: string | null;
  src?: string | null;
}

/**
 * Marks a URL that only `toLoadableUrl` can open, because the bytes live in the
 * scratch store rather than behind any real URL scheme.
 *
 * `resolveImageUrl` has to stay synchronous — every exporter call site depends
 * on that — so a scratch image that has no synchronous URL (the web, where the
 * bytes are in IndexedDB) is named here and opened during the load step that
 * always follows. That keeps all four exporter call sites unchanged.
 */
const SCRATCH_PREFIX = 'scratch:';

/** Resolve a screenplayImage node's attrs to a loadable URL. */
export function resolveImageUrl(attrs: ImageNodeAttrs): string | null {
  if (attrs.assetId && attrs.projectId) {
    try { return api.getAssetUrl(attrs.projectId, attrs.assetId, attrs.filename ?? undefined); } catch { /* fall through */ }
  }
  if (attrs.scratchId) {
    return getScratchUrlSync(attrs.scratchId) ?? `${SCRATCH_PREFIX}${attrs.scratchId}`;
  }
  return attrs.src ?? null;
}

/** Fetch a (possibly auth-protected) asset URL as a blob object URL. data:/blob:
 *  URLs are returned as-is. The asset endpoint requires a token, which authedFetch
 *  supplies; an <img src> alone would 401. */
async function toLoadableUrl(url: string): Promise<{ url: string; revoke: () => void } | null> {
  if (url.startsWith('data:') || url.startsWith('blob:')) return { url, revoke: () => {} };
  if (url.startsWith(SCRATCH_PREFIX)) {
    return getScratchObjectUrl(url.slice(SCRATCH_PREFIX.length));
  }
  try {
    const res = await authedFetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    return { url: obj, revoke: () => URL.revokeObjectURL(obj) };
  } catch {
    return null;
  }
}

/**
 * Load an image URL into a PNG data URL plus natural dimensions, via a canvas.
 * Fetches with auth so protected asset URLs work; the blob is same-origin so the
 * canvas isn't tainted.
 */
export async function loadImageData(url: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const loadable = await toLoadableUrl(url);
  if (!loadable) return null;
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('image load failed'));
      img.src = loadable.url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return { dataUrl: canvas.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight };
  } catch {
    return null;
  } finally {
    loadable.revoke();
  }
}

/** Raw PNG bytes (for DOCX ImageRun) plus natural dimensions. */
export async function loadImageBytes(url: string): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  const d = await loadImageData(url);
  if (!d) return null;
  const b64 = d.dataUrl.split(',')[1] || '';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { data: bytes, width: d.width, height: d.height };
}
