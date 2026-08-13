/**
 * Keeps the crash-recovery copy of the open document up to date.
 *
 * Two triggers, for two different failure modes:
 *
 *   - A short interval, so an abrupt kill (a crash, a power loss, iPadOS
 *     reclaiming memory from a suspended app) loses seconds rather than a
 *     session.
 *   - A flush when the page is hidden or being torn down. On iOS this is the
 *     one reliable signal before the system suspends and later terminates the
 *     app, and it is why the snapshot is written synchronously to localStorage
 *     — there is no async window to await a database write in.
 *
 * The snapshot is cleared, not written, whenever the document matches what was
 * last saved. Leaving a stale copy behind would prompt the user to "recover"
 * changes they had already saved.
 */
import { useEffect, useRef } from 'react';
import {
  writeRecoverySnapshot,
  clearRecoverySnapshot,
} from '../services/recoveryService';
import { docHasAnyText } from '../utils/docText';

/** How often the document is compared against the last snapshot. */
const SNAPSHOT_INTERVAL_MS = 10_000;

export interface RecoverySnapshotOptions {
  /** Builds the payload to snapshot; returns undefined when there's nothing. */
  buildSaveContent: () => Record<string, unknown> | undefined;
  documentTitle: string;
  projectId: string | null;
  scriptId: string | null;
  /**
   * Serialized content of the last successful save, shared with auto-save.
   * The snapshot exists to capture what that has *not* yet persisted, so when
   * the two agree there is nothing worth recovering.
   */
  lastSavedJsonRef: React.MutableRefObject<string>;
  /** Shared with auto-save: true while the editor is swapping documents. */
  scriptSwitchingRef: React.MutableRefObject<boolean>;
  isCollabGuest: boolean;
  isHistoryMode: boolean;
  /**
   * True while the recovery prompt is on screen. Writing then would overwrite
   * the very snapshot the writer is being asked about, with whatever the editor
   * happens to hold behind the dialog.
   */
  isPaused?: boolean;
  /**
   * Whether anything has been changed since the document was loaded. Nothing
   * changed means nothing to recover — see hasEditsSinceLoad.
   */
  hasEdits?: () => boolean;
}

export function useRecoverySnapshot(opts: RecoverySnapshotOptions): void {
  // Latest values, so the interval doesn't need re-creating on every keystroke.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Content of the last snapshot written, to skip unchanged documents. */
  const lastSnapshotJsonRef = useRef<string>('');

  useEffect(() => {
    const capture = () => {
      const current = optsRef.current;

      // A guest is editing someone else's document over the wire and a history
      // view is read-only; neither has unsaved work of its own to protect.
      if (current.isCollabGuest || current.isHistoryMode) return;
      // The prompt is holding the previous session's work; leave the slot alone
      // until the writer has said what to do with it.
      if (current.isPaused) return;

      // Untouched since it was loaded. A snapshot here would offer to "recover"
      // a document the writer never changed — which is what made closing the
      // app from the iPadOS app switcher produce a recovery prompt every single
      // time, however briefly the app had been open.
      if (current.hasEdits && !current.hasEdits()) {
        if (lastSnapshotJsonRef.current !== '') {
          clearRecoverySnapshot();
          lastSnapshotJsonRef.current = '';
        }
        return;
      }
      // Mid-switch the editor briefly holds the wrong document.
      if (current.scriptSwitchingRef.current) return;

      let content: Record<string, unknown> | undefined;
      try {
        content = current.buildSaveContent();
      } catch (err) {
        console.warn('[recovery] could not build the document payload:', err);
        return;
      }
      if (!content) return;

      // Never snapshot a blank body. A freshly mounted editor is empty before
      // its content arrives, and storing that would offer to "recover" the
      // document into nothing.
      if (!docHasAnyText(content)) return;

      let json: string;
      try {
        json = JSON.stringify(content);
      } catch (err) {
        console.warn('[recovery] could not serialize the document:', err);
        return;
      }

      // Everything is already saved — drop any snapshot rather than leave one
      // that would prompt for changes the user does not actually have.
      if (json === current.lastSavedJsonRef.current) {
        if (lastSnapshotJsonRef.current !== '') {
          clearRecoverySnapshot();
          lastSnapshotJsonRef.current = '';
        }
        return;
      }

      if (json === lastSnapshotJsonRef.current) return;

      const stored = writeRecoverySnapshot({
        content,
        title: current.documentTitle || 'Untitled Screenplay',
        projectId: current.projectId,
        scriptId: current.scriptId,
      });
      // Only remember it as written when it was: a document over the size limit
      // must keep retrying, in case an edit brings it back under.
      if (stored) lastSnapshotJsonRef.current = json;
    };

    const onHide = () => {
      // `visibilitychange` fires for a tab switch too, which is harmless — the
      // capture is cheap and idempotent.
      if (document.visibilityState === 'hidden') capture();
    };

    const id = setInterval(capture, SNAPSHOT_INTERVAL_MS);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', capture);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', capture);
    };
  }, []);
}
