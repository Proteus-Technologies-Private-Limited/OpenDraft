import { useEffect, useRef, useState } from 'react';
import { useExternalSaveReview } from '../services/externalSave';
export default function ExternalSaveReview() {
  const request = useExternalSaveReview((s) => s.queue[0]);
  return request ? (
    <Review key={request.id} name={request.name} warnings={request.warnings} />
  ) : null;
}
function Review({ name, warnings }: { name: string; warnings: string[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const answer = useExternalSaveReview((s) => s.answer);
  useEffect(() => {
    dialog.current?.showModal();
    copyButton.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="external-save-title"
      className="external-save-review"
      onCancel={(event) => {
        event.preventDefault();
        answer('cancel');
      }}
    >
      <h2 id="external-save-title">Protect your original screenplay</h2>
      <p>
        OpenDraft cannot guarantee a lossless round trip for{' '}
        <strong>{name}</strong>. Layout, unsupported source metadata, custom
        styles and application-specific information may be changed or omitted.
        Opening successfully does not mean every property can be saved
        faithfully.
      </p>
      {warnings.length > 0 && (
        <>
          <p>Import findings:</p>
          <ul>
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </>
      )}
      <p>
        Save a Copy keeps the original untouched. Overwrite Original first
        creates a verified recovery copy: in <code>.opendraft-originals</code>{' '}
        beside desktop files, or OpenDraft&apos;s <code>source-backups</code>{' '}
        application-data folder on mobile. If backup fails, the source is not
        written.
      </p>
      <label>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />{' '}
        I understand that original information may be lost or changed.
      </label>
      <div className="dialog-actions">
        <button ref={copyButton} onClick={() => answer('copy')}>
          Save a Copy
        </button>
        <button onClick={() => answer('cancel')}>Cancel</button>
        <button disabled={!acknowledged} onClick={() => answer('overwrite')}>
          Overwrite Original
        </button>
      </div>
    </dialog>
  );
}
