/**
 * Tools → Analytics → Reports…
 *
 * The built-in production reports (utils/scriptReports) and any a plugin
 * registers, each previewed as a table and exported as CSV — for a
 * spreadsheet or a scheduling program — or as a PDF to hand round.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { pluginRegistry, type ReportTable } from '../plugins/registry';
import { BUILT_IN_REPORTS, reportToCsv, reportToPdf } from '../utils/scriptReports';
import { activeTimingOptions } from '../utils/scriptTiming';
import { sanitizeExportFilename } from '../utils/exportFilename';
import { showToast } from './Toast';

interface Props {
  editor: Editor | null;
  onClose: () => void;
  /** Draw the report in a pane instead of over the page. */
  embedded?: boolean;
}

interface ReportChoice {
  key: string;
  label: string;
  description?: string;
  build: () => ReportTable | Promise<ReportTable>;
}

/** Rows drawn in the preview. The export always carries every row. */
const PREVIEW_ROWS = 300;

const ReportsDialog: React.FC<Props> = ({ editor, onClose, embedded = false }) => {
  const documentTitle = useEditorStore((s) => s.documentTitle);
  const [selected, setSelected] = useState('builtin:scenes');
  const [table, setTable] = useState<ReportTable | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choices = useMemo<ReportChoice[]>(() => {
    const doc = editor?.getJSON() ?? { type: 'doc', content: [] };
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
      .then((t) => { if (!cancelled) setTable(t); })
      .catch((err) => {
        console.error('[reports] could not build the report', err);
        if (!cancelled) {
          setTable(null);
          setError(`Could not build this report: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    return () => { cancelled = true; };
  }, [choices, selected]);

  const fileBase = `${sanitizeExportFilename(documentTitle || 'Untitled')} - ${table?.title ?? 'Report'}`;

  const exportAs = async (kind: 'csv' | 'pdf') => {
    if (!table) return;
    setBusy(true);
    try {
      const { saveFile } = await import('../utils/fileOps');
      const saved = kind === 'csv'
        ? await saveFile(reportToCsv(table), `${fileBase}.csv`, [{ name: 'CSV', extensions: ['csv'] }])
        : await saveFile(await reportToPdf(table, documentTitle), `${fileBase}.pdf`, [{ name: 'PDF', extensions: ['pdf'] }]);
      if (saved) showToast(`${table.title} exported`, 'success');
    } catch (err) {
      console.error('[reports] export failed', err);
      showToast(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? 'dialog-embedded' : 'dialog-overlay'} onClick={embedded ? undefined : onClose}>
      <div
        className={`dialog-box reports-dialog${embedded ? ' reports-dialog-embedded' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal={!embedded}
        aria-labelledby="reports-dialog-title"
      >
        <div className="dialog-header" id="reports-dialog-title">Reports</div>
        <div className="dialog-body reports-body">
          <ul className="reports-list" role="listbox" aria-label="Report">
            {choices.map((c) => (
              <li
                key={c.key}
                role="option"
                aria-selected={c.key === selected}
                tabIndex={0}
                className={c.key === selected ? 'selected' : ''}
                onClick={() => setSelected(c.key)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(c.key); } }}
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
                  {table.rows.length === 0 && <p className="reports-empty">Nothing to report yet.</p>}
                  {table.rows.length > PREVIEW_ROWS && (
                    <p className="reports-empty">Showing {PREVIEW_ROWS} of {table.rows.length} rows — the export includes them all.</p>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Close</button>
          <button onClick={() => { void exportAs('csv'); }} disabled={!table || busy}>Export CSV…</button>
          <button className="dialog-primary" onClick={() => { void exportAs('pdf'); }} disabled={!table || busy}>Export PDF…</button>
        </div>
      </div>
    </div>
  );
};

export default ReportsDialog;
