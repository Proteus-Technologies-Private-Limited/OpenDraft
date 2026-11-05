import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settingsStore';
import { DEFAULT_SMARTTYPE_LISTS, normalizeSmartTypeLists, type SmartTypeLists } from '../utils/smartTypeLists';
import './SmartTypeSettingsSection.css';

const FIELD_KEYS = ['scenePrefixes', 'times', 'characterExtensions', 'transitions'] as const;

type Draft = Record<keyof SmartTypeLists, string>;
const lines = (values: readonly string[]) => values.map((value) => value.trimEnd()).join('\n');
const toDraft = (lists: SmartTypeLists): Draft => ({
  scenePrefixes: lines(lists.scenePrefixes), times: lines(lists.times),
  characterExtensions: lines(lists.characterExtensions), transitions: lines(lists.transitions),
});

export default function SmartTypeSettingsSection() {
  const { t } = useTranslation('settings');
  // Built here, not at module scope, so the labels follow the interface language.
  const FIELDS = FIELD_KEYS.map((key) => ({
    key,
    label: t(`smartType.fields.${key}.label`),
    hint: t(`smartType.fields.${key}.hint`),
    restore: t(`smartType.fields.${key}.restore`),
  }));
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
      setStatus(t('smartType.saved'));
    } catch (err) {
      setStatus('');
      setError(t('smartType.saveFailed', { message: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <section className="settings-section" id="smarttype" aria-labelledby="smarttype-title">
      <h2 className="settings-section-title" id="smarttype-title">{t('smartType.title')}</h2>
      <p className="settings-section-desc">
        {t('smartType.description')}
      </p>
      <p className="settings-hint">
        {t('smartType.hint')}
      </p>
      <form onSubmit={save}>
        <div className="smarttype-settings-grid">
          {FIELDS.map(({ key, label, hint, restore }) => (
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
                {restore}
              </button>
            </div>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        {status && <p role="status">{status}</p>}
        <div className="smarttype-settings-actions">
          <button type="submit" className="dialog-btn dialog-btn-primary" disabled={!dirty}>{t('smartType.save')}</button>
          <button type="button" className="dialog-btn" disabled={!dirty} onClick={() => {
            setDraft(toDraft(lists)); setError(''); setStatus('');
          }}>{t('smartType.discard')}</button>
        </div>
      </form>
    </section>
  );
}
