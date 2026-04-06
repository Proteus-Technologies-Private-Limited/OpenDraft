/**
 * Template Editor Dialog — full-featured editor for formatting templates.
 *
 * Allows customizing every aspect of each element type:
 * text style, layout, transitions, placeholder, colors, etc.
 * Also supports adding/removing custom element types.
 */

import React, { useState, useCallback } from 'react';
import {
  FaBold, FaItalic, FaUnderline, FaStrikethrough,
  FaAlignLeft, FaAlignCenter, FaAlignRight, FaAlignJustify,
  FaPlus, FaTrash,
} from 'react-icons/fa';
import type { FormattingTemplate, FormattingElementRule } from '../stores/formattingTypes';
import { createDefaultRule } from '../stores/formattingTypes';

interface TemplateEditorDialogProps {
  template: FormattingTemplate;
  onSave: (template: FormattingTemplate) => void;
  onCancel: () => void;
}

function uuid(): string {
  return crypto.randomUUID?.() || Math.random().toString(36).slice(2, 10);
}

const TemplateEditorDialog: React.FC<TemplateEditorDialogProps> = ({
  template: initial,
  onSave,
  onCancel,
}) => {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [mode, setMode] = useState<'enforce' | 'override'>(initial.mode);
  const [rules, setRules] = useState<Record<string, FormattingElementRule>>(
    JSON.parse(JSON.stringify(initial.rules)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    Object.keys(rules)[0] || null,
  );

  const selectedRule = selectedId ? rules[selectedId] : null;

  const updateRule = useCallback(
    (id: string, updates: Partial<FormattingElementRule>) => {
      setRules((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...updates },
      }));
    },
    [],
  );

  const addCustomElement = useCallback(() => {
    const id = uuid();
    const newRule = createDefaultRule(id, 'Custom Element', false);
    setRules((prev) => ({ ...prev, [id]: newRule }));
    setSelectedId(id);
  }, []);

  const removeElement = useCallback(
    (id: string) => {
      setRules((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (selectedId === id) {
        setSelectedId(Object.keys(rules).find((k) => k !== id) || null);
      }
    },
    [selectedId, rules],
  );

  const handleSave = () => {
    onSave({
      ...initial,
      name,
      description,
      mode,
      rules,
      updatedAt: new Date().toISOString(),
    });
  };

  // Build element options for dropdowns (for nextOnEnter/nextOnTab)
  const elementOptions = Object.values(rules)
    .filter((r) => r.enabled)
    .map((r) => ({ id: r.id, label: r.label }));

  return (
    <div className="template-editor-overlay" onClick={onCancel}>
      <div className="template-editor-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="template-editor-header">
          <h2>Edit Template</h2>
          <div className="template-editor-header-actions">
            <button className="dialog-btn" onClick={onCancel}>Cancel</button>
            <button className="dialog-btn dialog-btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>

        {/* Template meta */}
        <div className="template-editor-meta">
          <div className="template-editor-field">
            <label>Name</label>
            <input
              className="dialog-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Template name"
            />
          </div>
          <div className="template-editor-field">
            <label>Description</label>
            <input
              className="dialog-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="template-editor-field">
            <label>Mode</label>
            <div className="template-editor-mode-toggle">
              <button
                className={`template-mode-btn${mode === 'enforce' ? ' active' : ''}`}
                onClick={() => setMode('enforce')}
              >
                Enforce
              </button>
              <button
                className={`template-mode-btn${mode === 'override' ? ' active' : ''}`}
                onClick={() => setMode('override')}
              >
                Override
              </button>
            </div>
            <span className="template-editor-hint">
              {mode === 'enforce'
                ? 'Formatting is locked — users cannot change element-level styling.'
                : 'Formatting sets defaults — users can override per-instance.'}
            </span>
          </div>
        </div>

        {/* Main body: element list + detail */}
        <div className="template-editor-body">
          {/* Left: element list */}
          <div className="template-editor-elements">
            <div className="template-editor-elements-header">
              <span>Elements</span>
              <button
                className="template-add-btn"
                onClick={addCustomElement}
                title="Add custom element"
              >
                <FaPlus />
              </button>
            </div>
            <div className="template-editor-elements-list">
              {Object.values(rules).map((rule) => (
                <div
                  key={rule.id}
                  className={`template-element-item${selectedId === rule.id ? ' selected' : ''}${!rule.enabled ? ' disabled' : ''}`}
                  onClick={() => setSelectedId(rule.id)}
                >
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="template-element-label">
                    {rule.label}
                    {!rule.isBuiltIn && <span className="template-custom-badge">custom</span>}
                  </span>
                  {!rule.isBuiltIn && (
                    <button
                      className="template-delete-btn"
                      onClick={(e) => { e.stopPropagation(); removeElement(rule.id); }}
                      title="Remove element"
                    >
                      <FaTrash />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Right: element detail */}
          <div className="template-editor-detail">
            {selectedRule ? (
              <>
                {/* Label */}
                <div className="template-editor-field">
                  <label>Label</label>
                  <input
                    className="dialog-input"
                    value={selectedRule.label}
                    onChange={(e) => updateRule(selectedId!, { label: e.target.value })}
                    disabled={selectedRule.isBuiltIn}
                    placeholder="Element name"
                  />
                </div>

                {/* Text style toggles */}
                <div className="template-editor-field">
                  <label>Text Style</label>
                  <div className="template-style-toggles">
                    <button
                      className={`template-style-btn${selectedRule.bold ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { bold: !selectedRule.bold })}
                      title="Bold"
                    ><FaBold /></button>
                    <button
                      className={`template-style-btn${selectedRule.italic ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { italic: !selectedRule.italic })}
                      title="Italic"
                    ><FaItalic /></button>
                    <button
                      className={`template-style-btn${selectedRule.underline ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { underline: !selectedRule.underline })}
                      title="Underline"
                    ><FaUnderline /></button>
                    <button
                      className={`template-style-btn${selectedRule.strikethrough ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { strikethrough: !selectedRule.strikethrough })}
                      title="Strikethrough"
                    ><FaStrikethrough /></button>
                  </div>
                </div>

                {/* Text transform */}
                <div className="template-editor-field">
                  <label>Text Transform</label>
                  <select
                    className="dialog-input"
                    value={selectedRule.textTransform}
                    onChange={(e) => updateRule(selectedId!, { textTransform: e.target.value as any })}
                  >
                    <option value="none">None</option>
                    <option value="uppercase">Uppercase</option>
                    <option value="lowercase">Lowercase</option>
                  </select>
                </div>

                {/* Alignment */}
                <div className="template-editor-field">
                  <label>Alignment</label>
                  <div className="template-style-toggles">
                    <button
                      className={`template-style-btn${selectedRule.textAlign === 'left' ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { textAlign: 'left' })}
                    ><FaAlignLeft /></button>
                    <button
                      className={`template-style-btn${selectedRule.textAlign === 'center' ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { textAlign: 'center' })}
                    ><FaAlignCenter /></button>
                    <button
                      className={`template-style-btn${selectedRule.textAlign === 'right' ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { textAlign: 'right' })}
                    ><FaAlignRight /></button>
                    <button
                      className={`template-style-btn${selectedRule.textAlign === 'justify' ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { textAlign: 'justify' })}
                    ><FaAlignJustify /></button>
                  </div>
                </div>

                {/* Colors */}
                <div className="template-editor-field-row">
                  <div className="template-editor-field">
                    <label>Text Color</label>
                    <div className="template-color-input">
                      <input
                        type="color"
                        value={selectedRule.textColor || '#000000'}
                        onChange={(e) => updateRule(selectedId!, { textColor: e.target.value })}
                      />
                      <input
                        type="text"
                        className="dialog-input"
                        value={selectedRule.textColor || ''}
                        onChange={(e) => updateRule(selectedId!, { textColor: e.target.value || null })}
                        placeholder="inherit"
                      />
                      {selectedRule.textColor && (
                        <button
                          className="template-color-clear"
                          onClick={() => updateRule(selectedId!, { textColor: null })}
                        >x</button>
                      )}
                    </div>
                  </div>
                  <div className="template-editor-field">
                    <label>Background Color</label>
                    <div className="template-color-input">
                      <input
                        type="color"
                        value={selectedRule.backgroundColor || '#ffffff'}
                        onChange={(e) => updateRule(selectedId!, { backgroundColor: e.target.value })}
                      />
                      <input
                        type="text"
                        className="dialog-input"
                        value={selectedRule.backgroundColor || ''}
                        onChange={(e) => updateRule(selectedId!, { backgroundColor: e.target.value || null })}
                        placeholder="transparent"
                      />
                      {selectedRule.backgroundColor && (
                        <button
                          className="template-color-clear"
                          onClick={() => updateRule(selectedId!, { backgroundColor: null })}
                        >x</button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Layout: margin, indents */}
                <div className="template-editor-field-row">
                  <div className="template-editor-field">
                    <label>Margin Top (pt)</label>
                    <input
                      type="number"
                      className="dialog-input template-num-input"
                      value={selectedRule.marginTop}
                      onChange={(e) => updateRule(selectedId!, { marginTop: Number(e.target.value) || 0 })}
                      min={0}
                      step={1}
                    />
                  </div>
                  <div className="template-editor-field">
                    <label>Left Indent (in)</label>
                    <input
                      type="number"
                      className="dialog-input template-num-input"
                      value={selectedRule.leftIndent}
                      onChange={(e) => updateRule(selectedId!, { leftIndent: Number(e.target.value) || 0 })}
                      min={0}
                      step={0.25}
                    />
                  </div>
                  <div className="template-editor-field">
                    <label>Right Indent (in)</label>
                    <input
                      type="number"
                      className="dialog-input template-num-input"
                      value={selectedRule.rightIndent}
                      onChange={(e) => updateRule(selectedId!, { rightIndent: Number(e.target.value) || 0 })}
                      min={0}
                      step={0.25}
                    />
                  </div>
                </div>

                {/* Element flow */}
                <div className="template-editor-field-row">
                  <div className="template-editor-field">
                    <label>Next on Enter</label>
                    <select
                      className="dialog-input"
                      value={selectedRule.nextOnEnter}
                      onChange={(e) => updateRule(selectedId!, { nextOnEnter: e.target.value })}
                    >
                      {elementOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="template-editor-field">
                    <label>Next on Tab</label>
                    <select
                      className="dialog-input"
                      value={selectedRule.nextOnTab || ''}
                      onChange={(e) => updateRule(selectedId!, { nextOnTab: e.target.value || null })}
                    >
                      <option value="">None</option>
                      {elementOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Placeholder */}
                <div className="template-editor-field">
                  <label>Placeholder Text</label>
                  <input
                    className="dialog-input"
                    value={selectedRule.placeholder}
                    onChange={(e) => updateRule(selectedId!, { placeholder: e.target.value })}
                    placeholder="Shown when element is empty"
                  />
                </div>

                {/* Preview */}
                <div className="template-editor-field">
                  <label>Preview</label>
                  <div
                    className="template-editor-preview"
                    style={{
                      fontWeight: selectedRule.bold ? 'bold' : 'normal',
                      fontStyle: selectedRule.italic ? 'italic' : 'normal',
                      textDecoration: [
                        selectedRule.underline ? 'underline' : '',
                        selectedRule.strikethrough ? 'line-through' : '',
                      ].filter(Boolean).join(' ') || 'none',
                      textTransform: selectedRule.textTransform as any,
                      textAlign: selectedRule.textAlign as any,
                      marginTop: `${selectedRule.marginTop}pt`,
                      paddingLeft: `${Math.max(0, (selectedRule.leftIndent - 1.5) * 96)}px`,
                      color: selectedRule.textColor || undefined,
                      backgroundColor: selectedRule.backgroundColor || undefined,
                    }}
                  >
                    {selectedRule.placeholder || selectedRule.label || 'Sample text...'}
                  </div>
                </div>
              </>
            ) : (
              <div className="template-editor-empty">
                Select an element from the list to edit its formatting.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TemplateEditorDialog;
