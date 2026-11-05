/**
 * Multi-select dialog: the user checks which script formats they ever write in.
 * The set is persisted in settingsStore. Used both for first-run setup (auto-shown
 * the first time the user creates a new screenplay) and for later management
 * via Format > Script Format Preferences...
 *
 * The list is the built-in formats followed by the writer's own templates, so a
 * custom template can be one of the formats a new script starts in — and, marked
 * as the default, the one the picker opens on (issue #114).
 *
 * On confirm:
 *  - Saves the selection and the default
 *  - Marks formatPreferencesInitialized = true
 *  - Calls onConfirm(ids) so the caller (e.g. New Screenplay flow) can proceed
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { templateGroup, templateName, templateTagline } from '../utils/templateLabels';
import {
  SYSTEM_TEMPLATE_LIST,
  ensureTemplatesLoaded,
  useFormattingTemplateStore,
} from '../stores/formattingTemplateStore';
import { useSettingsStore } from '../stores/settingsStore';
import { INDUSTRY_STANDARD_ID } from '../stores/formattingTypes';
import type { FormattingTemplate } from '../stores/formattingTypes';

interface Props {
  /** When true the dialog is non-cancellable — used for the first-run setup. */
  firstRun?: boolean;
  onConfirm: (selectedIds: string[]) => void;
  onCancel?: () => void;
}

const ScriptFormatPreferencesDialog: React.FC<Props> = ({ firstRun = false, onConfirm, onCancel }) => {
  const { t } = useTranslation(['templates', 'common']);
  const enabledScriptFormats = useSettingsStore((s) => s.enabledScriptFormats);
  const setEnabledScriptFormats = useSettingsStore((s) => s.setEnabledScriptFormats);
  const defaultScriptFormat = useSettingsStore((s) => s.defaultScriptFormat);
  const setDefaultScriptFormat = useSettingsStore((s) => s.setDefaultScriptFormat);
  const setFormatPreferencesInitialized = useSettingsStore((s) => s.setFormatPreferencesInitialized);

  // The writer's own templates, which live in storage rather than in the bundle.
  const userTemplates = useFormattingTemplateStore((s) => s.templates)
    .filter((tpl) => tpl.category !== 'system');
  useEffect(() => { ensureTemplatesLoaded(); }, []);

  // Default selection on first run: just Film Screenplay. Otherwise hydrate from saved.
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (enabledScriptFormats.length > 0) return new Set(enabledScriptFormats);
    return new Set([INDUSTRY_STANDARD_ID]);
  });
  const [defaultId, setDefaultId] = useState<string | null>(defaultScriptFormat);

  useEffect(() => {
    // If the user has saved a selection in another tab/session, reflect it on open.
    if (enabledScriptFormats.length > 0) {
      setSelected(new Set(enabledScriptFormats));
    }
  }, [enabledScriptFormats]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    // Unchecking the default retires it: a format you no longer write in cannot
    // be the one the picker opens on.
    setDefaultId((prev) => (prev === id && selected.has(id) ? null : prev));
  };

  /** Toggle "start the picker on this one". Choosing a format also enables it. */
  const toggleDefault = (id: string) => {
    setDefaultId((prev) => (prev === id ? null : id));
    setSelected((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  };

  const handleConfirm = () => {
    // Built-in formats first, then the writer's own — the order the list is
    // shown in, so the picker matches the dialog that filled it.
    const ordered = [...SYSTEM_TEMPLATE_LIST, ...userTemplates].map((tpl) => tpl.id);
    const ids = ordered.filter((id) => selected.has(id));
    // Guarantee at least one selection so New Screenplay can always proceed.
    const finalIds = ids.length > 0 ? ids : [INDUSTRY_STANDARD_ID];
    const finalDefault = defaultId && finalIds.includes(defaultId) ? defaultId : null;
    setEnabledScriptFormats(finalIds);
    // After the enabled list: its setter drops a default that is no longer on it.
    setDefaultScriptFormat(finalDefault);
    setFormatPreferencesInitialized(true);
    onConfirm(finalIds);
  };

  const renderCard = (tpl: FormattingTemplate) => {
    const isSelected = selected.has(tpl.id);
    const isDefault = defaultId === tpl.id;
    return (
      <label
        key={tpl.id}
        className={`fmt-card${isSelected ? ' is-selected' : ''}`}
      >
        <input
          type="checkbox"
          className="fmt-card-checkbox"
          checked={isSelected}
          onChange={() => toggle(tpl.id)}
        />
        <div className="fmt-card-info">
          <div className="fmt-card-name">
            <span>{templateName(tpl)}</span>
            {tpl.scriptTypeGroup && (
              <span className="fmt-card-group">{templateGroup(tpl)}</span>
            )}
          </div>
          <div className="fmt-card-tagline">
            {templateTagline(tpl)}
          </div>
        </div>
        {/* Inside a <label>, a click would otherwise tick the checkbox too:
            preventDefault stops the label activating its control. */}
        <button
          type="button"
          className={`fmt-card-default-btn${isDefault ? ' is-default' : ''}`}
          aria-pressed={isDefault}
          title={isDefault
            ? t('format.defaultTooltipClear')
            : t('format.defaultTooltipSet')}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDefault(tpl.id);
          }}
        >
          {isDefault ? t('format.isDefault') : t('format.makeDefault')}
        </button>
      </label>
    );
  };

  return (
    <div className="dialog-overlay" onClick={firstRun ? undefined : onCancel}>
      <div className="fmt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          {firstRun ? t('prefs.titleFirstRun') : t('prefs.title')}
        </div>
        <div className="fmt-dialog-body">
          <p className="fmt-dialog-hint">
            {firstRun
              ? t('prefs.hintFirstRun')
              : t('prefs.hint')}
          </p>
          <div className="fmt-card-list">
            {SYSTEM_TEMPLATE_LIST.map(renderCard)}
          </div>

          {/* The writer's own templates, offered on the same footing as the
              built-in formats — including as the default (issue #114). The
              first-run welcome skips the empty state: a writer who has not
              opened the app yet has no templates to be told about. */}
          {(userTemplates.length > 0 || !firstRun) && (
            <>
              <div className="fmt-dialog-section">{t('prefs.yourTemplates')}</div>
              {userTemplates.length === 0 ? (
                <p className="fmt-dialog-hint">
                  {t('prefs.noneYet')}
                </p>
              ) : (
                <div className="fmt-card-list">
                  {userTemplates.map(renderCard)}
                </div>
              )}
            </>
          )}
        </div>
        <div className="dialog-actions">
          {!firstRun && (
            <button className="dialog-btn" onClick={onCancel}>{t('common:cancel')}</button>
          )}
          <button className="dialog-btn dialog-btn-primary" onClick={handleConfirm}>
            {firstRun ? t('prefs.saveContinue') : t('common:save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScriptFormatPreferencesDialog;
