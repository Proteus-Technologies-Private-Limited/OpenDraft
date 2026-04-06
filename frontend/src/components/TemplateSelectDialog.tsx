/**
 * Template selection dialog for per-document template assignment.
 * Opened from Format > Formatting Template... in the menu bar.
 */

import React, { useState } from 'react';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';

interface TemplateSelectDialogProps {
  onClose: () => void;
}

const TemplateSelectDialog: React.FC<TemplateSelectDialogProps> = ({ onClose }) => {
  const {
    templates,
    activeTemplateId,
    setActiveTemplateId,
    formattingMode,
  } = useFormattingTemplateStore();

  const [useGlobalDefault, setUseGlobalDefault] = useState(!activeTemplateId);
  const [selectedId, setSelectedId] = useState(activeTemplateId || '');

  const handleApply = () => {
    if (useGlobalDefault) {
      setActiveTemplateId(null);
    } else {
      setActiveTemplateId(selectedId || null);
    }
    onClose();
  };

  return (
    <div className="template-select-overlay" onClick={onClose}>
      <div className="template-select-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>Document Formatting Template</h3>

        {formattingMode === 'standard' && (
          <p className="template-select-hint">
            Formatting mode is set to "Industry Standard" in Settings.
            Switch to "Custom Template" mode to use custom templates.
          </p>
        )}

        <div className="template-select-option">
          <label>
            <input
              type="checkbox"
              checked={useGlobalDefault}
              onChange={(e) => setUseGlobalDefault(e.target.checked)}
            />
            Use global default
          </label>
        </div>

        {!useGlobalDefault && (
          <div className="template-select-option">
            <label>Template</label>
            <select
              className="dialog-input"
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">None</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} ({t.mode})</option>
              ))}
            </select>
          </div>
        )}

        <div className="template-select-actions">
          <button className="dialog-btn" onClick={onClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleApply}>Apply</button>
        </div>
      </div>
    </div>
  );
};

export default TemplateSelectDialog;
