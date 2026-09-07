/**
 * Quick single-select picker shown when the user invokes New Screenplay and
 * has 2+ formats enabled in their preferences. The list contains only the
 * enabled formats — built-in ones and the writer's own templates alike.
 * Picking one calls onPick(templateId).
 *
 * If only one format is enabled, callers should skip this dialog entirely
 * and apply that format directly.
 */

import React from 'react';
import { findTemplate } from '../stores/formattingTemplateStore';
import type { FormattingTemplate } from '../stores/formattingTypes';

interface Props {
  enabledIds: string[];
  /** The writer's default format: listed first, badged, and focused on open. */
  defaultId?: string | null;
  onPick: (templateId: string) => void;
  onCancel: () => void;
}

const ScriptFormatPickerDialog: React.FC<Props> = ({ enabledIds, defaultId, onPick, onCancel }) => {
  // Resolve to template objects, dropping anything stale — a system template
  // that has been removed, or a custom one deleted on another device.
  const options: FormattingTemplate[] = enabledIds
    .map((id) => findTemplate(id))
    .filter((t): t is FormattingTemplate => Boolean(t));

  // The default leads the list. Keeping several formats enabled means the next
  // script could be any of them, so the question is still asked — the default
  // only decides which answer is already under the writer's hand: it comes
  // first, says so, and holds focus, so Enter takes it and nothing else has to
  // be aimed at.
  const ordered = defaultId
    ? [...options].sort((a, b) => Number(b.id === defaultId) - Number(a.id === defaultId))
    : options;

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
              {ordered.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={`fmt-card${tpl.id === defaultId ? ' is-selected' : ''}`}
                  autoFocus={tpl.id === defaultId}
                  onClick={() => onPick(tpl.id)}
                >
                  <div className="fmt-card-info">
                    <div className="fmt-card-name">
                      <span>{tpl.name}</span>
                      {tpl.id === defaultId && (
                        <span className="fmt-card-default">default</span>
                      )}
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
