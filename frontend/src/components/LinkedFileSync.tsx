/**
 * App-wide part of saving scripts to files on disk (issue #135).
 *
 * - Retries file writes that failed — a network drive that went away — every
 *   minute and whenever the window comes back into focus, so a writer whose
 *   RAID comes back online does not have to do anything.
 * - Asks the one question the sync cannot answer for itself: a linked file was
 *   changed elsewhere while OpenDraft had changes of its own. Neither copy is
 *   thrown away — the one not kept is preserved (services/linkedFiles) — but
 *   only the writer can say which one is the script from now on.
 */
import React, { useEffect } from 'react';
import { useLinkedFileStore } from '../stores/linkedFileStore';
import { isDesktopTauri } from '../services/platform';

const RETRY_INTERVAL_MS = 60_000;
/** Give the app a moment to open its database before the first retry. */
const FIRST_RETRY_DELAY_MS = 5_000;

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

const LinkedFileSync: React.FC = () => {
  const conflict = useLinkedFileStore((s) => s.conflict);
  const answerConflict = useLinkedFileStore((s) => s.answerConflict);

  useEffect(() => {
    if (!isDesktopTauri()) return;
    let running = false;
    const retry = () => {
      if (running) return;
      running = true;
      import('../services/linkedFiles')
        .then((lf) => lf.retryPendingWrites())
        .catch((err) => console.error('[linked-files] retry failed:', err))
        .finally(() => { running = false; });
    };
    const first = setTimeout(retry, FIRST_RETRY_DELAY_MS);
    const timer = setInterval(retry, RETRY_INTERVAL_MS);
    window.addEventListener('focus', retry);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      window.removeEventListener('focus', retry);
    };
  }, []);

  if (!conflict) return null;

  const name = fileName(conflict.path);
  return (
    // No click-outside dismissal: something has to be chosen before either
    // copy can be saved again, and a dialog that vanishes leaves the question
    // open with nobody to answer it.
    <div className="dialog-overlay">
      <div className="dialog-box" role="alertdialog" aria-modal="true" aria-labelledby="linked-conflict-title">
        <div className="dialog-header" id="linked-conflict-title">File Changed Outside OpenDraft</div>
        <div className="dialog-body">
          <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--fd-text)' }}>
            <strong>{name}</strong> was changed by another app or computer since
            OpenDraft last saved it, and <strong>{conflict.scriptTitle}</strong> has
            changes here that the file does not have.
          </p>
          <p style={{ margin: '0 0 8px 0', fontSize: 14, color: 'var(--fd-text)' }}>
            Which version should OpenDraft keep? Neither is lost: if you keep the
            file&apos;s version, OpenDraft&apos;s is saved in Version History; if you
            keep OpenDraft&apos;s, the file&apos;s is saved as a copy next to it.
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--fd-text-muted, var(--fd-text))', wordBreak: 'break-all' }}>
            {conflict.path}
          </p>
        </div>
        <div className="dialog-actions">
          <button onClick={() => answerConflict('library')}>Keep OpenDraft&apos;s Version</button>
          <button className="dialog-primary" onClick={() => answerConflict('file')}>
            Use the File&apos;s Version
          </button>
        </div>
      </div>
    </div>
  );
};

export default LinkedFileSync;
