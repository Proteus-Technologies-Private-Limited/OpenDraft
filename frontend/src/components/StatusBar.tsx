import React, { useMemo } from 'react';
import { useEditorStore, ELEMENT_LABELS, type BuiltInElementType } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { computeSceneTiming, formatRuntime } from '../utils/scriptTiming';
import { computeScriptStructure } from '../utils/scriptStructure';

const SAVE_STATUS_DISPLAY: Record<string, { label: string; className: string }> = {
  idle: { label: '', className: '' },
  unsaved: { label: 'Unsaved changes', className: 'status-save-unsaved' },
  saving: { label: 'Saving\u2026', className: 'status-save-saving' },
  saved: { label: 'Saved', className: 'status-save-saved' },
  error: { label: 'Save failed', className: 'status-save-error' },
};

interface StatusBarProps {
  editorDoc?: Record<string, unknown> | null;
}

const StatusBar: React.FC<StatusBarProps> = ({ editorDoc = null }) => {
  const {
    activeElement,
    pageCount,
    currentPage,
    revisionMode,
    revisionColor,
    documentTitle,
    saveStatus,
  } = useEditorStore();

  const { currentProject } = useProjectStore();
  const getActiveTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate);

  const saveDisplay = SAVE_STATUS_DISPLAY[saveStatus] || SAVE_STATUS_DISPLAY.idle;

  const elementLabel = useMemo(() => {
    const builtIn = (ELEMENT_LABELS as Record<string, string>)[activeElement as BuiltInElementType];
    if (builtIn) return builtIn;
    try {
      const rule = getActiveTemplate().rules[activeElement];
      return rule?.label || activeElement;
    } catch {
      return activeElement;
    }
  }, [activeElement, getActiveTemplate]);

  const estimatedRuntime = useMemo(() => {
    if (!editorDoc) return '';
    try {
      const result = computeSceneTiming(editorDoc as any);
      return result.totalSeconds > 0 ? formatRuntime(result.totalSeconds) : '';
    } catch {
      return '';
    }
  }, [editorDoc]);

  const currentAct = useMemo(() => {
    if (!editorDoc) return '';
    try {
      const structure = computeScriptStructure(editorDoc as any);
      const realActs = structure.acts.filter((a) => a.actNumber > 0);
      if (realActs.length === 0) return '';
      return `${realActs.length} act${realActs.length === 1 ? '' : 's'}`;
    } catch {
      return '';
    }
  }, [editorDoc]);

  return (
    <div className="status-bar">
      <div className="status-left">
        {currentProject && (
          <span className="status-item status-project">{currentProject.name}</span>
        )}
        {currentProject && <span className="status-sep">/</span>}
        <span className="status-item">{documentTitle}</span>
        {saveDisplay.label && (
          <>
            <span className="status-sep">&middot;</span>
            <span className={`status-item ${saveDisplay.className}`}>{saveDisplay.label}</span>
          </>
        )}
      </div>
      <div className="status-center">
        <span className="status-item status-element">
          {elementLabel}
        </span>
      </div>
      <div className="status-right">
        {currentAct && (
          <span className="status-item status-acts" title="Act structure">
            {currentAct}
          </span>
        )}
        {estimatedRuntime && (
          <span className="status-item status-timing" title="Estimated runtime">
            Est. {estimatedRuntime}
          </span>
        )}
        {revisionMode && (
          <span className="status-item status-revision">
            Rev: {revisionColor}
          </span>
        )}
        <span className="status-item status-page">
          Page {currentPage} of {pageCount}
        </span>
      </div>
    </div>
  );
};

export default StatusBar;
