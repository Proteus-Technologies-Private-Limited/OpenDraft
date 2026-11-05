import type { JSONContent } from '@tiptap/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore, ELEMENT_LABELS, type BuiltInElementType } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useLinkedFileStore } from '../stores/linkedFileStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { isTitlePageRuleId, titlePageRuleId, TITLE_PAGE_ELEMENTS } from '../stores/formattingTypes';
import { activeTimingOptions, computeSceneTiming, formatRuntime } from '../utils/scriptTiming';
import { computeScriptStructure } from '../utils/scriptStructure';
import { countWords } from '../utils/writingGoals';
import { jsonBlockText } from '../utils/nodeText';
import { DEFAULT_PACING, pacingOption } from '../utils/scriptProfile';
import WritingProgress from './WritingProgress';
import { useSuggestModeStore } from '../stores/suggestModeStore';
import { formatNumber } from '../i18n/format';
import { elementLabel as translateElement } from '../editor/elementLabels';

const SAVE_STATUS_CLASS: Record<string, string> = {
  idle: '',
  unsaved: 'status-save-unsaved',
  saving: 'status-save-saving',
  saved: 'status-save-saved',
  error: 'status-save-error',
};

interface StatusBarProps {
  editorDoc?: Record<string, unknown> | null;
}

const StatusBar: React.FC<StatusBarProps> = ({ editorDoc = null }) => {
  const { t } = useTranslation('toolbar');
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
    linkedStatus?.state === 'pending' && linkedStatus.error ? t('status.linked.notSaved')
    : linkedStatus?.state === 'missing' ? t('status.linked.missing')
    : linkedStatus?.state === 'conflict' ? t('status.linked.conflict')
    : '';
  const retryLinkedFile = () => {
    void import('../services/linkedFiles')
      .then((lf) => lf.retryPendingWrites())
      .catch((err) => console.error('[linked-files] retry failed:', err));
  };
  const getActiveTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate);
  const activeTemplateId = useFormattingTemplateStore((s) => s.activeTemplateId);

  const saveLabel =
    saveStatus === 'unsaved' ? t('status.save.unsaved')
    : saveStatus === 'saving' ? t('status.save.saving')
    : saveStatus === 'saved' ? t('status.save.saved')
    : saveStatus === 'error' ? t('status.save.error')
    : '';
  const saveDisplay = { label: saveLabel, className: SAVE_STATUS_CLASS[saveStatus] ?? '' };

  const elementLabel = useMemo(() => {
    if ((ELEMENT_LABELS as Record<string, string>)[activeElement as BuiltInElementType]) return translateElement(activeElement);
    try {
      const rule = getActiveTemplate().rules[activeElement];
      if (rule?.label) return translateElement(activeElement, rule.label);
    } catch (err) {
      console.warn('[StatusBar] element label lookup failed', err);
    }
    // A title-page line with no rule of its own (the blank lines between
    // fields) showed its internal id, "titlePage:blank".
    if (isTitlePageRuleId(activeElement)) {
      const field = TITLE_PAGE_ELEMENTS.find((f) => titlePageRuleId(f.field) === activeElement);
      return field?.label ?? translateElement('titlePage');
    }
    return activeElement;
  }, [activeElement, getActiveTemplate, t]);

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
      return t('status.acts', { count: realActs.length });
    } catch {
      return '';
    }
  }, [editorDoc, t]);

  /** Every word in the script, not just today's, which the goal ring counts. */
  const totalWords = useMemo(() => {
    const doc = editorDoc as JSONContent | null;
    if (!doc) return 0;
    let words = 0;
    for (const block of doc.content ?? []) {
      words += countWords(jsonBlockText(block));
    }
    return words;
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
              title={t('status.saveWritesBack', { name: documentOrigin.name })}
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
                ? `${linkedPath}\n${linkedStatus?.error || linkedProblem}${linkedStatus?.state === 'pending' ? `\n${t('status.linked.retryHint')}` : ''}`
                : t('status.linked.everySave', { path: linkedPath })}
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
        {/* Here rather than in the centre, which phones hide. */}
        <SuggestingPill />
        {currentAct && (
          <span className="status-item status-acts" title={t('status.actStructure')}>
            {currentAct}
          </span>
        )}
        {estimatedRuntime && (
          <button
            type="button"
            className="status-item status-timing"
            title={t('status.runtime.title', { pacing: pacingOption(scriptProfile.pacing).label.toLowerCase() })}
            onClick={() => setScriptProfileOpen(true)}
          >
            {t('status.runtime.est', { runtime: estimatedRuntime })}
            {scriptProfile.pacing !== DEFAULT_PACING && (
              <span className="status-timing-pacing"> · {pacingOption(scriptProfile.pacing).label.toLowerCase()}</span>
            )}
          </button>
        )}
        {totalWords > 0 && (
          <span className="status-item status-words" title={t('status.wordsTitle')}>
            {t('status.words', { count: totalWords, formatted: formatNumber(totalWords) })}
          </span>
        )}
        {revisionMode && (
          <span className="status-item status-revision">
            {t('status.revision', { color: revisionColor })}
          </span>
        )}
        <WritingProgress />
        <span className="status-item status-page">
          {currentLabel
            ? <>{t('status.page', { label: currentLabel })} <span className="status-locked" title={t('status.pagesLocked')}>{t('status.locked')}</span></>
            : t('status.pageOf', { current: currentPage, total: pageCount })}
        </span>
      </div>
    </div>
  );
};

export default StatusBar;

/** "Suggesting" while edits become suggestions; click to stop, unless a Suggest invite holds it on. */
function SuggestingPill() {
  const { t } = useTranslation('toolbar');
  const suggesting = useSuggestModeStore((st) => st.suggesting);
  const locked = useSuggestModeStore((st) => st.locked);
  if (!suggesting) return null;
  return (
    <button
      type="button"
      className="suggest-mode-pill"
      disabled={locked}
      onClick={() => useSuggestModeStore.getState().setSuggesting(false)}
      title={locked ? t('status.suggesting.lockedTitle') : t('status.suggesting.title')}
    >
      &#9998; {t('status.suggesting.label')}
    </button>
  );
}
