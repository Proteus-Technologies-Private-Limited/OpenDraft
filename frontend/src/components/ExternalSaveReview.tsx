import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useExternalSaveReview } from '../services/externalSave';
export default function ExternalSaveReview() {
  const request = useExternalSaveReview((s) => s.queue[0]);
  return request ? (
    <Review key={request.id} name={request.name} warnings={request.warnings} />
  ) : null;
}
function Review({ name, warnings }: { name: string; warnings: string[] }) {
  const { t } = useTranslation(['collab', 'common']);
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
      <h2 id="external-save-title">{t('externalSave.title')}</h2>
      <p>
        <Trans ns="collab" i18nKey="externalSave.intro" values={{ name }} components={{ strong: <strong /> }} />
      </p>
      {warnings.length > 0 && (
        <>
          <p>{t('externalSave.findings')}</p>
          <ul>
            {warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </>
      )}
      <p>
        <Trans ns="collab" i18nKey="externalSave.options" components={{ code: <code /> }} />
      </p>
      <label>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />{' '}
        {t('externalSave.acknowledge')}
      </label>
      <div className="dialog-actions">
        <button ref={copyButton} onClick={() => answer('copy')}>
          {t('externalSave.saveCopy')}
        </button>
        <button onClick={() => answer('cancel')}>{t('common:cancel')}</button>
        <button disabled={!acknowledged} onClick={() => answer('overwrite')}>
          {t('externalSave.overwrite')}
        </button>
      </div>
    </dialog>
  );
}
