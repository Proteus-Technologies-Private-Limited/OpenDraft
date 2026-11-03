import { useEffect, useRef, useState } from 'react';
export default function ElementNumberDialog({
  initialValue,
  onSave,
  onClose,
}: {
  initialValue: string;
  onSave(value: string | null): boolean;
  onClose(): void;
}) {
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
      setError(
        'That number is already used in this sequence, or this reference was changed or removed. Check the number or reopen the dialog.',
      );
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
        <h2 id="element-number-title">Edit Element Number</h2>
        <p>
          Set the reference for this element. Existing references stay with
          their text when the script reflows.
        </p>
        <label htmlFor="element-number-input">Number</label>
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
            Use Automatic Number
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit">Save</button>
        </div>
      </form>
    </dialog>
  );
}
