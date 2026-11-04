import { useState, type FormEvent } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { DEFAULT_SMARTTYPE_LISTS, normalizeSmartTypeLists, type SmartTypeLists } from '../utils/smartTypeLists';
import './SmartTypeSettingsSection.css';

const FIELDS = [
  { key: 'scenePrefixes', label: 'Scene prefixes / intros', hint: 'For example INT., EXT., or DREAM SEQUENCE:. A space is added after each prefix.' },
  { key: 'times', label: 'Scene times', hint: 'For example DAY, NIGHT, or MAGIC HOUR.' },
  { key: 'characterExtensions', label: 'Character extensions', hint: 'For example V.O. or THROUGH PHONE. Parentheses are added automatically.' },
  { key: 'transitions', label: 'Transitions', hint: 'For example CUT TO: or FADE TO WHITE:. Include the punctuation you want inserted.' },
] as const;

type Draft = Record<keyof SmartTypeLists, string>;
const lines = (values: readonly string[]) => values.map((value) => value.trimEnd()).join('\n');
const toDraft = (lists: SmartTypeLists): Draft => ({
  scenePrefixes: lines(lists.scenePrefixes), times: lines(lists.times),
  characterExtensions: lines(lists.characterExtensions), transitions: lines(lists.transitions),
});

export default function SmartTypeSettingsSection() {
  const lists = useSettingsStore((s) => s.smartTypeLists);
  const saveLists = useSettingsStore((s) => s.setSmartTypeLists);
  const [draft, setDraft] = useState(() => toDraft(lists));
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const saved = toDraft(lists);
  const dirty = FIELDS.some(({ key }) => draft[key] !== saved[key]);
  const update = (key: keyof Draft, text: string) => {
    setDraft((current) => ({ ...current, [key]: text }));
    setStatus('');
    setError('');
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    const clean = normalizeSmartTypeLists({
      scenePrefixes: draft.scenePrefixes.split('\n'), times: draft.times.split('\n'),
      characterExtensions: draft.characterExtensions.split('\n'), transitions: draft.transitions.split('\n'),
    });
    try {
      saveLists(clean);
      setDraft(toDraft(clean));
      setError('');
      setStatus('SmartType lists saved on this device.');
    } catch (err) {
      setStatus('');
      setError(`Could not save SmartType lists: ${err instanceof Error ? err.message : String(err)}. Your changes are still here; try saving again.`);
    }
  };

  return (
    <section className="settings-section" id="smarttype" aria-labelledby="smarttype-title">
      <h2 className="settings-section-title" id="smarttype-title">SmartType lists</h2>
      <p className="settings-section-desc">
        Add, edit, remove or reorder suggestions with one item per line. Save lists to apply changes.
        Entries use uppercase and duplicates are removed. These lists stay on this device.
      </p>
      <p className="settings-hint">
        Names, locations, times and transitions already used in the current script are still suggested.
        Clearing a list removes its saved suggestions; it does not change your script.
      </p>
      <form onSubmit={save}>
        <div className="smarttype-settings-grid">
          {FIELDS.map(({ key, label, hint }) => (
            <div className="smarttype-settings-list" key={key}>
              <label htmlFor={`smarttype-${key}`}>{label}</label>
              <textarea
                id={`smarttype-${key}`}
                aria-describedby={`smarttype-${key}-hint`}
                className="dialog-input"
                rows={6}
                spellCheck={false}
                autoCapitalize="off"
                value={draft[key]}
                onChange={(event) => update(key, event.target.value)}
              />
              <p className="settings-hint" id={`smarttype-${key}-hint`}>{hint}</p>
              <button type="button" className="dialog-btn" onClick={() => update(key, lines(DEFAULT_SMARTTYPE_LISTS[key]))}>
                Restore default {label.toLowerCase()}
              </button>
            </div>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        {status && <p role="status">{status}</p>}
        <div className="smarttype-settings-actions">
          <button type="submit" className="dialog-btn dialog-btn-primary" disabled={!dirty}>Save lists</button>
          <button type="button" className="dialog-btn" disabled={!dirty} onClick={() => {
            setDraft(toDraft(lists)); setError(''); setStatus('');
          }}>Discard changes</button>
        </div>
      </form>
    </section>
  );
}
