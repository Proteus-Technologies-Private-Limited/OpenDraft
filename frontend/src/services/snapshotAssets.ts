/**
 * Packing images into a backup snapshot, and putting them back on restore.
 *
 * Images are NOT part of the document. For a project-backed script,
 * `insertImage` stores the bytes under `$APPDATA/assets/<projectId>/` and puts
 * only `{ assetId, projectId, filename }` in the node attrs; a script with no
 * project yet uses the scratch store and a `scratchId` instead. Either way a
 * snapshot that carries just the document restores with every image broken —
 * which is why the .odraft v2 envelope has an `assets` array.
 *
 * Packing is capped: a script with a dozen photos, snapshotted every ten
 * minutes with 25 retained, would otherwise fill a disk. When the cap is hit
 * the snapshot still gets written, `assets_omitted` is set, and the Recover
 * dialog says so rather than silently restoring a broken script.
 */
import type { JSONContent } from '@tiptap/react';
import type { OdraftAsset } from '../utils/odraftFormat';
import { api } from './api';
import { collectScratchIds } from '../utils/scratchRefs';
import { getScratchBytes, getScratchMeta, putScratchAssetWithId } from './scratchAssets';

/** Default ceiling on embedded image bytes per snapshot. */
export const DEFAULT_ASSET_CAP_BYTES = 25 * 1024 * 1024;

interface AssetRef {
  id: string;
  filename: string;
}

function addRef(out: Map<string, AssetRef>, id: unknown, filename: unknown): void {
  if (typeof id !== 'string' || !id) return;
  if (out.has(id)) return;
  out.set(id, { id, filename: typeof filename === 'string' && filename ? filename : id });
}

/**
 * Every asset the payload references: inline screenplay images, title-page
 * images, and character-profile images.
 */
export function collectAssetRefs(content: Record<string, unknown> | null | undefined): AssetRef[] {
  const out = new Map<string, AssetRef>();
  if (!content) return [];

  const walk = (node: JSONContent | null | undefined): void => {
    if (!node || typeof node !== 'object') return;
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (attrs) addRef(out, attrs.assetId, attrs.filename);
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(content as JSONContent);

  // Character profiles keep their portraits as the same asset rows.
  const profiles = content._characterProfiles;
  if (Array.isArray(profiles)) {
    for (const p of profiles) {
      const images = (p as Record<string, unknown>)?.images;
      if (!Array.isArray(images)) continue;
      for (const img of images) {
        if (typeof img === 'string') addRef(out, img, undefined);
        else if (img && typeof img === 'object') {
          const rec = img as Record<string, unknown>;
          addRef(out, rec.assetId ?? rec.id, rec.filename);
        }
      }
    }
  }

  return Array.from(out.values());
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000; // chunked so a large image can't blow the call stack
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

/**
 * Read and base64-encode the referenced assets, stopping at `capBytes`.
 *
 * An asset that fails to read (deleted from disk, permissions) is skipped and
 * marks the result truncated — a snapshot missing one image is far better than
 * no snapshot at all.
 */
export async function packAssets(
  projectId: string,
  refs: AssetRef[],
  capBytes: number = DEFAULT_ASSET_CAP_BYTES,
): Promise<{ assets: OdraftAsset[]; truncated: boolean }> {
  const assets: OdraftAsset[] = [];
  let total = 0;
  let truncated = false;

  const getBytes = (api as unknown as {
    getAssetBytes?: (p: string, a: string) => Promise<Uint8Array>;
  }).getAssetBytes;
  if (typeof getBytes !== 'function') {
    return { assets: [], truncated: refs.length > 0 };
  }

  for (const ref of refs) {
    try {
      const bytes = await getBytes.call(api, projectId, ref.id);
      if (total + bytes.byteLength > capBytes) {
        truncated = true;
        break;
      }
      total += bytes.byteLength;
      assets.push({
        id: ref.id,
        filename: ref.filename,
        mime_type: mimeFor(ref.filename),
        data_base64: toBase64(bytes),
      });
    } catch (err) {
      console.warn('[backup] could not read asset', ref.id, err);
      truncated = true;
    }
  }

  return { assets, truncated };
}

/**
 * Pack the images of a document that has no project.
 *
 * Such a document keeps its images in the scratch store, so `collectAssetRefs`
 * — which only knows about project assets — finds nothing, and `packAssets`
 * has no project to read from. Without this, exporting or backing up an unsaved
 * screenplay would produce a file with every image missing, where it used to
 * carry them (badly) as base64 inside the document itself.
 *
 * Note the ids are the SCRATCH ids, and `unpackScratchAssets` puts them back
 * under the same ones — that is what makes the document's `scratchId`
 * references still resolve after a round trip.
 */
export async function packScratchAssets(
  content: Record<string, unknown> | null | undefined,
  capBytes: number = DEFAULT_ASSET_CAP_BYTES,
): Promise<{ assets: OdraftAsset[]; truncated: boolean }> {
  const ids = Array.from(collectScratchIds(content));
  if (!ids.length) return { assets: [], truncated: false };

  const assets: OdraftAsset[] = [];
  let total = 0;
  let truncated = false;

  for (const id of ids) {
    try {
      const bytes = await getScratchBytes(id);
      if (!bytes) { truncated = true; continue; }
      if (total + bytes.byteLength > capBytes) { truncated = true; break; }
      total += bytes.byteLength;
      const meta = getScratchMeta(id);
      const filename = meta?.filename || id;
      assets.push({
        id,
        filename,
        mime_type: meta?.mimeType || mimeFor(filename),
        data_base64: toBase64(bytes),
      });
    } catch (err) {
      console.warn('[backup] could not read scratch image', id, err);
      truncated = true;
    }
  }

  return { assets, truncated };
}

/**
 * Put packed images back into the scratch store under their original ids, for a
 * document being restored or imported without a project.
 */
export async function unpackScratchAssets(assets: OdraftAsset[]): Promise<number> {
  if (!assets.length) return 0;
  let restored = 0;
  for (const asset of assets) {
    try {
      const bytes = fromBase64(asset.data_base64);
      const blob = new Blob([bytes as BlobPart], { type: asset.mime_type });
      const meta = await putScratchAssetWithId(asset.id, blob, asset.filename);
      if (meta) restored++;
    } catch (err) {
      console.warn('[backup] could not restore scratch image', asset.id, err);
    }
  }
  return restored;
}

/**
 * Write embedded assets back into the project, preserving their ids so the
 * restored document's references still resolve. Failures are logged, not
 * thrown: a restored script with a missing image beats a failed restore.
 */
export async function unpackAssets(projectId: string, assets: OdraftAsset[]): Promise<number> {
  const importAsset = (api as unknown as {
    importAsset?: (p: string, a: { id: string; filename: string; mime_type: string; bytes: Uint8Array }) => Promise<void>;
  }).importAsset;
  if (typeof importAsset !== 'function' || assets.length === 0) return 0;

  let restored = 0;
  for (const asset of assets) {
    try {
      await importAsset.call(api, projectId, {
        id: asset.id,
        filename: asset.filename,
        mime_type: asset.mime_type,
        bytes: fromBase64(asset.data_base64),
      });
      restored++;
    } catch (err) {
      console.warn('[backup] could not restore asset', asset.id, err);
    }
  }
  return restored;
}
