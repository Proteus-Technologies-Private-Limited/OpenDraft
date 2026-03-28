import React from 'react';
import { useEditorStore, ELEMENT_LABELS } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';

const StatusBar: React.FC = () => {
  const {
    activeElement,
    pageCount,
    currentPage,
    revisionMode,
    revisionColor,
    documentTitle,
  } = useEditorStore();

  const { currentProject } = useProjectStore();

  return (
    <div className="status-bar">
      <div className="status-left">
        {currentProject && (
          <span className="status-item status-project">{currentProject.name}</span>
        )}
        {currentProject && <span className="status-sep">/</span>}
        <span className="status-item">{documentTitle}</span>
      </div>
      <div className="status-center">
        <span className="status-item status-element">
          {ELEMENT_LABELS[activeElement]}
        </span>
      </div>
      <div className="status-right">
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
