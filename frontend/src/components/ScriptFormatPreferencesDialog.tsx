/**
 * Multi-select dialog: the user checks which script formats they ever write in.
 * The set is persisted in settingsStore. Used both for first-run setup (auto-shown
 * the first time the user creates a new screenplay) and for later management
 * via Format > Script Format Preferences...
 *
 * On confirm:
 *  - Saves the selection
 *  - Marks formatPreferencesInitialized = true
 *  - Calls onConfirm(ids) so the caller (e.g. New Screenplay flow) can proceed
 */

import React, { useState, useEffect } from 'react';
import { SYSTEM_TEMPLATE_LIST } from '../stores/formattingTemplateStore';
import { useSettingsStore } from '../stores/settingsStore';
import { INDUSTRY_STANDARD_ID } from '../stores/formattingTypes';

interface Props {
  /** When true the dialog is non-cancellable — used for the first-run setup. */
  firstRun?: boolean;
  onConfirm: (selectedIds: string[]) => void;
  onCancel?: () => void;
}

const ScriptFormatPreferencesDialog: React.FC<Props> = ({ firstRun = false, onConfirm, onCancel }) => {
  const enabledScriptFormats = useSettingsStore((s) => s.enabledScriptFormats);
  const setEnabledScriptFormats = useSettingsStore((s) => s.setEnabledScriptFormats);
  const setFormatPreferencesInitialized = useSettingsStore((s) => s.setFormatPreferencesInitialized);

  // Default selection on first run: just Film Screenplay. Otherwise hydrate from saved.
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (enabledScriptFormats.length > 0) return new Set(enabledScriptFormats);
    return new Set([INDUSTRY_STANDARD_ID]);
  });

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
  };

  const handleConfirm = () => {
    const ids = SYSTEM_TEMPLATE_LIST.map((t) => t.id).filter((id) => selected.has(id));
    // Guarantee at least one selection so New Screenplay can always proceed.
    const finalIds = ids.length > 0 ? ids : [INDUSTRY_STANDARD_ID];
    setEnabledScriptFormats(finalIds);
    setFormatPreferencesInitialized(true);
    onConfirm(finalIds);
  };

  return (
    <div className="dialog-overlay" onClick={firstRun ? undefined : onCancel}>
      <div className="fmt-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          {firstRun ? 'Welcome — choose your script formats' : 'Script Format Preferences'}
        </div>
        <div className="fmt-dialog-body">
          <p className="fmt-dialog-hint">
            {firstRun
              ? 'Pick the formats you commonly write in. When you create a new script, OpenDraft will offer just these options. You can change this later from the Format menu.'
              : 'Choose which formats appear in the New Screenplay picker. If only one is selected, new scripts use it directly without prompting.'}
          </p>
          <div className="fmt-card-list">
            {SYSTEM_TEMPLATE_LIST.map((tpl) => {
              const isSelected = selected.has(tpl.id);
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
                      <span>{tpl.name}</span>
                      {tpl.scriptTypeGroup && (
                        <span className="fmt-card-group">{tpl.scriptTypeGroup}</span>
                      )}
                    </div>
                    <div className="fmt-card-tagline">
                      {tpl.scriptTypeTagline || tpl.description}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
        <div className="dialog-actions">
          {!firstRun && (
            <button className="dialog-btn" onClick={onCancel}>Cancel</button>
          )}
          <button className="dialog-btn dialog-btn-primary" onClick={handleConfirm}>
            {firstRun ? 'Save & Continue' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScriptFormatPreferencesDialog;
