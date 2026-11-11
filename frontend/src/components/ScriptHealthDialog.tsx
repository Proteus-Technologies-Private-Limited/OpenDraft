import { useEffect, useMemo, useRef, useState, useId } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { useTranslation } from 'react-i18next';
import { useEditorDoc } from '../hooks/useEditorTransactions';
import { useEditorStore } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { analyzeScriptHealth, healthOptionsForFormat, type HealthFinding } from '../utils/scriptHealth';
import { reportToCsv, scriptHealthReport } from '../utils/scriptReports';
import { sanitizeExportFilename } from '../utils/exportFilename';
import { saveFile } from '../utils/fileOps';

const PREVIEW_LIMIT = 300;

export default function ScriptHealthDialog({ editor, onClose }: { editor: Editor | null; onClose(): void }) {
  const { t } = useTranslation(['tools', 'common']);
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(true);
  const doc = useEditorDoc(editor);
  const notes = useEditorStore((state) => state.notes);
  const sceneNumbersVisible = useEditorStore((state) => state.sceneNumbersVisible);
  const documentTitle = useEditorStore((state) => state.documentTitle);
  const template = useFormattingTemplateStore((state) => state.getActiveTemplate());
  const findingId = useId();
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const { findings, error } = useMemo(() => {
    try {
      return { findings: doc ? analyzeScriptHealth(doc, healthOptionsForFormat(template.rules, sceneNumbersVisible, notes)) : [], error: null };
    } catch (failure) {
      // An optional report must not take down the editor on malformed metadata.
      return { findings: [], error: failure instanceof Error ? failure.message : String(failure) };
    }
  }, [doc, template.rules, sceneNumbersVisible, notes]);

  useEffect(() => {
    const opener = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (restoreFocus.current && opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  const current = () => {
    if (!editor || editor.isDestroyed || editor.state.doc !== doc) {
      setFeedback({ text: t('scriptHealth.changed') });
      return false;
    }
    return true;
  };
  const visit = (finding: HealthFinding) => {
    if (!current() || !editor || !doc) return;
    restoreFocus.current = false;
    dialog.current?.close();
    onClose();
    if (finding.position === null) {
      const state = useEditorStore.getState();
      if (finding.check === 'openNote') {
        state.setNoteFilter({ elementType: null, contextLabel: null, color: null, noteId: finding.noteId ?? null });
        if (!state.scriptNotesOpen) state.toggleScriptNotes();
      }
      return;
    }
    const position = Math.min(Math.max(finding.position, 0), doc.content.size);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(doc.resolve(position))).scrollIntoView());
    editor.view.focus();
  };
  const message = (finding: HealthFinding) => t(`scriptHealth.${finding.check}`, { reference: finding.reference });
  const summary = t('scriptHealth.summary', { count: findings.length });
  const exportCsv = async () => {
    if (error || !current()) return;
    setBusy(true);
    setFeedback(null);
    try {
      const table = scriptHealthReport(findings);
      // i18n-ignore: keep the same disk-name fallback as ReportsDialog
      const name = sanitizeExportFilename(`${documentTitle.trim() || 'Untitled'} - ${table.title}`);
      const saved = await saveFile(reportToCsv(table), `${name}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
      if (saved) setFeedback({ text: t('reports.exported', { title: table.title }) });
    } catch (error) {
      setFeedback({ text: t('reports.exportFailed', { message: error instanceof Error ? error.message : String(error) }), error: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="external-save-review script-health-dialog" aria-labelledby="script-health-title"
      aria-describedby="script-health-intro" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <h2 id="script-health-title">{t('scriptHealth.title')}</h2>
      <p id="script-health-intro">{t('scriptHealth.intro')}</p>
      {error ? <p role="alert">{t('reports.buildFailed', { message: error })}</p> : <p id="script-health-summary" role="status">{summary}</p>}
      {!error && !findings.length && <p>{doc ? t('scriptHealth.clean') : t('scriptHealth.changed')}</p>}
      <p>{t('scriptHealth.excerpts')}</p>
      {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
      <ol className="script-health-findings">
        {findings.slice(0, PREVIEW_LIMIT).map((finding, index) => (
          <li key={`${finding.check}:${finding.position}:${index}`}>
            <strong id={`${findingId}-${index}-message`}>{message(finding)}</strong>
            <span id={`${findingId}-${index}-context`} className="script-health-context" dir="auto">{finding.scene ?? t('scriptHealth.noScene')}</span>
            {finding.excerpt && <p id={`${findingId}-${index}-excerpt`} dir="auto">{finding.excerpt}</p>}
            {(finding.position !== null || finding.check === 'openNote') && <button type="button" onClick={() => visit(finding)}
              aria-describedby={`${findingId}-${index}-message ${findingId}-${index}-context${finding.excerpt ? ` ${findingId}-${index}-excerpt` : ''}`}>
              {finding.position === null && finding.check === 'openNote' ? t('scriptHealth.openNotes') : t('scriptHealth.jump')}
            </button>}
          </li>
        ))}
      </ol>
      {findings.length > PREVIEW_LIMIT && <p>{t('reports.previewLimit', { shown: PREVIEW_LIMIT, total: findings.length })}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={onClose}>{t('common:close')}</button>
        <button type="button" onClick={() => { void exportCsv(); }} disabled={!doc || !!error || busy}>{t('reports.exportCsv')}</button>
      </div>
    </dialog>
  );
}
