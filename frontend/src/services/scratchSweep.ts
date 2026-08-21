/**
 * Deciding which scratch images are safe to delete.
 *
 * Kept apart from the store itself because the keep-set is the dangerous part.
 * Scratch blobs belong to documents that were never saved anywhere, so there is
 * no natural moment to clean up after them — but every holder of such a document
 * lives somewhere different:
 *
 *   - the editor on screen right now;
 *   - EVERY window's crash-recovery slot, because all windows share one
 *     localStorage and the work waiting in a sibling's slot is exactly the work
 *     with no other copy;
 *   - the in-memory session stash, which is where the open document goes while
 *     the writer is in Settings or on the Beat Board.
 *
 * Miss any one of them and the sweep deletes a live image. The grace period in
 * `selectForSweep` is the backstop for whatever this still fails to think of.
 */
import { collectRecoverySnapshotScratchIds } from './recoveryService';
import { sweepScratchAssets } from './scratchAssets';
import { collectScratchIds } from '../utils/scratchRefs';
import { peekSessionDoc } from '../utils/sessionDoc';

/** Supplies the document currently in the editor, when there is one. */
type LiveDocSource = () => unknown | null;

let liveDoc: LiveDocSource = () => null;

/**
 * Register the live document. ScreenplayEditor sets this while it is mounted so
 * the sweeper can see what is on screen without importing the editor.
 */
export function setLiveScratchDocSource(source: LiveDocSource | null): void {
  liveDoc = source ?? (() => null);
}

/** Every scratch id anything currently depends on. */
export function collectKeepSet(): Set<string> {
  const keep = collectRecoverySnapshotScratchIds();

  try {
    const doc = liveDoc();
    if (doc) for (const id of collectScratchIds(doc)) keep.add(id);
  } catch (err) {
    console.warn('[scratch] could not read the open document for the sweep:', err);
  }

  const stashed = peekSessionDoc();
  if (stashed?.doc) for (const id of collectScratchIds(stashed.doc)) keep.add(id);

  return keep;
}

/**
 * Delete unreferenced scratch blobs that are past the grace period.
 *
 * Never runs on the snapshot path and never on the launch critical path — it is
 * housekeeping, and a delayed sweep costs disk while a hasty one costs a
 * picture.
 */
export async function runScratchSweep(): Promise<void> {
  try {
    const result = await sweepScratchAssets({ keep: collectKeepSet() });
    if (result.removed > 0) {
      console.info(
        `[scratch] swept ${result.removed} unused image${result.removed === 1 ? '' : 's'} ` +
          `(${Math.round(result.bytesFreed / 1024)}KB)`,
      );
    }
  } catch (err) {
    console.warn('[scratch] sweep failed:', err);
  }
}

/** Queue a sweep for whenever the app is next idle. Safe to call more than once. */
export function scheduleScratchSweep(delayMs = 5000): void {
  const start = () => { void runScratchSweep(); };
  const idle = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  setTimeout(() => {
    if (typeof idle === 'function') idle(start, { timeout: 10_000 });
    else start();
  }, delayMs);
}
