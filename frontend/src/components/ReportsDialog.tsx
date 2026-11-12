/**
 * Tools → Analytics → Reports…
 *
 * The built-in production reports (utils/scriptReports) and any a plugin
 * registers, each previewed as a table and exported as CSV — for a
 * spreadsheet or a scheduling program — or as a PDF to hand round.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import type { Editor } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import { pluginRegistry, type ReportTable } from '../plugins/registry';
import { BUILT_IN_REPORTS, reportToCsv, reportToPdf } from '../utils/scriptReports';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { analyzeScriptHealth, healthOptionsForFormat } from '../utils/scriptHealth';
import { activeTimingOptions } from '../utils/scriptTiming';
import { sanitizeExportFilename } from '../utils/exportFilename';
import { showToast } from './Toast';

interface Props {
  editor: Editor | null;
  onClose: () => void;
}

interface ReportChoice {
  key: string;
  label: string;
  description?: string;
  build: () => ReportTable | Promise<ReportTable>;
}

/** Rows drawn in the preview. The export always carries every row. */
const PREVIEW_ROWS = 300;

const ReportsDialog: React.FC<Props> = ({ editor, onClose }) => {
  const { t } = useTranslation(['tools', 'common']);
  const documentTitle = useEditorStore((s) => s.documentTitle);
  const [selected, setSelected] = useState('builtin:scenes');
  const [table, setTable] = useState<ReportTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choices = useMemo<ReportChoice[]>(() => {
    const editorDoc = editor?.state.doc;
    const doc = editorDoc?.toJSON() ?? { type: 'doc', content: [] };
    const builtIn = BUILT_IN_REPORTS.map((r): ReportChoice => ({
      key: `builtin:${r.id}`,
      label: r.label,
      description: r.description,
      build: () => {
        const s = useEditorStore.getState();
        return r.build({
          doc,
          characterProfiles: s.characterProfiles,
          tags: s.tags,
          tagCategories: s.tagCategories,
          timing: activeTimingOptions(s.pageLayout),
          notes: s.notes,
          generalNotes: s.generalNotes,
          healthFindings: r.id === 'script-health' && editorDoc ? analyzeScriptHealth(editorDoc,
            healthOptionsForFormat(useFormattingTemplateStore.getState().getActiveTemplate().rules, s.sceneNumbersVisible, s.notes)) : undefined,
        });
      },
    }));
    const fromPlugins = pluginRegistry.getReports().map((r): ReportChoice => ({
      key: `plugin:${r.id}`,
      label: r.label,
      description: r.description,
      build: () => r.build({ editor, doc, title: useEditorStore.getState().documentTitle }),
    }));
    return [...builtIn, ...fromPlugins];
  }, [editor]);

  useEffect(() => {
    const choice = choices.find((c) => c.key === selected);
    if (!choice) return;
    let cancelled = false;
    setError(null);
    Promise.resolve()
      .then(() => choice.build())
      .then((result) => { if (!cancelled) setTable(result); })
      .catch((err) => {
        console.error('[reports] could not build the report', err);
        if (!cancelled) {
          setTable(null);
          setError(t('reports.buildFailed', { message: err instanceof Error ? err.message : String(err) }));
        }
      });
    return () => { cancelled = true; };
  }, [choices, selected, t]);

  // i18n-ignore: the file name is written to disk, so it stays as it always was
  const fileBase = `${sanitizeExportFilename(documentTitle || 'Untitled')} - ${table?.title ?? 'Report'}`;

  const exportAs = async (kind: 'csv' | 'pdf') => {
    if (!table) return;
    setBusy(true);
    try {
      const { saveFile } = await import('../utils/fileOps');
      const saved = kind === 'csv'
        ? await saveFile(reportToCsv(table), `${fileBase}.csv`, [{ name: 'CSV', extensions: ['csv'] }])
        : await saveFile(await reportToPdf(table, documentTitle), `${fileBase}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
      if (saved) showToast(t('reports.exported', { title: table.title }), 'success');
    } catch (err) {
      console.error('[reports] export failed', err);
      showToast(t('reports.exportFailed', { message: err instanceof Error ? err.message : String(err) }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box reports-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reports-dialog-title"
      >
        <div className="dialog-header" id="reports-dialog-title">{t('reports.title')}</div>
        <div className="dialog-body reports-body">
          <ul className="reports-list" role="listbox" aria-label={t('reports.listLabel')}>
            {choices.map((c) => (
              <li
                key={c.key}
                role="option"
                aria-selected={c.key === selected}
                tabIndex={c.key === selected ? 0 : -1}
                className={c.key === selected ? 'selected' : ''}
                onClick={() => setSelected(c.key)}
                onKeyDown={event => {
                  const index = choices.indexOf(c);
                  const next = event.key === 'ArrowDown' ? (index + 1) % choices.length
                    : event.key === 'ArrowUp' ? (index + choices.length - 1) % choices.length
                    : event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
                    : event.key === 'Enter' || event.key === ' ' ? index : -1;
                  if (next >= 0) {
                    event.preventDefault();
                    setSelected(choices[next].key);
                    event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
                  }
                }}
              >
                <span className="reports-list-label">{c.label}</span>
                {c.description && <span className="reports-list-desc">{c.description}</span>}
              </li>
            ))}
          </ul>
          <div className="reports-preview">
            {error && <p className="reports-error" role="alert">{error}</p>}
            {table && (
              <>
                {table.summary && <p className="reports-summary">{table.summary}</p>}
                <div className="reports-table-wrap">
                  <table className="reports-table">
                    <thead>
                      <tr>{table.columns.map((c) => <th key={c}>{c}</th>)}</tr>
                    </thead>
                    <tbody>
                      {table.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
                        <tr key={r}>{row.map((v, c) => <td key={c}>{String(v ?? '')}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                  {table.rows.length === 0 && <p className="reports-empty">{t('reports.empty')}</p>}
                  {table.rows.length > PREVIEW_ROWS && (
                    <p className="reports-empty">{t('reports.previewLimit', { shown: PREVIEW_ROWS, total: table.rows.length })}</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>{t('common:close')}</button>
          <button onClick={() => { void exportAs('csv'); }} disabled={!table || busy}>{t('reports.exportCsv')}</button>
          <button className="dialog-primary" onClick={() => { void exportAs('pdf'); }} disabled={!table || busy}>{t('reports.exportPdf')}</button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default ReportsDialog;
