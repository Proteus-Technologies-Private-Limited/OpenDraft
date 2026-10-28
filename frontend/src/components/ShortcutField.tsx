import React, { useEffect, useState } from 'react';
import { formatShortcut, shortcutFromEvent } from '../utils/shortcuts';

/**
 * Records a keyboard shortcut by listening for one.
 *
 * Click it, press the keys, done — the same gesture every application uses for
 * this, and the only one that does not ask a writer to know that Option is
 * spelled `Alt` in the file. What it shows back is the platform's own
 * spelling: ⌥↩ on a Mac, Alt+Enter elsewhere.
 */
const ShortcutField: React.FC<{
  id: string;
  value: string;
  onChange: (spec: string) => void;
}> = ({ id, value, onChange }) => {
  const [listening, setListening] = useState(false);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setListening(false); return; }
      // Swallow everything while listening, so a half-pressed combination
      // cannot trigger whatever it would normally do.
      e.preventDefault();
      e.stopPropagation();
      const spec = shortcutFromEvent(e);
      // A bare modifier on the way to a combination: keep waiting for the rest.
      if (!spec) return;
      onChange(spec);
      setListening(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [listening, onChange]);

  const label = listening
    ? 'Press the keys\u2026'
    : (formatShortcut(value) || 'None');

  return (
    <span className="shortcut-field">
      <button
        id={id}
        type="button"
        className={`dialog-input shortcut-capture${listening ? ' is-listening' : ''}`}
        onClick={() => setListening((on) => !on)}
        aria-live="polite"
      >
        {label}
      </button>
      <button
        type="button"
        className="shortcut-clear"
        onClick={() => { setListening(false); onChange(''); }}
        disabled={!value && !listening}
      >
        Clear
      </button>
    </span>
  );
};

export default ShortcutField;
