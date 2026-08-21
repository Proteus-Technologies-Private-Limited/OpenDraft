/**
 * The scratch store's index: which blobs exist, how big they are, and which of
 * them are safe to delete.
 *
 * Kept apart from the store itself (services/scratchAssets) because the
 * bookkeeping is where the dangerous decision lives — sweeping a blob that a
 * document still points at loses the writer an image, and that logic deserves
 * to be testable without a filesystem or an IndexedDB behind it.
 */

export interface ScratchAssetMeta {
  id: string;
  /** `<id>.<ext>` — what the backend actually stores. */
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Epoch ms. Drives the grace period; see selectForSweep. */
  createdAt: number;
}

export type ScratchIndex = Record<string, ScratchAssetMeta>;

/** Blobs younger than this are never swept, however unreferenced they look. */
export const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Safety valve, not a policy. Scratch images belong to documents that were
 * never saved, so there is no natural moment to clean up after; without a
 * ceiling a long-running install could accumulate without bound.
 */
export const DEFAULT_CAP_BYTES = 512 * 1024 * 1024;

/** Parse a stored index, tolerating anything. A corrupt index starts empty. */
export function parseIndex(raw: string | null): ScratchIndex {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ScratchIndex = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue;
      const meta = value as Record<string, unknown>;
      if (typeof meta.id !== 'string' || typeof meta.filename !== 'string') continue;
      out[id] = {
        id: meta.id,
        filename: meta.filename,
        mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : 'application/octet-stream',
        sizeBytes: typeof meta.sizeBytes === 'number' ? meta.sizeBytes : 0,
        createdAt: typeof meta.createdAt === 'number' ? meta.createdAt : 0,
      };
    }
    return out;
  } catch (err) {
    console.warn('[scratch] discarding an unreadable index:', err);
    return {};
  }
}

export function addEntry(index: ScratchIndex, meta: ScratchAssetMeta): ScratchIndex {
  return { ...index, [meta.id]: meta };
}

export function removeEntry(index: ScratchIndex, id: string): ScratchIndex {
  if (!(id in index)) return index;
  const next = { ...index };
  delete next[id];
  return next;
}

export function totalBytes(index: ScratchIndex): number {
  return Object.values(index).reduce((sum, m) => sum + (m.sizeBytes || 0), 0);
}

export interface SweepOptions {
  /** Every id still referenced by any document, in any window. */
  keep: Set<string>;
  /** Blobs newer than this are kept regardless. */
  graceMs?: number;
  capBytes?: number;
  /** Epoch ms; injected so the decision is testable. */
  now: number;
}

/**
 * Which blobs to delete.
 *
 * Two rules, and the order matters:
 *
 *   1. Never touch anything in `keep`, at any age. The keep-set is the union
 *      across the live document, every window's recovery slot, and the session
 *      stash — a blob missing from it that is actually referenced is lost work.
 *   2. Never touch anything inside the grace period, even unreferenced. A
 *      document is briefly "unreferenced" whenever the editor unmounts — a
 *      route change to Settings does it — and an image sitting in the undo
 *      stack after a delete is referenced by nothing at all until it is undone.
 *
 * Only once both hold does size come into it, and then oldest goes first.
 */
export function selectForSweep(index: ScratchIndex, opts: SweepOptions): string[] {
  const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  const capBytes = opts.capBytes ?? DEFAULT_CAP_BYTES;

  const sweepable = Object.values(index)
    .filter((m) => !opts.keep.has(m.id))
    .filter((m) => opts.now - m.createdAt >= graceMs)
    .sort((a, b) => a.createdAt - b.createdAt);

  // Everything that qualifies on both rules goes; the cap only decides whether
  // we additionally have to reach into blobs still inside the grace period.
  const doomed = sweepable.map((m) => m.id);

  const remaining = totalBytes(index) - sweepable.reduce((s, m) => s + (m.sizeBytes || 0), 0);
  if (remaining <= capBytes) return doomed;

  // Over the ceiling even after the ordinary sweep. Take unreferenced blobs
  // oldest-first regardless of age, but never referenced ones.
  let over = remaining - capBytes;
  const young = Object.values(index)
    .filter((m) => !opts.keep.has(m.id))
    .filter((m) => opts.now - m.createdAt < graceMs)
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const m of young) {
    if (over <= 0) break;
    doomed.push(m.id);
    over -= m.sizeBytes || 0;
  }
  return doomed;
}
