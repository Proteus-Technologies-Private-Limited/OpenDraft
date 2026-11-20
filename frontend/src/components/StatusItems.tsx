/**
 * The status bar's lines as footer items (toolbarLayout.ts, kind `status`):
 * the script's name, its save state, the current element, acts, the running
 * time, words, the revision colour, the writing goal and the page.
 *
 * Each line is its own component and reads only what it shows, so a line the
 * writer takes off the footer no longer walks the script after every edit.
 * The markup and class names are the status bar's own, so the footer looks
 * exactly as it did when the lines were fixed.
 */
import type { Editor, JSONContent } from '@tiptap/react';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ELEMENT_LABELS, type BuiltInElementType, useEditorFields } from '../stores/editorStore';
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
import { formatNumber } from '../i18n/format';
import { elementLabel as translateElement } from '../editor/elementLabels';
import { docJSON, useSettledEditorDoc } from '../hooks/useEditorTransactions';

const SAVE_STATUS_CLASS: Record<string, string> = {
  idle: '',
  unsaved: 'status-save-unsaved',
  saving: 'status-save-saving',
  saved: 'status-save-saved',
  error: 'status-save-error',
};

/**
 * The script as JSON once typing pauses. Settled: the timing, structure and
 * word count walk the whole script, so they follow the edits once typing
 * pauses rather than on every key (#229). docJSON caches per document, so the
 * lines that need it share one serialisation.
 */
function useSettledJSON(editor: Editor | null): JSONContent | null {
  const doc = useSettledEditorDoc(editor);
  return useMemo(() => (doc ? docJSON(doc) as JSONContent : null), [doc]);
}

/** The project, the script's title, and the file a save also writes. */
function TitleLine() {
  const { t } = useTranslation('toolbar');
  const { documentTitle, documentOrigin } = useEditorFields('documentTitle', 'documentOrigin');
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
  return (
    <>
      {currentProject && <span className="status-item status-project">{currentProject.name}</span>}
      {currentProject && <span className="status-sep">/</span>}
      <span className="status-item">{documentTitle}</span>
      {/* Save overwrites this file rather than the library, so say which one
          — a writer editing a Dropbox screenplay needs to know that before
          they press Save, not after. */}
      {documentOrigin && (
        <>
          <span className="status-sep">&middot;</span>
          <span className="status-item status-origin" title={t('status.saveWritesBack', { name: documentOrigin.name })}>
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
    </>
  );
}

/** Saved, Saving…, Unsaved changes or Save failed. */
function SaveLine({ lead }: { lead: boolean }) {
  const { t } = useTranslation('toolbar');
  const { saveStatus } = useEditorFields('saveStatus');
  const label =
    saveStatus === 'unsaved' ? t('status.save.unsaved')
    : saveStatus === 'saving' ? t('status.save.saving')
    : saveStatus === 'saved' ? t('status.save.saved')
    : saveStatus === 'error' ? t('status.save.error')
    : '';
  if (!label) return null;
  return (
    <>
      {lead && <span className="status-sep">&middot;</span>}
      <span className={`status-item ${SAVE_STATUS_CLASS[saveStatus] ?? ''}`}>{label}</span>
    </>
  );
}

/** The element the caret is in, by its template's name. */
function ElementLine() {
  const { activeElement } = useEditorFields('activeElement');
  const getActiveTemplate = useFormattingTemplateStore((s) => s.getActiveTemplate);
  // Re-read when the template changes, so a renamed element shows its new name.
  const activeTemplateId = useFormattingTemplateStore((s) => s.activeTemplateId);
  const label = useMemo(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeElement, getActiveTemplate, activeTemplateId]);
  return <span className="status-item status-element">{label}</span>;
}

/** "3 acts", when the script has act breaks. */
function ActsLine({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation('toolbar');
  const json = useSettledJSON(editor);
  const acts = useMemo(() => {
    if (!json) return '';
    try {
      const structure = computeScriptStructure(json as never);
      const realActs = structure.acts.filter((a) => a.actNumber > 0);
      return realActs.length === 0 ? '' : t('status.acts', { count: realActs.length });
    } catch (err) {
      console.warn('[StatusBar] act count failed', err);
      return '';
    }
  }, [json, t]);
  if (!acts) return null;
  return <span className="status-item status-acts" title={t('status.actStructure')}>{acts}</span>;
}

/** The estimated running time; click to set the genre and pacing. */
function RuntimeLine({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation('toolbar');
  const json = useSettledJSON(editor);
  const { pageLayout, sceneHeadingSpaceBefore, scriptProfile, setScriptProfileOpen } = useEditorFields(
    'pageLayout', 'sceneHeadingSpaceBefore', 'scriptProfile', 'setScriptProfileOpen',
  );
  const activeTemplateId = useFormattingTemplateStore((s) => s.activeTemplateId);
  const runtime = useMemo(() => {
    if (!json) return '';
    try {
      const result = computeSceneTiming(json, activeTimingOptions(pageLayout));
      return result.totalSeconds > 0 ? formatRuntime(result.totalSeconds) : '';
    } catch (err) {
      console.warn('[StatusBar] runtime estimate failed', err);
      return '';
    }
    // The estimate is measured against the page — its size, the template's
    // spacing and page time — so any of those changing re-measures it. The
    // template and spacing are read from their stores, hence the lint pragma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, pageLayout, sceneHeadingSpaceBefore, activeTemplateId, scriptProfile.pacing]);
  if (!runtime) return null;
  return (
    <button
      type="button"
      className="status-item status-timing"
      title={t('status.runtime.title', { pacing: pacingOption(scriptProfile.pacing).label.toLowerCase() })}
      onClick={() => setScriptProfileOpen(true)}
    >
      {t('status.runtime.est', { runtime })}
      {scriptProfile.pacing !== DEFAULT_PACING && (
        <span className="status-timing-pacing"> · {pacingOption(scriptProfile.pacing).label.toLowerCase()}</span>
      )}
    </button>
  );
}

/** Every word in the script, not just today's, which the goal ring counts. */
function WordsLine({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation('toolbar');
  const json = useSettledJSON(editor);
  const words = useMemo(() => {
    if (!json) return 0;
    let total = 0;
    try {
      for (const block of json.content ?? []) total += countWords(jsonBlockText(block));
    } catch (err) {
      console.warn('[StatusBar] word count failed', err);
    }
    return total;
  }, [json]);
  if (words <= 0) return null;
  return (
    <span className="status-item status-words" title={t('status.wordsTitle')}>
      {t('status.words', { count: words, formatted: formatNumber(words) })}
    </span>
  );
}

/** The revision colour, while revisions are being marked. */
function RevisionLine() {
  const { t } = useTranslation('toolbar');
  const { revisionMode, revisionColor } = useEditorFields('revisionMode', 'revisionColor');
  if (!revisionMode) return null;
  return <span className="status-item status-revision">{t('status.revision', { color: revisionColor })}</span>;
}

/** "Page 3 of 42", or a locked page by its label ("Page 12A"). */
function PageLine() {
  const { t } = useTranslation('toolbar');
  const { pageCount, currentPage, pageLabels } = useEditorFields('pageCount', 'currentPage', 'pageLabels');
  // Locked pages read by their label, which is what the production will ask for.
  const currentLabel = pageLabels?.[currentPage - 1];
  return (
    <span className="status-item status-page">
      {currentLabel
        ? <>{t('status.page', { label: currentLabel })} <span className="status-locked" title={t('status.pagesLocked')}>{t('status.locked')}</span></>
        : t('status.pageOf', { current: currentPage, total: pageCount })}
    </span>
  );
}

/**
 * One status line by its footer id. `lead` says another line comes before it
 * on the same side, which is when Save puts its "·" in front.
 */
export const StatusItem: React.FC<{ id: string; editor: Editor | null; lead: boolean }> = React.memo(({ id, editor, lead }) => {
  switch (id) {
    case 'status-title': return <TitleLine />;
    case 'status-save': return <SaveLine lead={lead} />;
    case 'status-element': return <ElementLine />;
    case 'status-acts': return <ActsLine editor={editor} />;
    case 'status-runtime': return <RuntimeLine editor={editor} />;
    case 'status-words': return <WordsLine editor={editor} />;
    case 'status-revision': return <RevisionLine />;
    case 'status-progress': return <WritingProgress />;
    case 'status-page': return <PageLine />;
    default:
      console.warn('[StatusBar] unknown status line', id);
      return null;
  }
});
StatusItem.displayName = 'StatusItem';
