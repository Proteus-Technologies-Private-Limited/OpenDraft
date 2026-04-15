import React, { useMemo } from 'react';
import { useEditorStore, ELEMENT_LABELS } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { computeSceneTiming, formatRuntime } from '../utils/scriptTiming';

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

  const saveDisplay = SAVE_STATUS_DISPLAY[saveStatus] || SAVE_STATUS_DISPLAY.idle;

  const estimatedRuntime = useMemo(() => {
    if (!editorDoc) return '';
    try {
      const result = computeSceneTiming(editorDoc as any);
      return result.totalSeconds > 0 ? formatRuntime(result.totalSeconds) : '';
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
          {ELEMENT_LABELS[activeElement]}
        </span>
      </div>
      <div className="status-right">
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
