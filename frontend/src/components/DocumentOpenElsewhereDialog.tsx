/**
 * "This screenplay is already open in another window."
 *
 * Two windows on the same document is not a harmless duplicate: both editors
 * auto-save, so they take turns writing over each other and whichever ticks
 * last wins. Nothing on screen says so — both windows look correct — which
 * makes it exactly the kind of loss a writer only discovers much later.
 *
 * So the window that arrives second says what happened and offers the thing
 * that was probably meant: switch to the window that already has it.
 */
import React from 'react';
import type { OpenElsewhere } from '../services/openDocuments';

interface Props {
  /** The window that already holds the document. */
  other: OpenElsewhere;
  documentTitle: string;
  /** Bring the other window forward and step away from the duplicate. */
  onSwitch: () => void;
  /** Keep both copies open, having been told what that means. */
  onOpenAnyway: () => void;
}

const DocumentOpenElsewhereDialog: React.FC<Props> = ({
  other,
  documentTitle,
  onSwitch,
  onOpenAnyway,
}) => (
  <div className="dialog-overlay">
    <div
      className="dialog-box"
      style={{ maxWidth: 460 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="open-elsewhere-title"
    >
      <div className="dialog-header" id="open-elsewhere-title">
        Already open in another window
      </div>
      <div className="dialog-body">
        <p style={{ margin: '0 0 12px' }}>
          <strong>{documentTitle || other.title || 'This screenplay'}</strong> is
          open in another OpenDraft window.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--fd-text-muted)' }}>
          Editing it in both places means the two windows save over each other,
          and only the last one to save is kept.
        </p>
      </div>
      <div className="dialog-footer" style={{ display: 'flex', gap: 8 }}>
        <button className="dialog-btn" onClick={onOpenAnyway}>
          Open anyway
        </button>
        <div style={{ flex: 1 }} />
        <button className="dialog-btn dialog-btn-primary" onClick={onSwitch} autoFocus>
          Switch to that window
        </button>
      </div>
    </div>
  </div>
);

export default DocumentOpenElsewhereDialog;
