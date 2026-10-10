import type { JSONContent } from '@tiptap/react';
import React, { useMemo } from 'react';
import { useEditorStore, ELEMENT_LABELS, type BuiltInElementType } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useLinkedFileStore } from '../stores/linkedFileStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { activeTimingOptions, computeSceneTiming, formatRuntime } from '../utils/scriptTiming';
import { computeScriptStructure } from '../utils/scriptStructure';
import { DEFAULT_PACING, pacingOption } from '../utils/scriptProfile';

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
    documentOrigin,
    pageLabels,
    pageLayout,
    sceneHeadingSpaceBefore,
    scriptProfile,
    setScriptProfileOpen,
  } = useEditorStore();
  // Locked pages read by their label ("Page 12A"), which is what the writer
  // will be asked for by the production.
  const currentLabel = pageLabels?.[currentPage - 1];

  const { currentProject, currentScriptId } = useProjectStore();
  // The file on disk a library script also saves to (issue #135), and whether
  // the last save reached it.
  const openScriptFile = useLinkedFileStore((s) => s.openScriptFile);
  const linkedStatus = useLinkedFileStore((s) => (currentScriptId ? s.byScript[currentScriptId] : undefined));
  const linkedPath = openScriptFile && openScriptFile.scriptId === currentScriptId
    ? (linkedStatus?.path || openScriptFile.path)
    : null;
  const linkedName = linkedPath ? linkedPath.split(/[/\\]/).pop() || linkedPath : '';
  const linkedProblem =
    linkedStatus?.state === 'pending' && linkedStatus.error ? 'not saved to file'
    : linkedStatus?.state === 'missing' ? 'file not found'
    : linkedStatus?.state === 'conflict' ? 'changed outside OpenDraft'
    : '';
  const retryLinkedFile = () => {
    void import('../services/linkedFiles')
      .then((lf) => lf.retryPendingWrites())
      .catch((err) => console.error('[linked-files] retry failed:', err));
  };
  const getActiveTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate);
  const activeTemplateId = useFormattingTemplateStore((s) => s.activeTemplateId);

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
      const result = computeSceneTiming(editorDoc as JSONContent, activeTimingOptions(pageLayout));
      return result.totalSeconds > 0 ? formatRuntime(result.totalSeconds) : '';
    } catch (err) {
      console.warn('[StatusBar] runtime estimate failed', err);
      return '';
    }
    // The estimate is measured against the page — its size, the template's
    // spacing and page time — so any of those changing re-measures it. The
    // template and spacing are read from their stores, hence the lint pragma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorDoc, pageLayout, sceneHeadingSpaceBefore, activeTemplateId, scriptProfile.pacing]);

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
        {/* Save overwrites this file rather than the library, so say which one
            — a writer editing a Dropbox screenplay needs to know that before
            they press Save, not after. */}
        {documentOrigin && (
          <>
            <span className="status-sep">&middot;</span>
            <span
              className="status-item status-origin"
              title={`Save writes back to ${documentOrigin.name}`}
            >
              {documentOrigin.name}
            </span>
          </>
        )}
        {linkedPath && (
          <>
            <span className="status-sep">&middot;</span>
            <span
              className={`status-item status-origin${linkedProblem ? ' status-save-error' : ''}`}
              title={linkedProblem
                ? `${linkedPath}\n${linkedStatus?.error || linkedProblem}${linkedStatus?.state === 'pending' ? '\nClick to try again.' : ''}`
                : `Every save also writes ${linkedPath}`}
              onClick={linkedStatus?.state === 'pending' ? retryLinkedFile : undefined}
              style={linkedStatus?.state === 'pending' ? { cursor: 'pointer' } : undefined}
            >
              {linkedName}{linkedProblem ? ` — ${linkedProblem}` : ''}
            </span>
          </>
        )}
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
          <button
            type="button"
            className="status-item status-timing"
            title={`Estimated runtime at ${pacingOption(scriptProfile.pacing).label.toLowerCase()} pacing — click to set genre & pacing`}
            onClick={() => setScriptProfileOpen(true)}
          >
            Est. {estimatedRuntime}
            {scriptProfile.pacing !== DEFAULT_PACING && (
              <span className="status-timing-pacing"> · {pacingOption(scriptProfile.pacing).label.toLowerCase()}</span>
            )}
          </button>
        )}
        {revisionMode && (
          <span className="status-item status-revision">
            Rev: {revisionColor}
          </span>
        )}
        <span className="status-item status-page">
          {currentLabel
            ? <>Page {currentLabel} <span className="status-locked" title="Pages are locked">(locked)</span></>
            : <>Page {currentPage} of {pageCount}</>}
        </span>
      </div>
    </div>
  );
};

export default StatusBar;
