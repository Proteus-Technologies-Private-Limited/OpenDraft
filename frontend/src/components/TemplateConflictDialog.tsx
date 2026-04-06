/**
 * Template Conflict Resolution Dialog.
 *
 * Shown when applying a template to a document that has:
 * 1. Element types the template disables — user picks replacements
 * 2. Inline marks that conflict with locked formatting — user can strip them
 */

import React, { useState } from 'react';
import type { TemplateConflicts, DisabledElementConflict, FormattingViolation } from '../utils/templateConflicts';

interface TemplateConflictDialogProps {
  conflicts: TemplateConflicts;
  enabledElements: Array<{ id: string; label: string }>;
  templateName: string;
  onResolve: (resolved: TemplateConflicts) => void;
  onSkip: () => void;
  onCancel: () => void;
}

const TemplateConflictDialog: React.FC<TemplateConflictDialogProps> = ({
  conflicts,
  enabledElements,
  templateName,
  onResolve,
  onSkip,
  onCancel,
}) => {
  const [disabledElements, setDisabledElements] = useState<DisabledElementConflict[]>(
    () => conflicts.disabledElements.map((c) => ({ ...c })),
  );
  const [formattingViolations, setFormattingViolations] = useState<FormattingViolation[]>(
    () => conflicts.formattingViolations.map((v) => ({ ...v, shouldReformat: true })),
  );

  const updateReplacement = (index: number, replacementType: string) => {
    setDisabledElements((prev) =>
      prev.map((c, i) => (i === index ? { ...c, replacementType } : c)),
    );
  };

  const toggleReformat = (index: number) => {
    setFormattingViolations((prev) =>
      prev.map((v, i) => (i === index ? { ...v, shouldReformat: !v.shouldReformat } : v)),
    );
  };

  const handleResolve = () => {
    onResolve({
      disabledElements,
      formattingViolations,
      hasConflicts: true,
    });
  };

  return (
    <div className="template-conflict-overlay" onClick={onCancel}>
      <div className="template-conflict-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Template Conflicts</h3>
        <p className="template-conflict-desc">
          Applying <strong>{templateName}</strong> requires resolving the following conflicts
          in your document.
        </p>

        {/* Disabled Element Types */}
        {disabledElements.length > 0 && (
          <div className="template-conflict-section">
            <h4>Disabled Element Types</h4>
            <p className="template-conflict-section-desc">
              These element types are disabled in the template but exist in your document.
              Choose a replacement for each.
            </p>
            {disabledElements.map((c, i) => (
              <div key={c.elementType} className="template-conflict-item">
                <div className="template-conflict-item-info">
                  <span className="template-conflict-count">{c.nodeCount}</span>
                  <span className="template-conflict-item-label">
                    {c.elementLabel} element{c.nodeCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="template-conflict-item-action">
                  <label>Replace with:</label>
                  <select
                    className="dialog-input template-conflict-select"
                    value={c.replacementType}
                    onChange={(e) => updateReplacement(i, e.target.value)}
                  >
                    {enabledElements.map((el) => (
                      <option key={el.id} value={el.id}>{el.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Formatting Violations */}
        {formattingViolations.length > 0 && (
          <div className="template-conflict-section">
            <h4>Formatting Conflicts</h4>
            <p className="template-conflict-section-desc">
              These elements have inline formatting that conflicts with the template&apos;s
              locked rules. Check to strip conflicting marks.
            </p>
            {formattingViolations.map((v, i) => (
              <div key={v.elementType} className="template-conflict-item">
                <label className="template-conflict-checkbox">
                  <input
                    type="checkbox"
                    checked={v.shouldReformat}
                    onChange={() => toggleReformat(i)}
                  />
                  <div>
                    <span className="template-conflict-item-label">
                      {v.elementLabel}
                    </span>
                    <span className="template-conflict-detail">
                      {v.nodeCount} element{v.nodeCount !== 1 ? 's' : ''} with{' '}
                      {v.conflictingMarks.join(', ')}
                    </span>
                  </div>
                </label>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="template-conflict-actions">
          <button className="dialog-btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="dialog-btn" onClick={onSkip}>
            Apply Without Resolving
          </button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleResolve}>
            Resolve &amp; Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default TemplateConflictDialog;
