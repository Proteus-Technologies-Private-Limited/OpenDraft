import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../stores/settingsStore';
import { ELEMENT_LABELS } from '../stores/editorStore';
import {
  createMacro, mergeMacros, parseMacrosFile, serializeMacros, shortcutClashes,
  MAX_MACRO_NAME, MAX_MACRO_TEXT, type Macro,
} from '../utils/macros';
import { openTextFile, saveFile } from '../utils/fileOps';
import { isMacPlatform } from '../utils/shortcuts';
import ShortcutField from './ShortcutField';
import Select from './Select';
import { showToast } from './Toast';
import { elementLabel } from '../editor/elementLabels';

/** Element types a macro can be inserted as. The title page is not a script line. */
const MACRO_ELEMENT_IDS = Object.keys(ELEMENT_LABELS).filter((id) => id !== 'titlePage');

// i18n-ignore: file-dialog filter name written by the OS dialog; a file kind, not UI wording
const JSON_FILTER = [{ name: 'OpenDraft macros', extensions: ['json'] }];

/** Settings → Macros: add, edit, remove, export and import the writer's macros. */
const MacroSettingsSection: React.FC = () => {
  const { t } = useTranslation(['settings', 'common']);
  const macros = useSettingsStore((s) => s.macros);
  const setMacros = useSettingsStore((s) => s.setMacros);
  const elementMenuShortcut = useSettingsStore((s) => s.elementMenuShortcut);
  const clashes = shortcutClashes(macros, [elementMenuShortcut]);
  const sectionRef = useRef<HTMLElement>(null);

  // Edit → Manage Macros… lands here as /settings#macros.
  useEffect(() => {
    if (window.location.hash === '#macros') sectionRef.current?.scrollIntoView({ block: 'start' });
  }, []);

  const update = (id: string, patch: Partial<Macro>) =>
    setMacros(macros.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const remove = (id: string) => setMacros(macros.filter((m) => m.id !== id));
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= macros.length) return;
    const next = [...macros];
    [next[index], next[to]] = [next[to], next[index]];
    setMacros(next);
  };

  const handleExport = async () => {
    try {
      await saveFile(serializeMacros(macros), 'OpenDraft Macros.json', JSON_FILTER);
    } catch (err) {
      showToast(t('macros.exportFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    }
  };

  const handleImport = async () => {
    try {
      const file = await openTextFile(JSON_FILTER);
      if (!file) return;
      const { macros: merged, added } = mergeMacros(macros, parseMacrosFile(file.content));
      setMacros(merged);
      showToast(added ? t('macros.imported', { count: added }) : t('macros.noneNew'), added ? 'success' : 'info');
    } catch (err) {
      showToast(t('macros.importFailed', { error: err instanceof Error ? err.message : String(err) }), 'error');
    }
  };

  return (
    <section className="settings-section" id="macros" ref={sectionRef}>
      <h2 className="settings-section-title">{t('macros.title')}</h2>
      <p className="settings-section-desc">
        {t('macros.description')}
      </p>

      {macros.length === 0 && <p className="settings-hint">{t('macros.empty')}</p>}

      <ul className="macro-list">
        {macros.map((m, i) => (
          <li key={m.id} className="macro-row">
            <div className="macro-row-fields">
              <label className="macro-field">
                <span>{t('common:name')}</span>
                <input
                  className="dialog-input"
                  value={m.name}
                  maxLength={MAX_MACRO_NAME}
                  placeholder={t('macros.namePlaceholder')}
                  onChange={(e) => update(m.id, { name: e.target.value })}
                />
              </label>
              <label className="macro-field macro-field-text">
                <span>{t('macros.text')}</span>
                <textarea
                  className="dialog-input"
                  value={m.text}
                  maxLength={MAX_MACRO_TEXT}
                  rows={Math.min(4, Math.max(1, m.text.split('\n').length))}
                  placeholder={t('macros.textPlaceholder')}
                  onChange={(e) => update(m.id, { text: e.target.value })}
                />
              </label>
              <label className="macro-field">
                <span>{t('macros.insertAs')}</span>
                <Select value={m.elementType} onChange={(e) => update(m.id, { elementType: e.target.value })}>
                  <option value="">{t('macros.textAtCursor')}</option>
                  {MACRO_ELEMENT_IDS.map((id) => <option key={id} value={id}>{elementLabel(id)}</option>)}
                </Select>
              </label>
              <div className="macro-field">
                <span id={`macro-shortcut-label-${m.id}`}>{t('macros.shortcut')}</span>
                <ShortcutField
                  id={`macro-shortcut-${m.id}`}
                  value={m.shortcut}
                  onChange={(spec) => update(m.id, { shortcut: spec })}
                />
              </div>
            </div>
            {clashes.has(m.id) && (
              <div className="settings-hint settings-hint-warning">
                {m.shortcut === elementMenuShortcut ? t('macros.clashElementMenu') : t('macros.clashMacro')}
              </div>
            )}
            <div className="macro-row-actions">
              <button className="dialog-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('macros.moveUp')}>&uarr;</button>
              <button className="dialog-btn" onClick={() => move(i, 1)} disabled={i === macros.length - 1} aria-label={t('macros.moveDown')}>&darr;</button>
              <button className="dialog-btn" onClick={() => remove(m.id)}>{t('common:remove')}</button>
            </div>
          </li>
        ))}
      </ul>

      <div className="macro-toolbar">
        <button className="dialog-btn dialog-btn-primary" onClick={() => setMacros([...macros, createMacro()])}>{t('macros.add')}</button>
        <button className="dialog-btn" onClick={() => void handleImport()}>{t('macros.import')}</button>
        <button className="dialog-btn" onClick={() => void handleExport()} disabled={macros.length === 0}>{t('macros.export')}</button>
      </div>
      <div className="settings-hint">
        {isMacPlatform() ? t('macros.footerHintMac') : t('macros.footerHintOther')}
      </div>
    </section>
  );
};

export default MacroSettingsSection;
