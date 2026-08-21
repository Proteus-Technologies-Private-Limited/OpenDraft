/**
 * Finding image references inside a save payload, without touching storage.
 *
 * An image can be in a document in one of three states:
 *
 *   - `assetId` + `projectId` — it lives in a project's asset store. Nothing to
 *     do; this is the finished state.
 *   - `scratchId` — the document has no project yet, so the bytes are in the
 *     scratch store (see services/scratchAssets). Still just a reference, so it
 *     costs the recovery snapshot ~120 bytes rather than the whole photo.
 *   - `src` holding a `data:` URL — the legacy shape, and the reason a single
 *     phone photo could push a screenplay past the recovery size limit and
 *     silently leave it with no crash protection at all.
 *
 * Everything here is pure and synchronous: the results drive guards on the save
 * and load paths, which must be able to decide "is there anything to do?"
 * without awaiting anything.
 */
import type { JSONContent } from '@tiptap/react';

/** One image that still has to be turned into a project asset. */
export interface ImagePromotion {
  /** Set when the bytes are already in the scratch store. */
  scratchId: string | null;
  /** Set when the bytes are still inline in the document, as a `data:` URL. */
  dataUrl: string | null;
  /** Best available name for the uploaded file; callers fall back to a default. */
  filename: string | null;
}

function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

/**
 * Walk every node in a payload.
 *
 * Mirrors the traversal in `collectAssetRefs` (services/snapshotAssets), so the
 * title-page node — and any container node added later — is covered without a
 * second list to maintain.
 */
function walkNodes(
  content: unknown,
  visit: (attrs: Record<string, unknown>) => void,
): void {
  const seen = new Set<unknown>();
  const walk = (node: JSONContent | null | undefined): void => {
    if (!node || typeof node !== 'object') return;
    // Payloads are plain JSON, but a caller could hand us a live object graph;
    // a cycle here would hang the editor rather than fail visibly.
    if (seen.has(node)) return;
    seen.add(node);
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (attrs && typeof attrs === 'object') visit(attrs);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(content as JSONContent);
}

/** Every scratch blob this payload depends on. Drives the sweeper's keep-set. */
export function collectScratchIds(content: unknown): Set<string> {
  const out = new Set<string>();
  walkNodes(content, (attrs) => {
    if (typeof attrs.scratchId === 'string' && attrs.scratchId) out.add(attrs.scratchId);
  });
  return out;
}

/**
 * Whether the payload carries image bytes inline. The cheap guard that keeps
 * the legacy migration off the fast path for the overwhelming majority of
 * documents, which have no inline images at all.
 */
export function docHasInlineImageBytes(content: unknown): boolean {
  let found = false;
  walkNodes(content, (attrs) => {
    if (!found && isDataUrl(attrs.src)) found = true;
  });
  return found;
}

/** Whether the payload references the scratch store. */
export function docHasScratchImages(content: unknown): boolean {
  let found = false;
  walkNodes(content, (attrs) => {
    if (!found && typeof attrs.scratchId === 'string' && attrs.scratchId) found = true;
  });
  return found;
}

/**
 * Everything that must become a real asset before this payload can belong to a
 * project. Deduplicated: the same photo pasted twice is one upload.
 */
export function planImagePromotions(content: unknown): ImagePromotion[] {
  const out: ImagePromotion[] = [];
  const seenScratch = new Set<string>();
  const seenData = new Set<string>();

  walkNodes(content, (attrs) => {
    // Already a project asset — nothing to promote.
    if (typeof attrs.assetId === 'string' && attrs.assetId) return;

    const filename = typeof attrs.filename === 'string' && attrs.filename ? attrs.filename : null;

    if (typeof attrs.scratchId === 'string' && attrs.scratchId) {
      if (seenScratch.has(attrs.scratchId)) return;
      seenScratch.add(attrs.scratchId);
      out.push({ scratchId: attrs.scratchId, dataUrl: null, filename });
      return;
    }

    if (isDataUrl(attrs.src)) {
      if (seenData.has(attrs.src)) return;
      seenData.add(attrs.src);
      out.push({ scratchId: null, dataUrl: attrs.src, filename });
    }
  });

  return out;
}

/** File extension for a mime type, for naming a promoted asset. */
export function extensionForMime(mime: string): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    case 'image/svg+xml': return 'svg';
    case 'image/bmp': return 'bmp';
    case 'image/avif': return 'avif';
    default: return 'bin';
  }
}

/**
 * Decode a `data:` URL into raw bytes.
 *
 * Returns null rather than throwing for anything unparseable — a malformed URL
 * in a document is a broken image, not a reason to abort a save.
 */
export function decodeDataUrl(url: string): { bytes: Uint8Array; mime: string } | null {
  if (typeof url !== 'string' || !url.startsWith('data:')) return null;
  const comma = url.indexOf(',');
  if (comma === -1) return null;

  const header = url.slice(5, comma);
  const body = url.slice(comma + 1);
  const isBase64 = /;base64$/i.test(header);
  const mime = (isBase64 ? header.replace(/;base64$/i, '') : header).split(';')[0] || 'application/octet-stream';

  try {
    if (!isBase64) {
      // Percent-encoded text payload (rare for images, but legal).
      const text = decodeURIComponent(body);
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
      return { bytes, mime };
    }
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, mime };
  } catch (err) {
    console.warn('[scratch] could not decode an inline image:', err);
    return null;
  }
}
