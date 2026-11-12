/**
 * Template Conflict Resolution Dialog.
 *
 * Shown when applying a template to a document that has:
 * 1. Element types the template disables — user picks replacements
 * 2. Inline marks that conflict with locked formatting — user can strip them
 */

import React, { useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { Trans, useTranslation } from 'react-i18next';
import type { TemplateConflicts, DisabledElementConflict, FormattingViolation } from '../utils/templateConflicts';
import Select from './Select';

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
  const { t } = useTranslation(['templates', 'common']);
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
    <ModalOverlay className="template-conflict-overlay" onClick={onCancel}>
      <div className="template-conflict-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{t('conflict.title')}</h3>
        <p className="template-conflict-desc">
          <Trans
            ns="templates"
            i18nKey="conflict.intro"
            values={{ name: templateName }}
            components={{ strong: <strong /> }}
          />
        </p>

        {/* Disabled Element Types */}
        {disabledElements.length > 0 && (
          <div className="template-conflict-section">
            <h4>{t('conflict.disabled.title')}</h4>
            <p className="template-conflict-section-desc">
              {t('conflict.disabled.desc')}
            </p>
            {disabledElements.map((c, i) => (
              <div key={c.elementType} className="template-conflict-item">
                <div className="template-conflict-item-info">
                  <span className="template-conflict-count">{c.nodeCount}</span>
                  <span className="template-conflict-item-label">
                    {t('conflict.elementCount', { label: c.elementLabel, count: c.nodeCount })}
                  </span>
                </div>
                <div className="template-conflict-item-action">
                  <label>{t('conflict.replaceWith')}</label>
                  <Select
                    className="dialog-input template-conflict-select"
                    value={c.replacementType}
                    onChange={(e) => updateReplacement(i, e.target.value)}
                  >
                    {enabledElements.map((el) => (
                      <option key={el.id} value={el.id}>{el.label}</option>
                    ))}
                  </Select>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Formatting Violations */}
        {formattingViolations.length > 0 && (
          <div className="template-conflict-section">
            <h4>{t('conflict.formatting.title')}</h4>
            <p className="template-conflict-section-desc">
              {t('conflict.formatting.desc')}
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
                      {t('conflict.formatting.detail', { count: v.nodeCount, marks: v.conflictingMarks.join(', ') })}
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
            {t('common:cancel')}
          </button>
          <button className="dialog-btn" onClick={onSkip}>
            {t('conflict.applyWithout')}
          </button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleResolve}>
            {t('conflict.resolveApply')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default TemplateConflictDialog;
