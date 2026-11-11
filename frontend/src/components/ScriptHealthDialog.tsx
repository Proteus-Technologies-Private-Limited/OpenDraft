import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { useTranslation } from 'react-i18next';
import { useEditorDoc } from '../hooks/useEditorTransactions';
import { useEditorStore } from '../stores/editorStore';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { numberingRulesOf } from '../utils/elementNumbers';
import { analyzeScriptHealth, type HealthFinding } from '../utils/scriptHealth';
import { reportToCsv } from '../utils/scriptReports';
import { sanitizeExportFilename } from '../utils/exportFilename';
import { saveFile } from '../utils/fileOps';
import { showToast } from './Toast';

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
  const [busy, setBusy] = useState(false);
  const { findings, error } = useMemo(() => {
    try {
      return { findings: doc ? analyzeScriptHealth(doc, {
        numbering: numberingRulesOf(template.rules), sceneNumbersVisible, notes,
        dialogueChecks: !!template.rules.character?.enabled && !!template.rules.dialogue?.enabled
          && template.rules.character.nextOnEnter === 'dialogue',
      }) : [], error: null };
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
      showToast(t('scriptHealth.changed'), 'info');
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
    try {
      // Keep the scope and limitations in the exported copy as well as the UI.
      const table = {
        title: t('scriptHealth.title'),
        columns: [t('scriptHealth.scene'), t('scriptHealth.finding'), t('scriptHealth.excerpt')],
        rows: [
          ['', `${t('scriptHealth.intro')} ${summary}`, ''],
          ...findings.map((finding) => [finding.scene ?? t('scriptHealth.noScene'), message(finding), finding.excerpt]),
        ],
      };
      const name = sanitizeExportFilename(`${documentTitle} - ${table.title}`);
      const saved = await saveFile(reportToCsv(table), `${name}.csv`, [{ name: 'CSV', extensions: ['csv'] }]);
      if (saved) showToast(t('reports.exported', { title: table.title }), 'success');
    } catch (error) {
      showToast(t('reports.exportFailed', { message: error instanceof Error ? error.message : String(error) }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} className="external-save-review script-health-dialog" aria-labelledby="script-health-title"
      aria-describedby="script-health-intro" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <h2 id="script-health-title">{t('scriptHealth.title')}</h2>
      <p id="script-health-intro">{t('scriptHealth.intro')}</p>
      {error ? <p role="alert">{t('reports.buildFailed', { message: error })}</p> : <p role="status">{summary}</p>}
      {!error && !findings.length && <p>{doc ? t('scriptHealth.clean') : t('scriptHealth.changed')}</p>}
      <ol className="script-health-findings">
        {findings.slice(0, PREVIEW_LIMIT).map((finding, index) => (
          <li key={`${finding.check}:${finding.position}:${index}`}>
            <strong>{message(finding)}</strong>
            <span className="script-health-context" dir="auto">{finding.scene ?? t('scriptHealth.noScene')}</span>
            {finding.excerpt && <p dir="auto">{finding.excerpt}</p>}
            <button type="button" onClick={() => visit(finding)}
              disabled={finding.position === null && finding.check !== 'openNote'}>
              {finding.position === null && finding.check === 'openNote' ? t('scriptHealth.openNotes') : t('scriptHealth.jump')}
            </button>
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
