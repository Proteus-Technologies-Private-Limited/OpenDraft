/** Task type settings stored in the script alongside its tasks. */
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaEye, FaEyeSlash, FaPlus, FaTrash } from 'react-icons/fa';
import { addCustomType, removeCustomType, setTypeBehavior, setTypeHidden, updateData } from '../data';
import { allTypes, DEFAULT_BEHAVIOR, PLUGIN_ID, type SidekickData, type TaskKind, type TaskTypeBehavior } from '../model';
import { typeLabel } from '../actions';
import { TypeIcon } from './icons';

const SWATCHES = ['#4a9eff', '#e8833a', '#d65db1', '#e0b100', '#2bb3a3', '#c25450', '#8c6dd8', '#3fa34d', '#7c8aa5'];

function BehaviorFields({ behavior, onChange }: { behavior: TaskTypeBehavior; onChange: (patch: Partial<TaskTypeBehavior>) => void }) {
  const { t } = useTranslation(PLUGIN_ID);
  return (
    <div className="sk-types__behavior">
      <label>
        {t('panel.scriptLink')}
        <select className="sk-select" value={behavior.scriptLink} onChange={(e) => onChange({ scriptLink: e.target.value as TaskTypeBehavior['scriptLink'] })}>
          <option value="required">{t('panel.selectionRequired')}</option>
          <option value="optional">{t('panel.selectionOptional')}</option>
          <option value="none">{t('panel.noScriptLink')}</option>
        </select>
      </label>
      {behavior.scriptLink !== 'none' && (
        <label>
          {t('panel.selectedText')}
          <select className="sk-select" value={behavior.textAction} onChange={(e) => onChange({ textAction: e.target.value as TaskTypeBehavior['textAction'] })}>
            <option value="copy">{t('panel.copyText')}</option>
            <option value="move">{t('panel.moveText')}</option>
          </select>
        </label>
      )}
    </div>
  );
}

export function TypeManager({ data, onError }: { data: SidekickData; onError: (message: string) => void }) {
  const { t } = useTranslation(PLUGIN_ID);
  const id = useId();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TaskKind>('track');
  const [color, setColor] = useState(SWATCHES[0]);
  const [behavior, setBehavior] = useState(DEFAULT_BEHAVIOR);
  const [editing, setEditing] = useState<string | null>(null);
  const hidden = new Set(data.hiddenTypeIds);

  /** Apply a change; a refusal (e.g. deleting a type still in use) is shown, not thrown. */
  const run = (change: (d: SidekickData) => SidekickData): boolean => {
    let refused: string | null = null;
    const error = updateData((d) => {
      try {
        return change(d);
      } catch (err) {
        refused = err instanceof Error ? err.message : String(err);
        return d;
      }
    });
    const message = refused ?? error;
    if (message) onError(message);
    return !message;
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (run((d) => addCustomType(d, { label: name, kind, color, ...behavior }).data)) setName('');
  };

  return (
    <div className="sk-types">
      <p className="sk-help">{t('panel.typesHelp')}</p>
      <ul className="sk-types__list">
        {allTypes(data).map((type) => {
          const isHidden = hidden.has(type.id);
          return (
            <li key={type.id}>
              <div className={`sk-types__row${isHidden ? ' sk-types__row--hidden' : ''}`} style={{ '--sk-type-color': type.color } as React.CSSProperties}>
                <span className="sk-types__icon"><TypeIcon icon={type.icon} /></span>
                <span className="sk-types__name">{typeLabel(type)}</span>
                <span className="sk-types__kind">{t(`kind.${type.kind}`)}</span>
                <button type="button" className="sk-link" aria-expanded={editing === type.id} aria-label={t('panel.editTypeNamed', { name: typeLabel(type) })} onClick={() => setEditing(editing === type.id ? null : type.id)}>
                  {t('panel.editType')}
                </button>
                <button
                  type="button"
                  className="sk-icon-button"
                  onClick={() => run((d) => setTypeHidden(d, type.id, !isHidden))}
                  aria-label={`${isHidden ? t('panel.show') : t('panel.hide')}: ${typeLabel(type)}`}
                  title={isHidden ? t('panel.show') : t('panel.hide')}
                >
                  {isHidden ? <FaEyeSlash aria-hidden /> : <FaEye aria-hidden />}
                </button>
                {!type.builtIn && (
                  <button
                    type="button"
                    className="sk-icon-button sk-action--danger"
                    onClick={() => run((d) => removeCustomType(d, type.id))}
                    aria-label={`${t('panel.deleteType')}: ${typeLabel(type)}`}
                    title={t('panel.deleteType')}
                  >
                    <FaTrash aria-hidden />
                  </button>
                )}
              </div>
              {editing === type.id && <BehaviorFields behavior={type} onChange={(patch) => run((d) => setTypeBehavior(d, type.id, patch))} />}
            </li>
          );
        })}
      </ul>
      <form className="sk-types__new" onSubmit={add}>
        <label className="sk-visually-hidden" htmlFor={`${id}-name`}>{t('panel.newTypeName')}</label>
        <input id={`${id}-name`} className="sk-input" placeholder={t('panel.newType')} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        <label className="sk-visually-hidden" htmlFor={`${id}-kind`}>{t('panel.newTypeKind')}</label>
        <select id={`${id}-kind`} className="sk-select" value={kind} onChange={(e) => setKind(e.target.value as TaskKind)}>
          <option value="track">{t('kind.track')}</option>
          <option value="keep">{t('kind.keep')}</option>
        </select>
        <BehaviorFields behavior={behavior} onChange={(patch) => setBehavior((current) => ({ ...current, ...patch }))} />
        <fieldset className="sk-swatches">
          <legend className="sk-visually-hidden">{t('panel.newTypeColor')}</legend>
          {SWATCHES.map((swatch) => (
            <label key={swatch} className="sk-swatch" style={{ background: swatch }}>
              <input type="radio" name={`${id}-color`} value={swatch} checked={color === swatch} onChange={() => setColor(swatch)} aria-label={swatch} />
            </label>
          ))}
        </fieldset>
        <button type="submit" className="sk-action" disabled={!name.trim()}>
          <FaPlus aria-hidden /> {t('panel.add')}
        </button>
      </form>
    </div>
  );
}
