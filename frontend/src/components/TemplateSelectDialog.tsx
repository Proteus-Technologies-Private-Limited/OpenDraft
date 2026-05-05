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
import type { Editor } from '@tiptap/react';
import { useFormattingTemplateStore, SYSTEM_TEMPLATES, SYSTEM_TEMPLATE_LIST } from '../stores/formattingTemplateStore';
import { INDUSTRY_STANDARD_ID } from '../stores/formattingTypes';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import type { FormattingTemplate } from '../stores/formattingTypes';
import TemplateEditorDialog from './TemplateEditorDialog';
import TemplateConflictDialog from './TemplateConflictDialog';
import { detectTemplateConflicts, resolveTemplateConflicts, getEnabledElementOptions } from '../utils/templateConflicts';
import type { TemplateConflicts } from '../utils/templateConflicts';
import { showToast } from './Toast';

interface TemplateSelectDialogProps {
  editor: Editor | null;
  onClose: () => void;
}

const TemplateSelectDialog: React.FC<TemplateSelectDialogProps> = ({ editor, onClose }) => {
  const {
    templates,
    activeTemplateId,
    setActiveTemplateId,
    loadTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
  } = useFormattingTemplateStore();

  const [selectedId, setSelectedId] = useState<string | null>(activeTemplateId);
  const [editingTemplate, setEditingTemplate] = useState<FormattingTemplate | null>(null);
  const [pendingConflicts, setPendingConflicts] = useState<TemplateConflicts | null>(null);
  const [pendingTemplate, setPendingTemplate] = useState<FormattingTemplate | null>(null);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);

  // Resolve which ID is currently the "active" one (null = Industry Standard)
  const resolvedActiveId = activeTemplateId || INDUSTRY_STANDARD_ID;

  // Resolve the selected template object — checks system templates first, then user-created.
  const getSelectedTemplate = (): FormattingTemplate => {
    if (!selectedId || selectedId === INDUSTRY_STANDARD_ID) {
      return INDUSTRY_STANDARD_TEMPLATE;
    }
    if (SYSTEM_TEMPLATES[selectedId]) return SYSTEM_TEMPLATES[selectedId];
    return templates.find((t) => t.id === selectedId) || INDUSTRY_STANDARD_TEMPLATE;
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
    if (template.id === INDUSTRY_STANDARD_ID) {
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
  const userTemplates: FormattingTemplate[] = templates.filter((t) => t.category !== 'system');

  const renderTemplateItem = (t: FormattingTemplate) => {
    const isSystem = t.category === 'system';
    const isSelected = (t.id === INDUSTRY_STANDARD_ID && (!selectedId || selectedId === INDUSTRY_STANDARD_ID))
      || t.id === selectedId;
    const isCurrent = t.id === resolvedActiveId;
    return (
      <div
        key={t.id}
        className={`template-select-item${isSelected ? ' selected' : ''}`}
        onClick={() => setSelectedId(t.id)}
      >
        <div className="template-select-item-info">
          <span className="template-select-item-name">
            {t.name}
            {isCurrent && <span className="template-select-current-badge">current</span>}
          </span>
          <span className={`template-select-mode-badge template-select-mode-${t.mode}`}>
            {t.mode}
          </span>
        </div>
        {t.description && (
          <span className="template-select-item-desc">{t.description}</span>
        )}
        {/* Actions: system = duplicate only; user = edit/duplicate/delete */}
        <div className="template-select-item-actions" onClick={(e) => e.stopPropagation()}>
          {isSystem ? (
            <button
              className="dialog-btn dialog-btn-sm"
              onClick={async () => {
                const dup = await duplicateTemplate(t.id);
                setEditingTemplate(dup);
              }}
            >
              Duplicate
            </button>
          ) : (
            <>
              <button
                className="dialog-btn dialog-btn-sm"
                onClick={() => setEditingTemplate(t)}
              >
                Edit
              </button>
              <button
                className="dialog-btn dialog-btn-sm"
                onClick={async () => {
                  await duplicateTemplate(t.id);
                  showToast('Template duplicated', 'success');
                }}
              >
                Duplicate
              </button>
              <button
                className="dialog-btn dialog-btn-sm dialog-btn-danger"
                onClick={async () => {
                  if (confirm(`Delete template "${t.name}"?`)) {
                    await deleteTemplate(t.id);
                    if (selectedId === t.id) setSelectedId(INDUSTRY_STANDARD_ID);
                    showToast('Template deleted', 'success');
                  }
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="template-select-overlay" onClick={onClose}>
      <div className="template-select-dialog template-select-dialog-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Script Format / Template</h3>
        <p className="template-select-hint">
          Choose a script format (screenplay, sitcom, drama, stage play, radio) or a custom formatting template.
          The template controls element-level formatting rules; for an empty document, choosing a script type also seeds starter content.
        </p>

        {/* Template list */}
        <div className="template-select-list">
          {/* Script formats (system templates) */}
          <div className="template-select-category">Script Formats</div>
          {systemTemplates.map(renderTemplateItem)}

          {/* User Defined section */}
          <div className="template-select-category">User Defined</div>
          {userTemplates.length === 0 ? (
            <div className="template-select-empty">No custom templates yet.</div>
          ) : (
            userTemplates.map(renderTemplateItem)
          )}
        </div>

        {/* Template management buttons */}
        <div className="template-select-management">
          <button
            className="dialog-btn dialog-btn-primary"
            onClick={async () => {
              const t = await createTemplate({ name: 'New Template' });
              setEditingTemplate(t);
            }}
          >
            + Create Template
          </button>
        </div>

        {/* Actions */}
        <div className="template-select-actions">
          <button className="dialog-btn" onClick={onClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleApply}>Apply</button>
        </div>

        {/* Template Editor sub-dialog */}
        {editingTemplate && (
          <TemplateEditorDialog
            template={editingTemplate}
            onSave={async (updated) => {
              await updateTemplate(updated.id, updated);
              setEditingTemplate(null);
              showToast('Template saved', 'success');
            }}
            onCancel={() => setEditingTemplate(null)}
          />
        )}

        {/* Template Conflict Resolution sub-dialog */}
        {pendingConflicts && pendingTemplate && (
          <TemplateConflictDialog
            conflicts={pendingConflicts}
            enabledElements={getEnabledElementOptions(pendingTemplate)}
            templateName={pendingTemplate.name}
            onResolve={handleConflictResolve}
            onSkip={handleConflictSkip}
            onCancel={handleConflictCancel}
          />
        )}
      </div>
    </div>
  );
};

export default TemplateSelectDialog;
