/**
 * Quick single-select picker shown when the user invokes New Screenplay and
 * has 2+ formats enabled in their preferences. The list contains only the
 * enabled formats. Picking one calls onPick(templateId).
 *
 * If only one format is enabled, callers should skip this dialog entirely
 * and apply that format directly.
 */

import React from 'react';
import { SYSTEM_TEMPLATES } from '../stores/formattingTemplateStore';

interface Props {
  enabledIds: string[];
  onPick: (templateId: string) => void;
  onCancel: () => void;
}

const ScriptFormatPickerDialog: React.FC<Props> = ({ enabledIds, onPick, onCancel }) => {
  // Resolve to template objects, filtering out anything stale (e.g. a removed system template).
  const options = enabledIds
    .map((id) => SYSTEM_TEMPLATES[id])
    .filter((t): t is NonNullable<typeof t> => Boolean(t));

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="fmt-dialog fmt-dialog-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">Choose script format</div>
        <div className="fmt-dialog-body">
          {options.length === 0 ? (
            <div className="fmt-empty">
              No formats enabled. Open Format → Script Format Preferences to choose at least one.
            </div>
          ) : (
            <div className="fmt-card-list">
              {options.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className="fmt-card"
                  onClick={() => onPick(tpl.id)}
                >
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
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="dialog-btn" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default ScriptFormatPickerDialog;
