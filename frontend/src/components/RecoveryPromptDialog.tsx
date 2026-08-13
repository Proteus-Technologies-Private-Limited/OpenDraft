/**
 * Offers back the unsaved work a previous session left behind.
 *
 * Shown at most once per run of the app, and only when a recovery snapshot
 * outlived the session that wrote it — the app crashed, iPadOS terminated it
 * while suspended, or the user force-quit (issue #68). A snapshot from the
 * current session is just the document being edited, so it is never offered:
 * the editor is torn down and rebuilt on every visit to Settings or the Beat
 * Board, and checking on mount alone made the prompt interrupt the writer with
 * their own work each time they came back.
 *
 * Restoring is always the user's explicit choice. While the prompt is up the
 * editor is untouched and its snapshot loop is paused, so neither the document
 * on screen nor the recovered one can change under the decision.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  readRecoverableSnapshot,
  clearRecoverySnapshot,
  snapshotMatchesDocument,
  hasSeenRecoveryPrompt,
  markRecoveryPromptSeen,
  type RecoverySnapshot,
} from '../services/recoveryService';
import { relativeTime } from '../utils/relativeTime';

interface Props {
  /** Gates the check until the editor can actually receive a restore. */
  editorReady: boolean;
  currentProjectId: string | null;
  currentScriptId: string | null;
  /** Applies the snapshot to the editor. Owned by ScreenplayEditor. */
  onRestore: (snapshot: RecoverySnapshot) => void;
  /**
   * Raised while the prompt has the screen, so the caller can hold off
   * overwriting the very snapshot being offered. Must be stable.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Raised once, with whether there turned out to be anything to offer. Lets
   * the caller stop holding back the other launch-time dialogs. Must be stable.
   */
  onChecked?: (found: boolean) => void;
}

const RecoveryPromptDialog: React.FC<Props> = ({
  editorReady,
  currentProjectId,
  currentScriptId,
  onRestore,
  onOpenChange,
  onChecked,
}) => {
  const [snapshot, setSnapshot] = useState<RecoverySnapshot | null>(null);
  const [checked, setChecked] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (checked || !editorReady) return;
    setChecked(true);
    if (hasSeenRecoveryPrompt()) {
      onChecked?.(false);
      return;
    }
    try {
      const found = readRecoverableSnapshot();
      onChecked?.(!!found);
      if (!found) return;
      markRecoveryPromptSeen();
      setSnapshot(found);
    } catch (err) {
      // readRecoverableSnapshot already swallows its own failures; this is the
      // last resort so a broken snapshot can never block startup.
      console.warn('[recovery] could not check for recoverable work:', err);
      onChecked?.(false);
    }
  }, [checked, editorReady, onChecked]);

  const open = snapshot !== null;

  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // Told to the caller on the way out too: an unmount mid-decision (the editor
  // being torn down) must not leave snapshotting paused for good.
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  // Focus starts inside the dialog rather than wherever the editor left it, so
  // the first keystroke cannot land in the document behind the overlay.
  useEffect(() => {
    if (!open) return;
    const first = boxRef.current?.querySelector<HTMLElement>('button');
    first?.focus();
  }, [open]);

  const dismiss = useCallback(() => {
    // Deliberately not clearing: the writer said neither "restore" nor
    // "discard", and this session's own snapshot will take the slot over within
    // seconds anyway. Nothing is thrown away on a stray Escape.
    setSnapshot(null);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      dismiss();
      return;
    }
    if (e.key !== 'Tab') return;

    // Keep Tab inside the dialog. Without this it walks straight into the
    // editor underneath, which is the one thing this prompt must not touch.
    const focusable = boxRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!snapshot) return null;

  const isSameDocument = snapshotMatchesDocument(snapshot, currentProjectId, currentScriptId);

  const discard = () => {
    clearRecoverySnapshot();
    setSnapshot(null);
  };

  const restore = () => {
    try {
      onRestore(snapshot);
    } catch (err) {
      console.error('[recovery] restore failed:', err);
    }
    // Cleared either way: the content is now in the editor, where the normal
    // save path owns it, and a snapshot left behind would prompt again on the
    // next launch for work that has already been recovered.
    clearRecoverySnapshot();
    setSnapshot(null);
  };

  return (
    <div className="dialog-overlay" onKeyDown={handleKeyDown}>
      <div
        className="dialog-box"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-dialog-title"
        ref={boxRef}
      >
        <div className="dialog-header" id="recovery-dialog-title">
          Recover unsaved changes?
        </div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 12px' }}>
            OpenDraft found unsaved changes to{' '}
            <strong>{snapshot.title || 'Untitled Screenplay'}</strong> from your
            last session, edited {relativeTime(snapshot.savedAt)}.
          </p>
          {isSameDocument ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted)' }}>
              Restoring replaces what is currently in the editor. Your last saved
              version stays untouched until you save again.
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted)' }}>
              These changes belong to a different screenplay than the one open
              now. Restoring opens them as an unsaved document, so nothing you
              have saved is overwritten — use Save As to keep them.
            </p>
          )}
        </div>
        <div className="dialog-footer" style={{ display: 'flex', gap: 8 }}>
          <button className="dialog-btn" onClick={discard}>
            Discard
          </button>
          <div style={{ flex: 1 }} />
          <button className="dialog-btn dialog-btn-primary" onClick={restore} autoFocus>
            Restore
          </button>
        </div>
      </div>
    </div>
  );
};

export default RecoveryPromptDialog;
