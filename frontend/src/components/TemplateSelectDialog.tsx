/**
 * Template selection and management dialog for per-document template assignment.
 * Opened from Format > Formatting Template... in the menu bar.
 *
 * Templates are categorized as:
 * - System Standard: read-only templates (e.g. Industry Standard) — cannot be edited or deleted
 * - User Defined: custom templates created by the user — fully editable
 *
 * When applying a template, detects conflicts (disabled elements, locked formatting
 * violations) and shows a resolution dialog before applying.
 */

import React, { useState, useEffect } from 'react';
import { ModalOverlay } from './ModalOverlay';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { templateDescription, templateName } from '../utils/templateLabels';
import { useFormattingTemplateStore, SYSTEM_TEMPLATES, SYSTEM_TEMPLATE_LIST, findTemplate, applyDocumentTemplate } from '../stores/formattingTemplateStore';
import { INDUSTRY_STANDARD_ID } from '../stores/formattingTypes';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import type { FormattingTemplate } from '../stores/formattingTypes';
import TemplateEditorDialog from './TemplateEditorDialog';
import TemplateConflictDialog from './TemplateConflictDialog';
import { detectTemplateConflicts, resolveTemplateConflicts, getEnabledElementOptions } from '../utils/templateConflicts';
import type { TemplateConflicts } from '../utils/templateConflicts';
import { showToast } from './Toast';
import { useSettingsStore } from '../stores/settingsStore';

import { parseTemplateSnapshot, sameTemplateDefinition } from '../utils/templateSnapshot';

const DOCUMENT_FORMAT = '__document_format_selection__';

interface TemplateSelectDialogProps {
  editor: Editor | null;
  onClose: () => void;
}

const TemplateSelectDialog: React.FC<TemplateSelectDialogProps> = ({ editor, onClose }) => {
  const { t } = useTranslation(['templates', 'common']);
  const {
    templates,
    activeTemplateId,
    documentTemplate,
    unreadableTemplateSnapshot,
    setActiveTemplateId,
    loadTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
  } = useFormattingTemplateStore();

  const defaultScriptFormat = useSettingsStore((s) => s.defaultScriptFormat);

  const libraryTemplate = findTemplate(documentTemplate?.id);
  const showDocumentTemplate = !!documentTemplate && (!libraryTemplate || !sameTemplateDefinition(documentTemplate, libraryTemplate));
  const documentIsActive = !!documentTemplate && !libraryTemplate;
  const [selection, setSelection] = useState<{ id: string | null } | null>(null);
  const selectedId = selection && (selection.id !== DOCUMENT_FORMAT || showDocumentTemplate)
    ? selection.id : documentIsActive ? DOCUMENT_FORMAT : activeTemplateId;
  const setSelectedId = (id: string | null) => setSelection({ id });
  const [editingDocument, setEditingDocument] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FormattingTemplate | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<TemplateConflicts | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<FormattingTemplate | null>(null);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Resolve which ID is currently the "active" one (null = Industry Standard)
  const resolvedActiveId = activeTemplateId || INDUSTRY_STANDARD_ID;

  // Resolve the selected template object — checks system templates first, then user-created.
  const getSelectedTemplate = (): FormattingTemplate => {
    if (selectedId === DOCUMENT_FORMAT && documentTemplate) return documentTemplate;
    if (!selectedId || selectedId === INDUSTRY_STANDARD_ID) {
      return INDUSTRY_STANDARD_TEMPLATE;
    }
    if (SYSTEM_TEMPLATES[selectedId]) return SYSTEM_TEMPLATES[selectedId];
    return templates.find((tpl) => tpl.id === selectedId) || INDUSTRY_STANDARD_TEMPLATE;
  };

  /** Returns true if the editor doc has no user-authored content (single empty paragraph or empty). */
  const isEmptyDoc = (): boolean => {
    if (!editor || editor.isDestroyed) return false;
    const doc = editor.state.doc;
    if (doc.childCount === 0) return true;
    if (doc.childCount === 1 && doc.firstChild?.textContent === '') return true;
    return false;
  };

  const applyTemplate = (template: FormattingTemplate) => {
    if (template === documentTemplate) {
      if (!applyDocumentTemplate(template)) {
        showToast(t('select.invalidDocumentApplied'), 'error');
        return;
      }
    } else if (template.id === INDUSTRY_STANDARD_ID) {
      setActiveTemplateId(null);
    } else {
      setActiveTemplateId(template.id);
    }
    // Seed starter content for empty docs (e.g. new-script flow). Existing content is left untouched.
    if (template.starterDocument && template.starterDocument.length > 0 && editor && !editor.isDestroyed && isEmptyDoc()) {
      try {
        editor.chain().focus().setContent({ type: 'doc', content: template.starterDocument as unknown as Record<string, unknown>[] }).run();
      } catch (err) {
        console.warn('[TemplateSelectDialog] failed to seed starter document', err);
      }
    }
    onClose();
  };

  /**
   * Make this template the format a new script starts on — the answer to "can I
   * set my own template as the default?" put where the writer made the
   * template, rather than only in Script Format Preferences.
   *
   * Being the default implies being one of the offered formats, so it is added
   * to the enabled list as well. It does not silence the New Screenplay picker:
   * a writer with several formats enabled means the next script could be any of
   * them, so the question is still asked with this answer already selected.
   */
  const toggleDefaultForNewScripts = (tpl: FormattingTemplate) => {
    const settings = useSettingsStore.getState();
    if (settings.defaultScriptFormat === tpl.id) {
      settings.setDefaultScriptFormat(null);
      showToast(t('select.noLongerDefault'), 'success');
      return;
    }
    if (!settings.enabledScriptFormats.includes(tpl.id)) {
      settings.setEnabledScriptFormats([...settings.enabledScriptFormats, tpl.id]);
    }
    settings.setDefaultScriptFormat(tpl.id);
    showToast(t('select.nowDefault', { name: templateName(tpl) }), 'success');
  };

  const handleApply = () => {
    const template = getSelectedTemplate();

    // Detect conflicts if we have an editor with content
    if (editor && !editor.isDestroyed) {
      const conflicts = detectTemplateConflicts(editor, template);
      if (conflicts.hasConflicts) {
        setPendingTemplate(template);
        setPendingConflicts(conflicts);
        return;
      }
    }

    applyTemplate(template);
  };

  const handleConflictResolve = (resolved: TemplateConflicts) => {
    if (editor && pendingTemplate) {
      resolveTemplateConflicts(editor, pendingTemplate, resolved);
    }
    if (pendingTemplate) applyTemplate(pendingTemplate);
    setPendingConflicts(null);
    setPendingTemplate(null);
  };

  const handleConflictSkip = () => {
    if (pendingTemplate) applyTemplate(pendingTemplate);
    setPendingConflicts(null);
    setPendingTemplate(null);
  };

  const handleConflictCancel = () => {
    setPendingConflicts(null);
    setPendingTemplate(null);
  };

  // Split templates by category — SYSTEM_TEMPLATE_LIST owns the canonical order of script-type templates.
  const systemTemplates: FormattingTemplate[] = SYSTEM_TEMPLATE_LIST;
  const userTemplates: FormattingTemplate[] = templates.filter((tpl) => tpl.category !== 'system');

  const renderTemplateItem = (tpl: FormattingTemplate) => {
    const isSystem = tpl.category === 'system';
    const isSelected = (tpl.id === INDUSTRY_STANDARD_ID && (!selectedId || selectedId === INDUSTRY_STANDARD_ID))
      || tpl.id === selectedId;
    const isCurrent = !documentIsActive && tpl.id === resolvedActiveId;
    const isDefault = tpl.id === defaultScriptFormat;
    return (
      <div
        key={tpl.id}
        className={`template-select-item${isSelected ? ' selected' : ''}`}
        onClick={() => setSelectedId(tpl.id)}
      >
        <div className="template-select-item-info">
          <span className="template-select-item-name">
            {templateName(tpl)}
            {isCurrent && <span className="template-select-current-badge">{t('select.currentBadge')}</span>}
            {isDefault && <span className="template-select-default-badge">{t('format.defaultBadge')}</span>}
          </span>
          <span className={`template-select-mode-badge template-select-mode-${tpl.mode}`}>
            {tpl.mode === 'enforce' ? t('select.modeEnforce') : t('select.modeOverride')}
          </span>
        </div>
        {tpl.description && (
          <span className="template-select-item-desc">{templateDescription(tpl)}</span>
        )}
        {/* Actions: any format can be made the one new scripts start on;
            system = duplicate only, user = edit/duplicate/delete */}
        <div className="template-select-item-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className={`dialog-btn dialog-btn-sm${isDefault ? ' dialog-btn-primary' : ''}`}
            title={isDefault
              ? t('format.defaultTooltipClear')
              : t('format.defaultTooltipSet')}
            onClick={() => toggleDefaultForNewScripts(tpl)}
          >
            {isDefault ? t('format.isDefault') : t('format.makeDefault')}
          </button>
          {isSystem ? (
            <button
              className="dialog-btn dialog-btn-sm"
              onClick={async () => {
                const dup = await duplicateTemplate(tpl.id);
                setEditingTemplate(dup);
              }}
            >
              {t('select.duplicate')}
            </button>
          ) : (
            <>
              <button
                className="dialog-btn dialog-btn-sm"
                onClick={() => setEditingTemplate(tpl)}
              >
                {t('common:edit')}
              </button>
              <button
                className="dialog-btn dialog-btn-sm"
                onClick={async () => {
                  await duplicateTemplate(tpl.id);
                  showToast(t('select.duplicated'), 'success');
                }}
              >
                {t('select.duplicate')}
              </button>
              <button
                className="dialog-btn dialog-btn-sm dialog-btn-danger"
                onClick={async () => {
                  if (confirm(t('select.confirmDelete', { name: templateName(tpl) }))) {
                    await deleteTemplate(tpl.id);
                    if (selectedId === tpl.id) setSelectedId(INDUSTRY_STANDARD_ID);
                    showToast(t('select.deleted'), 'success');
                  }
                }}
              >
                {t('common:delete')}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <ModalOverlay className="template-select-overlay" onClick={onClose}>
      <div className="template-select-dialog template-select-dialog-wide" onClick={(e) => e.stopPropagation()}>
        <h3>{t('select.title')}</h3>
        <p className="template-select-hint">
          {t('select.hint')}
        </p>

        {unreadableTemplateSnapshot != null && <p className="template-select-hint" role="alert">{t('select.unreadable')}</p>}

        {/* Template list */}
        <div className="template-select-list">
          {showDocumentTemplate && documentTemplate && <>
            <div className="template-select-category">{t('select.thisDocument')}</div>
            <div className={`template-select-item document-template-card${selectedId === DOCUMENT_FORMAT ? ' selected' : ''}`}>
              <div className="template-select-item-info">
                <button className="dialog-btn" onClick={() => setSelectedId(DOCUMENT_FORMAT)}>{documentTemplate.name} {documentIsActive && <span className="template-select-current-badge">{t('select.currentBadge')}</span>}</button>
                <span className="template-select-hint">{libraryTemplate
                  ? (Date.parse(libraryTemplate.updatedAt) > Date.parse(documentTemplate.updatedAt)
                    ? t('select.libraryNewer')
                    : Date.parse(documentTemplate.updatedAt) > Date.parse(libraryTemplate.updatedAt)
                      ? t('select.savedNewer')
                      : t('select.libraryInUse'))
                  : t('select.savedWithScript')}</span>
              </div>
              <div className="template-select-item-actions">
                <button className="dialog-btn dialog-btn-sm" onClick={() => { setEditingDocument(true); setEditingTemplate(libraryTemplate || documentTemplate); }}>{libraryTemplate ? t('select.editCurrent') : t('select.editDocument')}</button>
                <button className="dialog-btn dialog-btn-sm" onClick={async () => {
                  try {
                    const copy = await createTemplate({
                      ...JSON.parse(JSON.stringify(documentTemplate)),
                      name: `${documentTemplate.name} (Copy)`, // i18n-ignore: stored as the new template's name
                      category: 'user',
                    });
                    setSelectedId(copy.id);
                    showToast(t('select.copied'), 'success');
                  } catch (err) {
                    console.warn('[TemplateSelectDialog] could not copy the document format', err);
                    showToast(
                      err instanceof Error ? err.message : t('select.copyFailed'),
                      'error',
                    );
                  }
                }}>{t('select.saveToMine')}</button>
              </div>
            </div>
          </>}
          {/* Script formats (system templates) */}
          <div className="template-select-category">{t('select.scriptFormats')}</div>
          {systemTemplates.map(tpl => renderTemplateItem(tpl))}

          {/* User Defined section */}
          <div className="template-select-category">{t('select.userDefined')}</div>
          {userTemplates.length === 0 ? (
            <div className="template-select-empty">{t('select.noCustom')}</div>
          ) : (
            userTemplates.map(tpl => renderTemplateItem(tpl))
          )}
        </div>

        {/* Template management buttons */}
        <div className="template-select-management">
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={async () => {
              const created = await createTemplate({ name: 'New Template' /* i18n-ignore: stored as the new template's name */ });
              setEditingTemplate(created);
            }}
          >
            {t('select.create')}
          </button>
        </div>

        {/* Actions */}
        <div className="template-select-actions">
          <button className="dialog-btn" onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleApply}>{t('common:apply')}</button>
        </div>

        {/* Template Editor sub-dialog */}
        {editingTemplate && (
          <TemplateEditorDialog
            template={editingTemplate}
            onSave={async (updated) => {
              if (!parseTemplateSnapshot(updated, updated.id)) {
                showToast(t('select.invalidSettings'), 'error');
                return;
              }
              if (editingDocument) {
                if (!applyDocumentTemplate(updated)) {
                  showToast(t('select.invalidDocumentSaved'), 'error');
                  return;
                }
                setSelectedId(DOCUMENT_FORMAT);
              } else await updateTemplate(updated.id, updated);
              setEditingDocument(false);
              setEditingTemplate(null);
              showToast(t('select.saved'), 'success');
            }}
            onCancel={() => { setEditingTemplate(null); setEditingDocument(false); }}
          />
        )}

        {/* Template Conflict Resolution sub-dialog */}
        {pendingConflicts && pendingTemplate && (
          <TemplateConflictDialog
            conflicts={pendingConflicts}
            enabledElements={getEnabledElementOptions(pendingTemplate)}
            templateName={templateName(pendingTemplate)}
            onResolve={handleConflictResolve}
            onSkip={handleConflictSkip}
            onCancel={handleConflictCancel}
          />
        )}
      </div>
    </ModalOverlay>
  );
};

export default TemplateSelectDialog;
