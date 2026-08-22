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
import FontPicker from './FontPicker';

const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];

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
  /** Element ids that must open a new page (e.g. New Act in TV formats). */
  const [forceBreakBefore, setForceBreakBefore] = useState<string[]>(
    () => [...(initial.forceBreakBefore ?? [])],
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

  const toggleForceBreak = useCallback((id: string, on: boolean) => {
    setForceBreakBefore((prev) => (on
      ? (prev.includes(id) ? prev : [...prev, id])
      : prev.filter((x) => x !== id)));
  }, []);

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
      // Only keep break rules for elements that still exist in the template.
      forceBreakBefore: forceBreakBefore.filter((id) => rules[id]),
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

                {/* Font family & size */}
                <div className="template-editor-field-row">
                  <div className="template-editor-field">
                    <label>Font Family</label>
                    <FontPicker
                      className="dialog-input"
                      emptyLabel="Default"
                      value={selectedRule.fontFamily || ''}
                      onChange={(name) => updateRule(selectedId!, { fontFamily: name || null })}
                    />
                  </div>
                  <div className="template-editor-field">
                    <label>Font Size</label>
                    <select
                      className="dialog-input"
                      value={selectedRule.fontSize ?? ''}
                      onChange={(e) => updateRule(selectedId!, { fontSize: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">Default</option>
                      {FONT_SIZES.map((s) => (
                        <option key={s} value={s}>{s}pt</option>
                      ))}
                    </select>
                  </div>
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
                  {/* "Space Before", counted in blank lines, is what Final Draft
                      and Fade In both call this. It was labelled "Margin Top (pt)"
                      and took points, which meant reading a screenplay measurement
                      in a unit no screenplay format is specified in. Stored in
                      points still — only the input is in lines. */}
                  <div className="template-editor-field">
                    <label>Space Before (lines)</label>
                    <input
                      type="number"
                      className="dialog-input template-num-input"
                      value={Math.round(selectedRule.marginTop / 12)}
                      onChange={(e) => updateRule(selectedId!, {
                        marginTop: Math.max(0, Number(e.target.value) || 0) * 12,
                      })}
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

                {/* Pagination */}
                <div className="template-editor-field">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={forceBreakBefore.includes(selectedId!)}
                      onChange={(e) => toggleForceBreak(selectedId!, e.target.checked)}
                    />
                    Starts on a new page
                  </label>
                  <span className="template-editor-hint">
                    {forceBreakBefore.includes(selectedId!)
                      ? `Every “${selectedRule.label}” begins at the top of a fresh page, on screen and in PDF/Word exports.`
                      : 'This element flows with the rest of the page.'}
                  </span>
                </div>

                {/* Format override */}
                {mode === 'enforce' && (
                  <div className="template-editor-field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedRule.allowFormatOverride !== false}
                        onChange={(e) => updateRule(selectedId!, { allowFormatOverride: e.target.checked })}
                      />
                      Allow format override
                    </label>
                    <span className="template-editor-hint">
                      {selectedRule.allowFormatOverride !== false
                        ? 'Users can override formatting for this element type.'
                        : 'All formatting is locked — users cannot change any styling for this element.'}
                    </span>
                  </div>
                )}

                {/* Preview */}
                <div className="template-editor-field">
                  <label>Preview</label>
                  <div
                    className="template-editor-preview"
                    style={{
                      fontFamily: selectedRule.fontFamily || undefined,
                      fontSize: selectedRule.fontSize ? `${selectedRule.fontSize}pt` : undefined,
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
