/**
 * Somewhere to put image bytes for a document that has no project yet.
 *
 * `buildImageAttrs` used to embed such an image as a base64 `data:` URL inside
 * the ProseMirror document, because a project is what the asset store is keyed
 * by and there wasn't one. Base64 costs four bytes for every three, so a single
 * phone photo was worth roughly five hundred pages of screenplay — enough on its
 * own to push the payload past the recovery snapshot's size limit, at which
 * point the document silently had no crash protection at all. And nothing ever
 * converted those bytes back, so they rode along through Save As and every save
 * after it, forever.
 *
 * The fix is to give the project-less case a real home, so the document only
 * ever holds a reference. What makes it correct is the ORDER: the bytes are
 * written here and awaited *before* the node that points at them is inserted.
 * By the time a `scratchId` exists in the document, the blob behind it is
 * already durable — so the recovery snapshot's last-moment `pagehide` flush,
 * which has no room to await anything, only ever writes a reference that
 * already resolves.
 *
 * Deliberately NOT part of the `api` object swap (services/api):
 *
 *   - every `api` asset method is keyed by a project id, and this is the case
 *     where there isn't one;
 *   - `fallback-storage` throws outright on `uploadAsset`, and that is the most
 *     degraded mode — precisely when crash protection matters most;
 *   - `initStorage()` resolves the SQLite race with a fifteen-second timeout,
 *     and a paste during that window still has to work.
 *
 * `spellchecker.ts` owns its dictionary IndexedDB for the same reasons.
 */

import { uuid } from '../utils/uuid';
import { isTauri } from './platform';
import { extensionForMime } from '../utils/scratchRefs';
import {
  type ScratchAssetMeta,
  type ScratchIndex,
  addEntry,
  parseIndex,
  removeEntry,
  selectForSweep,
} from './scratchAssetIndex';

export type { ScratchAssetMeta } from './scratchAssetIndex';

const INDEX_KEY = 'opendraft:scratch-assets:index';
const ROOT_DIR = 'scratch-assets';
const IDB_NAME = 'opendraft-scratch';
const IDB_STORE = 'blobs';
const IDB_VERSION = 1;

/**
 * Where the bytes actually go. Injected rather than branched inline so the
 * index and sweep logic can be exercised without a filesystem or an IndexedDB —
 * the test environment has neither.
 */
export interface ScratchBackend {
  write(filename: string, bytes: Uint8Array): Promise<void>;
  read(filename: string): Promise<Uint8Array | null>;
  remove(filename: string): Promise<void>;
  /**
   * A URL an `<img>` can load right now, or null when only the async path
   * works. Non-null on Tauri, which is what keeps the node view's Tauri branch
   * synchronous.
   */
  syncUrl(filename: string): string | null;
}

let backend: ScratchBackend | null = null;
let initialized = false;

export function setScratchBackend(b: ScratchBackend | null): void {
  backend = b;
  initialized = b !== null;
}

// ── Index ────────────────────────────────────────────────────────────────────

/**
 * Metadata only — about 120 bytes an image, so a thousand of them is 120 KB and
 * nowhere near the localStorage quota. Keeping it here rather than with the
 * bytes is what lets `getScratchUrlSync` and `getScratchMeta` stay synchronous.
 */
function loadIndex(): ScratchIndex {
  try {
    return parseIndex(localStorage.getItem(INDEX_KEY));
  } catch (err) {
    console.warn('[scratch] could not read the index:', err);
    return {};
  }
}

function saveIndex(index: ScratchIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (err) {
    // The bytes are already written; losing the index entry means the blob is
    // orphaned, not that the image is broken right now.
    console.warn('[scratch] could not write the index:', err);
  }
}

// ── Tauri backend ────────────────────────────────────────────────────────────

async function createTauriBackend(): Promise<ScratchBackend | null> {
  try {
    const { mkdir, writeFile, readFile, remove, exists, BaseDirectory } = await import(
      '@tauri-apps/plugin-fs'
    );
    const { appDataDir } = await import('@tauri-apps/api/path');
    const { convertFileSrc } = await import('@tauri-apps/api/core');

    if (!(await exists(ROOT_DIR, { baseDir: BaseDirectory.AppData }))) {
      await mkdir(ROOT_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
    }
    // Cached so syncUrl can stay synchronous; a window's app-data dir does not
    // change while it is open.
    const baseDir = await appDataDir();

    return {
      async write(filename, bytes) {
        await writeFile(`${ROOT_DIR}/${filename}`, bytes, { baseDir: BaseDirectory.AppData });
      },
      async read(filename) {
        try {
          if (!(await exists(`${ROOT_DIR}/${filename}`, { baseDir: BaseDirectory.AppData }))) {
            return null;
          }
          return await readFile(`${ROOT_DIR}/${filename}`, { baseDir: BaseDirectory.AppData });
        } catch (err) {
          console.warn('[scratch] could not read', filename, err);
          return null;
        }
      },
      async remove(filename) {
        try {
          if (await exists(`${ROOT_DIR}/${filename}`, { baseDir: BaseDirectory.AppData })) {
            await remove(`${ROOT_DIR}/${filename}`, { baseDir: BaseDirectory.AppData });
          }
        } catch (err) {
          console.warn('[scratch] could not remove', filename, err);
        }
      },
      syncUrl(filename) {
        // AppData paths use forward slashes for convertFileSrc on all platforms
        // — same synthesis as file-fallback-storage's getAssetUrl.
        try {
          return convertFileSrc(`${baseDir}/${ROOT_DIR}/${filename}`);
        } catch {
          return null;
        }
      },
    };
  } catch (err) {
    console.warn('[scratch] filesystem backend unavailable:', err);
    return null;
  }
}

// ── IndexedDB backend (web) ──────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE, { keyPath: 'filename' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function createIdbBackend(): ScratchBackend {
  return {
    async write(filename, bytes) {
      const db = await openDb();
      if (!db) throw new Error('IndexedDB is unavailable');
      await new Promise<void>((resolve, reject) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put({ filename, bytes });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
        } catch (err) {
          reject(err);
        }
      });
    },
    async read(filename) {
      const db = await openDb();
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const req = tx.objectStore(IDB_STORE).get(filename);
          req.onsuccess = () => {
            const row = req.result as { bytes?: Uint8Array } | undefined;
            resolve(row?.bytes ? new Uint8Array(row.bytes) : null);
          };
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },
    async remove(filename) {
      const db = await openDb();
      if (!db) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).delete(filename);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    },
    // No synchronous URL on the web; callers fall through to an object URL.
    syncUrl: () => null,
  };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/**
 * Pick and prepare the backend. Never throws: without a scratch store the
 * caller degrades to an inline data URL, which is worse but not broken.
 */
export async function initScratchAssets(): Promise<void> {
  if (initialized) return;
  try {
    backend = isTauri() ? await createTauriBackend() : createIdbBackend();
  } catch (err) {
    console.warn('[scratch] could not initialise the scratch store:', err);
    backend = null;
  }
  initialized = true;
}

// ── Public surface ───────────────────────────────────────────────────────────

/**
 * Store an image and return its metadata, or null when it could not be stored.
 *
 * Never throws. A caller that gets null falls back to embedding the image in the
 * document, so a failure here can never stop the writer adding a picture.
 */
export async function putScratchAsset(
  file: Blob,
  originalName?: string,
): Promise<ScratchAssetMeta | null> {
  return putScratchAssetWithId(uuid(), file, originalName);
}

/**
 * As `putScratchAsset`, but under a caller-chosen id.
 *
 * Restoring a `.odraft` needs this: the document being restored already carries
 * `scratchId` values, so the bytes have to come back under the same ids or every
 * reference in it dangles. Same reason `local-storage.importAsset` exists.
 */
export async function putScratchAssetWithId(
  id: string,
  file: Blob,
  originalName?: string,
): Promise<ScratchAssetMeta | null> {
  await initScratchAssets();
  if (!backend) return null;

  try {
    const mimeType = file.type || 'application/octet-stream';
    const fromName = originalName?.includes('.') ? originalName.split('.').pop() : undefined;
    const ext = (fromName || extensionForMime(mimeType)).toLowerCase().replace(/[^a-z0-9]/g, '');
    const filename = `${id}.${ext || 'bin'}`;
    const bytes = new Uint8Array(await file.arrayBuffer());

    await backend.write(filename, bytes);

    const meta: ScratchAssetMeta = {
      id,
      filename,
      mimeType,
      sizeBytes: bytes.byteLength,
      createdAt: Date.now(),
    };
    // Written only after the bytes are durable, so an index entry never
    // promises a blob that isn't there.
    saveIndex(addEntry(loadIndex(), meta));
    return meta;
  } catch (err) {
    console.warn('[scratch] could not store an image:', err);
    return null;
  }
}

/** Metadata for a stored blob, synchronously. Null when it is unknown. */
export function getScratchMeta(id: string): ScratchAssetMeta | null {
  return loadIndex()[id] ?? null;
}

/**
 * A URL the browser can load right now, or null when only the async path works.
 *
 * Non-null on Tauri once initialised, which is what keeps image rendering
 * synchronous there. Null before init, so callers must treat that as "use the
 * async path" rather than "missing" — that ordering is what removes any race
 * between startup and the first paint of a document full of images.
 */
export function getScratchUrlSync(id: string): string | null {
  if (!backend) return null;
  const meta = loadIndex()[id];
  if (!meta) return null;
  return backend.syncUrl(meta.filename);
}

export async function getScratchBytes(id: string): Promise<Uint8Array | null> {
  await initScratchAssets();
  if (!backend) return null;
  const meta = loadIndex()[id];
  if (!meta) return null;
  return backend.read(meta.filename);
}

/**
 * An object URL for a stored blob, with the matching revoke. Callers must call
 * `revoke()` — every one of them does it in a cleanup or a `finally`.
 */
export async function getScratchObjectUrl(
  id: string,
): Promise<{ url: string; revoke: () => void } | null> {
  const meta = getScratchMeta(id);
  const bytes = await getScratchBytes(id);
  if (!bytes) return null;
  try {
    const blob = new Blob([bytes as BlobPart], { type: meta?.mimeType || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    return { url, revoke: () => URL.revokeObjectURL(url) };
  } catch (err) {
    console.warn('[scratch] could not build an object URL:', err);
    return null;
  }
}

export async function deleteScratchAsset(id: string): Promise<void> {
  await initScratchAssets();
  const index = loadIndex();
  const meta = index[id];
  if (!meta) return;
  if (backend) await backend.remove(meta.filename);
  saveIndex(removeEntry(index, id));
}

/** Every blob currently in the store. */
export function listScratchAssets(): ScratchAssetMeta[] {
  return Object.values(loadIndex());
}

/**
 * Delete blobs that nothing references and that are past the grace period.
 *
 * The keep-set has to be the union across every holder of a document — the live
 * editor, EVERY window's recovery slot, the session stash — because a single
 * localStorage is shared by all of them. Sweeping on a partial keep-set is how
 * one window deletes another window's images.
 */
export async function sweepScratchAssets(opts: {
  keep: Set<string>;
  graceMs?: number;
  capBytes?: number;
}): Promise<{ removed: number; bytesFreed: number }> {
  await initScratchAssets();
  if (!backend) return { removed: 0, bytesFreed: 0 };

  const index = loadIndex();
  const doomed = selectForSweep(index, {
    keep: opts.keep,
    graceMs: opts.graceMs,
    capBytes: opts.capBytes,
    now: Date.now(),
  });
  if (!doomed.length) return { removed: 0, bytesFreed: 0 };

  let next = index;
  let bytesFreed = 0;
  let removed = 0;
  for (const id of doomed) {
    const meta = next[id];
    if (!meta) continue;
    try {
      await backend.remove(meta.filename);
      bytesFreed += meta.sizeBytes || 0;
      removed++;
      next = removeEntry(next, id);
    } catch (err) {
      console.warn('[scratch] could not sweep', id, err);
    }
  }
  saveIndex(next);
  return { removed, bytesFreed };
}
