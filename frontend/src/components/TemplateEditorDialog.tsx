/**
 * Template Editor Dialog — full-featured editor for formatting templates.
 *
 * Allows customizing every aspect of each element type:
 * text style, layout, transitions, placeholder, colors, etc.
 * Also supports adding/removing custom element types.
 */

import React, { useState, useCallback } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { Trans, useTranslation } from 'react-i18next';
import { t as translate } from '../i18n';
import {
  FaBold, FaItalic, FaUnderline, FaStrikethrough,
  FaAlignLeft, FaAlignCenter, FaAlignRight, FaAlignJustify,
  FaPlus, FaTrash,
} from 'react-icons/fa';
import type { FormattingTemplate, FormattingElementRule, ElementNumbering } from '../stores/formattingTypes';
import { isNumberableElementId, resetElementIds, numberInWords, isInlineNumbering } from '../utils/elementNumbers';
import { createDefaultRule, AV_BLOCK_RULE_ID, type AvCellPlacement } from '../stores/formattingTypes';
import { avPlacementOf } from '../utils/avCellElements';
import { AV_BASE_CELL_ELEMENT_IDS, AV_SCREENPLAY_CELL_ELEMENT_IDS } from '../editor/extensions/AvBlock';
import Select from './Select';

/** The four AV paragraph types: always offered in both columns, so the control
 *  shows what they are rather than pretending it is a choice. */
const AV_BASE_IDS = new Set<string>(AV_BASE_CELL_ELEMENT_IDS);

/** Elements that CAN be placed in an AV column. A template's own custom
 *  elements ride in on `customElement`, so they qualify too; the document-level
 *  furniture an `avCell` will not hold (act breaks, cast lists, the title page)
 *  does not, and gets no control. */
function avPlaceable(rule: { id: string; isBuiltIn: boolean }): boolean {
  if (AV_BASE_IDS.has(rule.id)) return true;
  if (!rule.isBuiltIn) return true;
  return (AV_SCREENPLAY_CELL_ELEMENT_IDS as readonly string[]).includes(rule.id);
}
import FontPicker from './FontPicker';

/** Rules whose numbering no longer names an element the template has lost. */
function withoutStaleResets(rules: Record<string, FormattingElementRule>): Record<string, FormattingElementRule> {
  const out: Record<string, FormattingElementRule> = {};
  for (const [id, rule] of Object.entries(rules)) {
    const n = rule.numbering;
    out[id] = n && n.resetOn.some((r) => !rules[r])
      ? { ...rule, numbering: { ...n, resetOn: n.resetOn.filter((r) => rules[r]) } }
      : rule;
  }
  return out;
}

/** "SFX 1, SFX 2, SFX 3 … starting again at every Scene Heading." */
function numberingSummary(n: ElementNumbering, rules: Record<string, FormattingElementRule>): string {
  // Counting with another element: that element's start and restarts apply.
  const owner = n.countWith && rules[n.countWith]?.numbering?.enabled && !rules[n.countWith].numbering?.countWith
    ? rules[n.countWith] : null;
  const counting = owner?.numbering ?? n;
  const start = counting.startAt ?? 1;
  const sample = [start, start + 1, start + 2]
    .map((k) => `${n.prefix ?? ''}${n.style === 'scene' ? `12.${k}` : n.style === 'words' ? numberInWords(k) : k}`)
    .join(', ');
  const resets = counting.resetOn.filter((id) => rules[id]).map((id) => rules[id].label);
  const sampleText = sample;
  const ownerLabel = owner?.label ?? '';
  let core: string;
  if (resets.length === 0) {
    core = owner
      ? translate('templates:editor.numbering.summaryWholeShared', { sample: sampleText, owner: ownerLabel })
      : translate('templates:editor.numbering.summaryWhole', { sample: sampleText });
  } else {
    const list = resets.join(translate('templates:editor.numbering.orJoiner'));
    core = owner
      ? translate('templates:editor.numbering.summaryResetShared', { sample: sampleText, resets: list, owner: ownerLabel })
      : translate('templates:editor.numbering.summaryReset', { sample: sampleText, resets: list });
  }
  const scene = n.style === 'scene' ? ` ${translate('templates:editor.numbering.summaryScene')}` : '';
  const where = isInlineNumbering(n) ? ` ${translate('templates:editor.numbering.summaryInline')}` : '';
  return `${core}${scene}${where}`;
}

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
  const { t } = useTranslation(['templates', 'common']);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [mode, setMode] = useState<'enforce' | 'override'>(initial.mode);
  const [rules, setRules] = useState<Record<string, FormattingElementRule>>(
    JSON.parse(JSON.stringify(initial.rules)),
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    Object.keys(rules)[0] || null,
  );
  /** The element just added with "+ New", so its label is ready to type over. */
  const [newElementId, setNewElementId] = useState<string | null>(null);
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
    const newRule = createDefaultRule(id, 'Custom Element' /* i18n-ignore: stored as the element's label */, false);
    setRules((prev) => ({ ...prev, [id]: newRule }));
    setSelectedId(id);
    setNewElementId(id);
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
      rules: withoutStaleResets(rules),
      // Only keep break rules for elements that still exist in the template.
      forceBreakBefore: forceBreakBefore.filter((id) => rules[id]),
      updatedAt: new Date().toISOString(),
    });
  };

  const numbering: ElementNumbering | undefined = selectedRule?.numbering;
  const updateNumbering = (updates: Partial<ElementNumbering>) => {
    if (!selectedId) return;
    const base: ElementNumbering = numbering ?? { enabled: false, resetOn: [] };
    updateRule(selectedId, { numbering: { ...base, ...updates } });
  };
  const toggleReset = (id: string, on: boolean) => {
    const current = numbering?.resetOn ?? [];
    updateNumbering({ resetOn: on ? (current.includes(id) ? current : [...current, id]) : current.filter((x) => x !== id) });
  };

  // Build element options for dropdowns (for nextOnEnter/nextOnTab)
  const elementOptions = Object.values(rules)
    .filter((r) => r.enabled && r.id !== AV_BLOCK_RULE_ID)
    .map((r) => ({ id: r.id, label: r.label }));

  return (
    <ModalOverlay className="template-editor-overlay" onClick={onCancel}>
      <div className="template-editor-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="template-editor-header">
          <h2>{t('editor.title')}</h2>
          <div className="template-editor-header-actions">
            <button className="dialog-btn" onClick={onCancel}>{t('common:cancel')}</button>
            <button className="dialog-btn dialog-btn-primary" onClick={handleSave}>{t('common:save')}</button>
          </div>
        </div>

        {/* Template meta */}
        <div className="template-editor-meta">
          <div className="template-editor-field">
            <label>{t('common:name')}</label>
            <input
              className="dialog-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('editor.namePlaceholder')}
            />
          </div>
          <div className="template-editor-field">
            <label>{t('editor.description')}</label>
            <input
              className="dialog-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('editor.descriptionPlaceholder')}
            />
          </div>
          <div className="template-editor-field">
            <label>{t('editor.mode')}</label>
            <div className="template-editor-mode-toggle">
              <button
                className={`template-mode-btn${mode === 'enforce' ? ' active' : ''}`}
                onClick={() => setMode('enforce')}
              >
                {t('editor.modeEnforce')}
              </button>
              <button
                className={`template-mode-btn${mode === 'override' ? ' active' : ''}`}
                onClick={() => setMode('override')}
              >
                {t('editor.modeOverride')}
              </button>
            </div>
            <span className="template-editor-hint">
              {mode === 'enforce'
                ? t('editor.modeEnforceHint')
                : t('editor.modeOverrideHint')}
            </span>
          </div>
        </div>

        {/* Main body: element list + detail */}
        <div className="template-editor-body">
          {/* Left: element list */}
          <div className="template-editor-elements">
            <div className="template-editor-elements-header">
              <span>{t('editor.elements')}</span>
              <button
                className="template-add-btn"
                onClick={addCustomElement}
                title={t('editor.addElementTitle')}
              >
                <FaPlus /> {t('editor.addElement')}
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
                    {!rule.isBuiltIn && <span className="template-custom-badge">{t('editor.customBadge')}</span>}
                  </span>
                  {!rule.isBuiltIn && (
                    <button
                      className="template-delete-btn"
                      onClick={(e) => { e.stopPropagation(); removeElement(rule.id); }}
                      title={t('editor.removeElement')}
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
            {selectedRule && selectedRule.id === AV_BLOCK_RULE_ID ? (
              /* An AV body is a table, not a paragraph: the formatting lives on
                 the elements inside its cells, which are edited on their own
                 rows in this list. The only decision here is the tick box
                 beside it — whether the element menu offers it at all. */
              <div className="template-editor-empty">
                <p><strong>{selectedRule.label}</strong></p>
                <p>{t('editor.av.inserts')}</p>
                <p>
                  <Trans ns="templates" i18nKey="editor.av.noFormatting" components={{ em: <em /> }} />
                </p>
                <p>{t('editor.av.untick')}</p>
              </div>
            ) : selectedRule ? (
              <>
                {/* Label */}
                <div className="template-editor-field">
                  <label>{t('editor.label')}</label>
                  <input
                    className="dialog-input"
                    value={selectedRule.label}
                    key={selectedId}
                    autoFocus={!!newElementId && selectedId === newElementId}
                    onFocus={(e) => { if (newElementId && selectedId === newElementId) e.target.select(); }}
                    onChange={(e) => updateRule(selectedId!, { label: e.target.value })}
                    disabled={selectedRule.isBuiltIn}
                    placeholder={t('editor.labelPlaceholder')}
                  />
                </div>

                {/* Font family & size */}
                <div className="template-editor-field-row">
                  <div className="template-editor-field">
                    <label>{t('editor.fontFamily')}</label>
                    <FontPicker
                      className="dialog-input"
                      emptyLabel={t('common:default')}
                      value={selectedRule.fontFamily || ''}
                      onChange={(name) => updateRule(selectedId!, { fontFamily: name || null })}
                    />
                  </div>
                  <div className="template-editor-field">
                    <label>{t('editor.fontSize')}</label>
                    <Select
                      className="dialog-input"
                      value={selectedRule.fontSize ?? ''}
                      onChange={(e) => updateRule(selectedId!, { fontSize: e.target.value ? Number(e.target.value) : null })}
                    >
                      <option value="">{t('common:default')}</option>
                      {FONT_SIZES.map((s) => (
                        <option key={s} value={s}>{s}pt{/* i18n-ignore: unit */}</option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* Text style toggles */}
                <div className="template-editor-field">
                  <label>{t('editor.textStyle')}</label>
                  <div className="template-style-toggles">
                    <button
                      className={`template-style-btn${selectedRule.bold ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { bold: !selectedRule.bold })}
                      title={t('editor.bold')}
                    ><FaBold /></button>
                    <button
                      className={`template-style-btn${selectedRule.italic ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { italic: !selectedRule.italic })}
                      title={t('editor.italic')}
                    ><FaItalic /></button>
                    <button
                      className={`template-style-btn${selectedRule.underline ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { underline: !selectedRule.underline })}
                      title={t('editor.underline')}
                    ><FaUnderline /></button>
                    <button
                      className={`template-style-btn${selectedRule.strikethrough ? ' active' : ''}`}
                      onClick={() => updateRule(selectedId!, { strikethrough: !selectedRule.strikethrough })}
                      title={t('editor.strikethrough')}
                    ><FaStrikethrough /></button>
                  </div>
                </div>

                {/* Text transform */}
                <div className="template-editor-field">
                  <label>{t('editor.textTransform')}</label>
                  <Select
                    className="dialog-input"
                    value={selectedRule.textTransform}
                    onChange={(e) => updateRule(selectedId!, { textTransform: e.target.value as any })}
                  >
                    <option value="none">{t('common:none')}</option>
                    <option value="uppercase">{t('editor.uppercase')}</option>
                    <option value="lowercase">{t('editor.lowercase')}</option>
                  </Select>
                </div>

                {/* Alignment */}
                <div className="template-editor-field">
                  <label>{t('editor.alignment')}</label>
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
                    <label>{t('editor.textColor')}</label>
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
                        placeholder={t('editor.inherit')}
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
                    <label>{t('editor.backgroundColor')}</label>
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
                        placeholder={t('editor.transparent')}
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
                    <label>{t('editor.spaceBefore')}</label>
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
                    <label>{t('editor.leftIndent')}</label>
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
                    <label>{t('editor.rightIndent')}</label>
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
                    <label>{t('editor.nextOnEnter')}</label>
                    <Select
                      className="dialog-input"
                      value={selectedRule.nextOnEnter}
                      onChange={(e) => updateRule(selectedId!, { nextOnEnter: e.target.value })}
                    >
                      {elementOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="template-editor-field">
                    <label>{t('editor.nextOnTab')}</label>
                    <Select
                      className="dialog-input"
                      value={selectedRule.nextOnTab || ''}
                      onChange={(e) => updateRule(selectedId!, { nextOnTab: e.target.value || null })}
                    >
                      <option value="">{t('common:none')}</option>
                      {elementOptions.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </Select>
                  </div>
                </div>

                {/* AV placement — which column of a two-column AV body offers
                    this element. The schema accepts every one of them in either
                    cell; this is what the writer is OFFERED, and it is the whole
                    of the "what may an AV script contain" decision. */}
                {avPlaceable(selectedRule) && (
                  <div className="template-editor-field">
                    <label>{t('editor.av.inColumns')}</label>
                    <Select
                      className="dialog-input"
                      value={avPlacementOf(selectedRule)}
                      disabled={AV_BASE_IDS.has(selectedRule.id)}
                      title={AV_BASE_IDS.has(selectedRule.id)
                        ? t('editor.av.baseTitle')
                        : t('editor.av.columnTitle')}
                      onChange={(e) => updateRule(selectedId!, { avCell: e.target.value as AvCellPlacement })}
                    >
                      <option value="none">{t('editor.av.notOffered')}</option>
                      <option value="video">{t('editor.av.video')}</option>
                      <option value="audio">{t('editor.av.audio')}</option>
                      <option value="both">{t('editor.av.both')}</option>
                    </Select>
                  </div>
                )}

                {/* Placeholder */}
                <div className="template-editor-field">
                  <label>{t('editor.placeholderText')}</label>
                  <input
                    className="dialog-input"
                    value={selectedRule.placeholder}
                    onChange={(e) => updateRule(selectedId!, { placeholder: e.target.value })}
                    placeholder={t('editor.placeholderHint')}
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
                    {t('editor.newPage')}
                  </label>
                  <span className="template-editor-hint">
                    {forceBreakBefore.includes(selectedId!)
                      ? t('editor.newPageOn', { label: selectedRule.label })
                      : t('editor.newPageOff')}
                  </span>
                </div>

                {/* Numbering — running numbers beside this element (utils/elementNumbers). */}
                {isNumberableElementId(selectedRule.id) && (
                  <div className="template-editor-field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={numbering?.enabled === true}
                        onChange={(e) => updateNumbering({ enabled: e.target.checked })}
                      />
                      {t('editor.numbering.enable')}
                    </label>
                    {numbering?.enabled ? (
                      <>
                        <div className="template-editor-field-row">
                          <div className="template-editor-field">
                            <label>{t('editor.numbering.prefix')}</label>
                            <input
                              className="dialog-input"
                              value={numbering.prefix ?? ''}
                              maxLength={12}
                              placeholder={t('common:none')}
                              onChange={(e) => updateNumbering({ prefix: e.target.value })}
                            />
                          </div>
                          <div className="template-editor-field">
                            <label>{t('editor.numbering.startAt')}</label>
                            <input
                              className="dialog-input"
                              type="number"
                              min={0}
                              step={1}
                              value={numbering.startAt ?? 1}
                              onChange={(e) => {
                                const n = Number.parseInt(e.target.value, 10);
                                updateNumbering({ startAt: Number.isFinite(n) && n >= 0 ? n : 1 });
                              }}
                            />
                          </div>
                          <div className="template-editor-field">
                            <label>{t('editor.numbering.style')}</label>
                            <Select
                              className="dialog-input"
                              value={numbering.style ?? 'plain'}
                              onChange={(e) => updateNumbering({ style: e.target.value as 'plain' | 'scene' | 'words' })}
                            >
                              <option value="plain">{t('editor.numbering.stylePlain')}</option>
                              <option value="scene">{t('editor.numbering.styleScene')}</option>
                              <option value="words">{t('editor.numbering.styleWords')}</option>
                            </Select>
                          </div>
                        </div>
                        <div className="template-editor-field-row">
                          <div className="template-editor-field">
                            <label>{t('editor.numbering.show')}</label>
                            <Select
                              className="dialog-input"
                              value={numbering.placement ?? 'margin'}
                              onChange={(e) => updateNumbering({ placement: e.target.value as 'margin' | 'inline' })}
                            >
                              <option value="margin">{t('editor.numbering.inMargin')}</option>
                              <option value="inline">{t('editor.numbering.inline')}</option>
                            </Select>
                          </div>
                          <div className="template-editor-field">
                            <label>{t('editor.numbering.countWith')}</label>
                            <Select
                              className="dialog-input"
                              value={numbering.countWith ?? ''}
                              onChange={(e) => updateNumbering({ countWith: e.target.value || undefined })}
                            >
                              <option value="">{t('editor.numbering.ownCount')}</option>
                              {Object.keys(rules)
                                .filter((id) => id !== selectedRule.id && rules[id].enabled
                                  && rules[id].numbering?.enabled && !rules[id].numbering?.countWith)
                                .map((id) => <option key={id} value={id}>{rules[id].label}</option>)}
                            </Select>
                          </div>
                        </div>
                        <label>{t('editor.numbering.restartAt')}</label>
                        <div className="template-editor-reset-list">
                          {resetElementIds(rules).filter((id) => id !== selectedRule.id).map((id) => (
                            <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={(numbering.resetOn ?? []).includes(id)}
                                onChange={(e) => toggleReset(id, e.target.checked)}
                              />
                              {rules[id].label}
                            </label>
                          ))}
                        </div>
                        <span className="template-editor-hint">{numberingSummary(numbering, rules)}</span>
                      </>
                    ) : (
                      <span className="template-editor-hint">
                        {t('editor.numbering.hintOff', { label: selectedRule.label })}
                      </span>
                    )}
                  </div>
                )}

                {/* Format override */}
                {mode === 'enforce' && (
                  <div className="template-editor-field">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selectedRule.allowFormatOverride !== false}
                        onChange={(e) => updateRule(selectedId!, { allowFormatOverride: e.target.checked })}
                      />
                      {t('editor.allowOverride')}
                    </label>
                    <span className="template-editor-hint">
                      {selectedRule.allowFormatOverride !== false
                        ? t('editor.overrideOn')
                        : t('editor.overrideOff')}
                    </span>
                  </div>
                )}

                {/* Preview */}
                <div className="template-editor-field">
                  <label>{t('editor.preview')}</label>
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
                    {selectedRule.placeholder || selectedRule.label || t('editor.sampleText')}
                  </div>
                </div>
              </>
            ) : (
              <div className="template-editor-empty">
                {t('editor.selectElement')}
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default TemplateEditorDialog;
