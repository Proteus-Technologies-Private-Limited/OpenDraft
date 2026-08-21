/**
 * Moving a document's images into the project it has just been saved to.
 *
 * A document with no project keeps its images in the scratch store (see
 * scratchAssets); older documents keep them inline as base64 `data:` URLs. Once
 * the document belongs to a project, neither is right: the scratch store is
 * local to this machine and is swept eventually, and inline bytes bloat every
 * save, export and version from then on. Promotion turns both into ordinary
 * project assets.
 *
 * Timing matters more than it looks. This has to run BEFORE the document is
 * first serialized into the new project, or the first stored copy of the script
 * references a scratch id that no other device can resolve — which for a cloud
 * save means another machine can open the script and find every image broken.
 * `SaveAsDialog` therefore calls it between creating the project and building
 * the content, not after the save completes.
 */
import type { Editor } from '@tiptap/react';
import {
  decodeDataUrl,
  extensionForMime,
  planImagePromotions,
  type ImagePromotion,
} from '../utils/scratchRefs';
import { getScratchBytes, getScratchMeta, putScratchAsset } from './scratchAssets';

export interface PromotionResult {
  promoted: number;
  failed: number;
}

/** The bit of `api`/`cloudApi` promotion needs. */
export interface AssetUploadClient {
  uploadAsset?: (projectId: string, file: File, tags?: string[]) => Promise<{ id: string; filename?: string }>;
}

interface ResolvedUpload {
  plan: ImagePromotion;
  assetId: string;
  filename: string;
}

function fileFor(bytes: Uint8Array, mime: string, name: string | null): File {
  const safeName = name && name.includes('.') ? name : `image.${extensionForMime(mime)}`;
  return new File([bytes as BlobPart], safeName, { type: mime });
}

/**
 * Rewrite the attrs of every node matching one of the completed uploads.
 *
 * Matches on `scratchId` / `src` rather than on positions captured earlier: the
 * writer keeps typing while uploads are in flight, so any position recorded
 * before the await may point at a different node by now.
 */
function applyUploads(editor: Editor, projectId: string, uploads: ResolvedUpload[]): void {
  if (!uploads.length || editor.isDestroyed) return;

  const byScratch = new Map<string, ResolvedUpload>();
  const bySrc = new Map<string, ResolvedUpload>();
  for (const u of uploads) {
    if (u.plan.scratchId) byScratch.set(u.plan.scratchId, u);
    else if (u.plan.dataUrl) bySrc.set(u.plan.dataUrl, u);
  }

  const { tr } = editor.state;
  let changed = false;

  editor.state.doc.descendants((node, pos) => {
    const attrs = node.attrs as Record<string, unknown>;
    if (!attrs) return;
    const match =
      (typeof attrs.scratchId === 'string' && byScratch.get(attrs.scratchId)) ||
      (typeof attrs.src === 'string' && bySrc.get(attrs.src)) ||
      null;
    if (!match) return;

    tr.setNodeMarkup(pos, undefined, {
      ...attrs,
      assetId: match.assetId,
      projectId,
      scratchId: null,
      src: null,
      filename: match.filename,
    });
    changed = true;
  });

  if (!changed) return;
  // Undo must not be able to put back a reference to bytes that are no longer
  // the document's own — the scratch blob is swept eventually, the project
  // asset is not.
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

/**
 * Turn every scratch-backed and inline image in the live document into an asset
 * of `projectId`, and rewrite the nodes to point at it.
 *
 * Never throws. A single failed upload leaves that one node exactly as it was —
 * a scratch reference still renders locally, so the writer keeps their image
 * either way — and is reported in `failed` so the caller can say so.
 */
export async function promoteScratchImages(
  editor: Editor | null,
  projectId: string,
  client: AssetUploadClient,
): Promise<PromotionResult> {
  if (!editor || editor.isDestroyed) return { promoted: 0, failed: 0 };

  const plans = planImagePromotions(editor.getJSON());
  if (!plans.length) return { promoted: 0, failed: 0 };

  const upload = client.uploadAsset;
  if (typeof upload !== 'function') {
    // The degraded localStorage backend has no asset store at all. Leaving the
    // images where they are is correct: they still resolve locally.
    console.warn('[scratch] this storage mode cannot hold assets; images stay where they are');
    return { promoted: 0, failed: plans.length };
  }

  const uploads: ResolvedUpload[] = [];
  let failed = 0;

  // Sequential on purpose: a handful of images, often over a phone connection.
  for (const plan of plans) {
    try {
      let bytes: Uint8Array | null = null;
      let mime = 'application/octet-stream';

      if (plan.scratchId) {
        bytes = await getScratchBytes(plan.scratchId);
        mime = getScratchMeta(plan.scratchId)?.mimeType || mime;
      } else if (plan.dataUrl) {
        const decoded = decodeDataUrl(plan.dataUrl);
        if (decoded) { bytes = decoded.bytes; mime = decoded.mime; }
      }

      if (!bytes) { failed++; continue; }

      const asset = await upload.call(
        client,
        projectId,
        fileFor(bytes, mime, plan.filename),
        ['inline-image'],
      );
      uploads.push({
        plan,
        assetId: asset.id,
        filename: asset.filename ?? plan.filename ?? `image.${extensionForMime(mime)}`,
      });
    } catch (err) {
      console.warn('[scratch] could not promote an image:', err);
      failed++;
    }
  }

  applyUploads(editor, projectId, uploads);

  // The scratch blob is deliberately NOT deleted here. Undo can bring the old
  // node back, and the script write that follows can still fail; the sweeper
  // collects it once nothing references it and the grace period has passed.
  return { promoted: uploads.length, failed };
}

/**
 * Move inline `data:` images out of a project-less document and into the scratch
 * store.
 *
 * This is what shrinks a legacy document — or one just restored from a recovery
 * snapshot written by an older build — back under the snapshot size limit, so it
 * regains crash protection without waiting for the writer to save it anywhere.
 */
export async function demoteDataUrlsToScratch(editor: Editor | null): Promise<number> {
  if (!editor || editor.isDestroyed) return 0;

  const plans = planImagePromotions(editor.getJSON()).filter((p) => p.dataUrl);
  if (!plans.length) return 0;

  const moved = new Map<string, { scratchId: string; filename: string }>();
  for (const plan of plans) {
    if (!plan.dataUrl) continue;
    try {
      const decoded = decodeDataUrl(plan.dataUrl);
      if (!decoded) continue;
      const file = fileFor(decoded.bytes, decoded.mime, plan.filename);
      const meta = await putScratchAsset(file, file.name);
      if (!meta) continue;
      moved.set(plan.dataUrl, { scratchId: meta.id, filename: file.name });
    } catch (err) {
      console.warn('[scratch] could not move an inline image out of the document:', err);
    }
  }

  if (!moved.size || editor.isDestroyed) return 0;

  const { tr } = editor.state;
  let changed = false;
  editor.state.doc.descendants((node, pos) => {
    const attrs = node.attrs as Record<string, unknown>;
    if (!attrs || typeof attrs.src !== 'string') return;
    const match = moved.get(attrs.src);
    if (!match) return;
    tr.setNodeMarkup(pos, undefined, {
      ...attrs,
      src: null,
      scratchId: match.scratchId,
      filename: attrs.filename ?? match.filename,
    });
    changed = true;
  });

  if (!changed) return 0;
  // Semantically the same document — this must not add an undo step, and the
  // caller must not mark the document dirty for it.
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
  return moved.size;
}
