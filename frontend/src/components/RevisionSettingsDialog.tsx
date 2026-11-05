/**
 * Tools → Production → Revision Settings…
 *
 * The mark printed beside a revised line — one character for every revision,
 * or a different one per round so the Blue changes can be told from the Pink
 * on a page carrying both — and whether revised pages print on their
 * revision's colour of paper. Saved with the script, and shared with
 * collaborators like the rest of Revision Mode.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import {
  REVISION_COLORS, DEFAULT_REVISION_MARK, cleanMark, type RevisionSettings,
} from '../editor/revisionColors';

interface Props {
  onClose: () => void;
}

const RevisionSettingsDialog: React.FC<Props> = ({ onClose }) => {
  const { t } = useTranslation(['format', 'common']);
  const current = useEditorStore((s) => s.revisionSettings);
  const revisionHistory = useEditorStore((s) => s.revisionHistory);
  const [markChar, setMarkChar] = useState(current.markChar);
  const [marks, setMarks] = useState<Record<string, string>>({ ...current.marks });
  const [colorPages, setColorPages] = useState(current.colorPages);
  const [error, setError] = useState<string | null>(null);

  // The colours this script has used first, then the rest of the sequence.
  const used = new Set(revisionHistory.map((h) => h.color));

  const save = () => {
    const mark = cleanMark(markChar);
    if (!mark) {
      setError(t('revisions.markEmpty'));
      return;
    }
    const cleaned: Record<string, string> = {};
    for (const [color, raw] of Object.entries(marks)) {
      const m = cleanMark(raw);
      // A per-revision mark equal to the default is no override at all.
      if (m && m !== mark) cleaned[color] = m;
    }
    const next: RevisionSettings = { markChar: mark, marks: cleaned, colorPages };
    try {
      useEditorStore.getState().setRevisionSettings(next);
      onClose();
    } catch (err) {
      console.error('[revisions] could not save revision settings', err);
      setError(t('revisions.saveFailed', { error: err instanceof Error ? err.message : String(err) }));
    }
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box revision-settings-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revision-settings-title"
      >
        <div className="dialog-header" id="revision-settings-title">{t('revisions.title')}</div>
        <div className="dialog-body">
          <label className="revision-settings-row">
            <span>{t('revisions.mark')}</span>
            <input
              type="text"
              value={markChar}
              maxLength={4}
              onChange={(e) => { setMarkChar(e.target.value); setError(null); }}
              aria-describedby="revision-mark-help"
            />
          </label>
          <p id="revision-mark-help" className="revision-settings-help">
            {t('revisions.markHelp', { mark: DEFAULT_REVISION_MARK })}
          </p>

          <div className="revision-settings-subhead">{t('revisions.perRevision')}</div>
          <p className="revision-settings-help">
            {t('revisions.perRevisionHelp')}
          </p>
          <div className="revision-settings-grid">
            {REVISION_COLORS.filter((c) => c.slug !== 'white').map((c) => (
              <label key={c.slug} className={`revision-settings-color${used.has(c.name) ? ' used' : ''}`}>
                <span className="revision-settings-swatch" style={{ background: c.paper }} aria-hidden="true" />
                <span className="revision-settings-name">{c.name}</span>
                <input
                  type="text"
                  value={marks[c.name] ?? ''}
                  placeholder={cleanMark(markChar) ?? DEFAULT_REVISION_MARK}
                  maxLength={4}
                  aria-label={t('revisions.markFor', { color: c.name })}
                  onChange={(e) => setMarks((m) => ({ ...m, [c.name]: e.target.value }))}
                />
              </label>
            ))}
          </div>

          <label className="revision-settings-check">
            <input type="checkbox" checked={colorPages} onChange={(e) => setColorPages(e.target.checked)} />
            <span>
              {t('revisions.colorPages')}
              <span className="revision-settings-help">
                {t('revisions.colorPagesHelp')}
              </span>
            </span>
          </label>
          {error && <p className="revision-settings-error" role="alert">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={save}>{t('common:save')}</button>
        </div>
      </div>
    </div>
  );
};

export default RevisionSettingsDialog;
