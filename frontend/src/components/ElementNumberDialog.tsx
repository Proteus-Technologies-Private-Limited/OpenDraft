import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
export default function ElementNumberDialog({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue: string;
  onSave(value: string | null): boolean;
  onClose(): void;
}) {
  const { t } = useTranslation(['editor', 'common']);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    input.current?.focus();
    input.current?.select();
  }, []);
  function save(number: string | null) {
    if (onSave(number)) onClose();
    else
      setError(t('elementNumber.conflict'));
  }
  return (
    <dialog
      ref={dialog}
      className="element-number-dialog"
      aria-labelledby="element-number-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(value.trim() || null);
        }}
      >
        <h2 id="element-number-title">{t('elementNumber.title')}</h2>
        <p>{t('elementNumber.description')}</p>
        <label htmlFor="element-number-input">{t('elementNumber.number')}</label>
        <input
          id="element-number-input"
          ref={input}
          value={value}
          maxLength={40}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
        />
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={() => save(null)}>
            {t('elementNumber.useAutomatic')}
          </button>
          <button type="button" onClick={onClose}>
            {t('common:cancel')}
          </button>
          <button type="submit">{t('common:save')}</button>
        </div>
      </form>
    </dialog>
  );
}
