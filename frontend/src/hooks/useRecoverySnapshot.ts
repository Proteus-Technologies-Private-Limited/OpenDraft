/**
 * Keeps the crash-recovery copy of the open document up to date.
 *
 * Three triggers, for three different failure modes:
 *
 *   - A short debounce after any change, so work is protected seconds after it
 *     is typed. This is the one that matters: the periodic tick alone left a
 *     ten-second hole in which an abrupt kill lost everything written since the
 *     last tick, and a power cut — which fires no lifecycle event at all — could
 *     never be covered by anything else (issue #68, re-opened).
 *   - A slower interval as a backstop, in case a change arrives by a route the
 *     debounce does not see.
 *   - A flush when the page is hidden or torn down. On iOS this is the one
 *     reliable signal before the system suspends and later terminates the app,
 *     and it is why the snapshot is written synchronously to localStorage —
 *     there is no async window to await a database write in.
 *
 * The snapshot is cleared, not written, whenever the document matches what was
 * last saved. Leaving a stale copy behind would prompt the user to "recover"
 * changes they had already saved.
 */
import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import {
  writeRecoverySnapshot,
  clearRecoverySnapshot,
  setRecoveryUnavailableHandler,
  type RecoveryFailureReason,
} from '../services/recoveryService';
import { showToast } from '../components/Toast';
import { docHasAnyText } from '../utils/docText';
import { useEditorStore } from '../stores/editorStore';

/** Backstop sweep, for changes the debounce does not observe. */
const SNAPSHOT_INTERVAL_MS = 10_000;

/**
 * Quiet period after a change before the snapshot is written. Long enough that
 * continuous typing does not serialize the document on every keystroke, short
 * enough that what the writer just typed is on disk before they look away.
 */
const SNAPSHOT_DEBOUNCE_MS = 1_200;

export interface RecoverySnapshotOptions {
  /** Builds the payload to snapshot; returns undefined when there's nothing. */
  buildSaveContent: () => Record<string, unknown> | undefined;
  documentTitle: string;
  projectId: string | null;
  scriptId: string | null;
  /**
   * The live editor, subscribed to for change notifications. Null before it
   * exists; the interval and the hide flush still run.
   */
  editor: Editor | null;
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

/**
 * The parts of the store that belong to the document rather than to the app.
 *
 * All of these are written into the snapshot by `buildSaveContent`, but none of
 * them touch the ProseMirror undo stack — so `hasEdits()`, which asks the editor
 * whether it can undo, reported "nothing changed" for every one of them. A
 * writer who spent an hour on beats, notes, character profiles or page setup and
 * never typed in the script had no recovery copy at all, and worse, the
 * no-changes branch below actively deleted any copy that already existed.
 */
type StoreState = ReturnType<typeof useEditorStore.getState>;

function metadataUnchanged(a: StoreState, b: StoreState): boolean {
  return (
    a.notes === b.notes &&
    a.generalNotes === b.generalNotes &&
    a.tags === b.tags &&
    a.tagCategories === b.tagCategories &&
    a.characterProfiles === b.characterProfiles &&
    a.characterRelationships === b.characterRelationships &&
    a.beats === b.beats &&
    a.beatColumns === b.beatColumns &&
    a.beatArrangeMode === b.beatArrangeMode &&
    a.spellCheckEnabled === b.spellCheckEnabled &&
    a.grammarCheckEnabled === b.grammarCheckEnabled &&
    a.sceneNumbersVisible === b.sceneNumbersVisible &&
    a.sceneNumbersLocked === b.sceneNumbersLocked &&
    a.sceneHeadingSpaceBefore === b.sceneHeadingSpaceBefore &&
    a.pageLayout === b.pageLayout &&
    a.documentTitle === b.documentTitle
  );
}

export function useRecoverySnapshot(opts: RecoverySnapshotOptions): void {
  // Latest values, so the interval doesn't need re-creating on every keystroke.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Content of the last snapshot written, to skip unchanged documents. */
  const lastSnapshotJsonRef = useRef<string>('');
  /** Set when document metadata changes; see metadataUnchanged. */
  const metadataDirtyRef = useRef(false);
  /** Stable handle so the change subscriptions can fire the current capture. */
  const captureRef = useRef<() => void>(() => {});

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
      const edited = current.hasEdits ? current.hasEdits() : true;
      if (!edited && !metadataDirtyRef.current) {
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

      // Never snapshot a blank body on its own. A freshly mounted editor is
      // empty before its content arrives, and storing that would offer to
      // "recover" the document into nothing.
      //
      // Unless the writer has been working on the document's metadata: beats,
      // notes and character profiles are real work, and planning on the Beat
      // Board before writing a word is exactly the session this is here to
      // protect. A mounting editor has no metadata edits, so the guard still
      // does its job.
      if (!docHasAnyText(content) && !metadataDirtyRef.current) return;

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
        metadataDirtyRef.current = false;
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

    captureRef.current = capture;

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

  // A new document starts clean: whatever the load path wrote into the store is
  // the document as it arrived, not an edit to it.
  const { projectId, scriptId } = opts;
  useEffect(() => {
    metadataDirtyRef.current = false;
  }, [projectId, scriptId]);

  /**
   * Say so, once, when this document cannot be protected.
   *
   * The capture loop retries every tick by design, so this has to be told at
   * most once per document or a writer who is over the limit gets a toast every
   * ten seconds for as long as they keep working. Re-armed when the document
   * changes, because the answer can differ per document.
   */
  const warnedRef = useRef(false);
  useEffect(() => {
    warnedRef.current = false;
    setRecoveryUnavailableHandler((reason: RecoveryFailureReason) => {
      if (warnedRef.current) return;
      warnedRef.current = true;
      // Point at something that does work, rather than reporting a failure the
      // writer can do nothing with. Saving to the library hands the document to
      // auto-save, which has no such ceiling.
      showToast(
        reason === 'too-large'
          ? 'This document is too large to protect against a crash. Save it to your library so auto-save takes over.'
          : 'Crash protection is unavailable — there is no room to store a recovery copy. Save your work to your library.',
        'error',
      );
    });
    return () => setRecoveryUnavailableHandler(null);
  }, [projectId, scriptId]);

  // Snapshot shortly after a change rather than up to ten seconds later.
  const { editor } = opts;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        captureRef.current();
      }, SNAPSHOT_DEBOUNCE_MS);
    };

    if (editor) editor.on('update', schedule);

    // Store changes during a load are the document being hydrated, not edited —
    // the load paths hold `scriptSwitchingRef` for exactly that window.
    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      if (metadataUnchanged(state, prev)) return;
      if (optsRef.current.scriptSwitchingRef.current) return;
      metadataDirtyRef.current = true;
      schedule();
    });

    return () => {
      if (timer) clearTimeout(timer);
      if (editor) editor.off('update', schedule);
      unsubscribe();
    };
  }, [editor]);
}
