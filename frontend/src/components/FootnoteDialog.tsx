/**
 * Word's Footnote and Endnote dialog, for script notes that print.
 *
 * The preview renders through the very same helpers the page and the exporters
 * use — `noteMarkerText`, `noteEntryLabel`, `parseNoteContent` — so a preview
 * that looks right cannot correspond to an export that is wrong. That is the
 * same reason `HeaderFooterDialog` previews through `resolveHFFields`.
 *
 * Settings are applied on Apply rather than live, because turning footnotes on
 * repaginates the script and doing that under the writer's cursor as they click
 * about a dialog is worse than making them commit.
 *
 * Word's "Apply changes to", "Insert" and "Convert" are absent: OpenDraft has
 * no sections, notes are created in the Script Notes panel, and Convert is what
 * the Location radio already does.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  useEditorStore,
  resolveFootnotes,
  noteWillPrint,
  DEFAULT_FOOTNOTES,
  type PageLayout,
  type FootnoteSettings,
} from '../stores/editorStore';
import {
  NOTE_NUMBER_FORMATS,
  formatNoteNumber,
  noteMarkerText,
  noteEntryLabel,
  type NoteNumberFormat,
} from '../utils/noteNumbering';
import { parseNoteContent, noteBlockText } from '../utils/noteContent';
import { useNoteRenderContext } from '../hooks/useFootnotePlan';

interface FootnoteDialogProps {
  onClose: () => void;
}

const SAMPLE = [
  'Armstrong, N. (1969). Apollo 11 flight transcript. NASA.',
  'Didion, J. (1979). The White Album. Simon & Schuster.',
];

const FootnoteDialog: React.FC<FootnoteDialogProps> = ({ onClose }) => {
  const { pageLayout, setPageLayout, notes } = useEditorStore();
  const ctx = useNoteRenderContext();

  // A gap-free copy, so a document saved before any of this existed edits as
  // though it had the defaults all along.
  const [layout, setLayout] = useState<PageLayout>(() => ({
    ...pageLayout,
    footnotes: resolveFootnotes(pageLayout),
  }));

  const fn = resolveFootnotes(layout);

  const set = useCallback(<K extends keyof FootnoteSettings>(key: K, value: FootnoteSettings[K]) => {
    setLayout((prev) => ({
      ...prev,
      footnotes: { ...resolveFootnotes(prev), [key]: value },
    }));
  }, []);

  const handleApply = useCallback(() => {
    setPageLayout(layout);
    onClose();
  }, [layout, setPageLayout, onClose]);

  const handleReset = useCallback(() => {
    setLayout((prev) => ({ ...prev, footnotes: { ...DEFAULT_FOOTNOTES } }));
  }, []);

  const printing = useMemo(() => notes.filter(noteWillPrint), [notes]);

  // Real notes where there are any, so the preview shows the writer's own
  // citations; two plausible ones where there are not.
  const previewEntries = useMemo(() => {
    const texts = printing.length > 0
      ? printing.slice(0, 2).map((n) => noteBlockText(parseNoteContent(n.content, ctx)[0] ?? { kind: 'line', parts: [] }))
      : SAMPLE;
    return texts.map((text, i) => ({
      marker: noteMarkerText(fn.startAt + i, fn.numberFormat, fn.markerStyle),
      label: noteEntryLabel(fn.startAt + i, fn.numberFormat),
      text: text || '(empty note)',
    }));
  }, [printing, ctx, fn.startAt, fn.numberFormat, fn.markerStyle]);

  const isEndnote = fn.placement === 'endnote';

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box fn-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Footnote and Endnote"
      >
        <div className="dialog-header">Footnote and Endnote</div>
        <div className="dialog-body">

          <div className="fn-section">
            <label className="fn-check">
              <input
                type="checkbox"
                checked={fn.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />
              <span>Print notes in the screenplay</span>
            </label>
            <div className="fn-hint">
              While this is off, notes stay on screen only &mdash; nothing changes in the
              script, the page count, or any export.
            </div>
          </div>

          <fieldset className="fn-section" disabled={!fn.enabled}>
            <div className="fn-section-title">Location</div>
            <div className="fn-hint" style={{ marginTop: 0, marginBottom: 8 }}>
              Where notes go by default. Any note can be sent the other way from
              its own dropdown in the Script Notes panel; the rest follow this.
            </div>
            <label className="fn-radio">
              <input
                type="radio"
                name="fn-placement"
                checked={!isEndnote}
                onChange={() => set('placement', 'footnote')}
              />
              <span className="fn-radio-label">Footnotes</span>
              <span className="fn-radio-value">Bottom of page</span>
            </label>
            <label className="fn-radio">
              <input
                type="radio"
                name="fn-placement"
                checked={isEndnote}
                onChange={() => set('placement', 'endnote')}
              />
              <span className="fn-radio-label">Endnotes</span>
              <span className="fn-radio-value">End of script</span>
            </label>
          </fieldset>

          <fieldset className="fn-section" disabled={!fn.enabled}>
            <div className="fn-section-title">Format</div>

            <div className="fn-row">
              <label htmlFor="fn-format">Number format</label>
              <select
                id="fn-format"
                value={fn.numberFormat}
                onChange={(e) => set('numberFormat', e.target.value as NoteNumberFormat)}
              >
                {NOTE_NUMBER_FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {/* Shown from the writer's own starting number, so "Start at"
                        can be checked without leaving the dialog. */}
                    {[0, 1, 2].map((k) => formatNoteNumber(fn.startAt + k, f.id)).join(', ')}, …
                  </option>
                ))}
              </select>
            </div>

            <div className="fn-row">
              <label>Marker style</label>
              <div className="fn-segmented">
                <button
                  type="button"
                  className={fn.markerStyle === 'superscript' ? 'active' : ''}
                  onClick={() => set('markerStyle', 'superscript')}
                >
                  Superscript <sup>{formatNoteNumber(fn.startAt, fn.numberFormat)}</sup>
                </button>
                <button
                  type="button"
                  className={fn.markerStyle === 'bracketed' ? 'active' : ''}
                  onClick={() => set('markerStyle', 'bracketed')}
                >
                  Bracketed [{formatNoteNumber(fn.startAt, fn.numberFormat)}]
                </button>
              </div>
            </div>

            <div className="fn-row">
              <label htmlFor="fn-start">Start at</label>
              <input
                id="fn-start"
                type="number"
                step="1"
                min="1"
                max="9999"
                value={fn.startAt}
                onChange={(e) => set('startAt', Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>

            <div className="fn-row">
              <label htmlFor="fn-numbering">Numbering</label>
              <select
                id="fn-numbering"
                value={fn.numbering}
                disabled={isEndnote}
                onChange={(e) => set('numbering', e.target.value as FootnoteSettings['numbering'])}
              >
                <option value="continuous">Continuous</option>
                <option value="restartEachPage">Restart each page</option>
              </select>
            </div>
            {isEndnote && (
              <div className="fn-hint">
                Endnotes are one list at the end of the script, so there is no page to
                restart the numbering on.
              </div>
            )}
            <div className="fn-hint">
              General notes are attached to the file rather than to a line of it, so
              they always print at the end whatever this says.
            </div>

            <label className="fn-check">
              <input
                type="checkbox"
                checked={fn.includeInExports}
                onChange={(e) => set('includeInExports', e.target.checked)}
              />
              <span>Include notes when exporting</span>
            </label>
            <div className="fn-hint">
              Applies to PDF, Word and Final Draft. Turn it off to send a clean script
              without changing anything on screen.
            </div>
          </fieldset>

          <div className="fn-section">
            <div className="fn-section-title">Preview</div>
            <div className="fn-preview">
              <div className="fn-preview-body">
                <span>&hellip;that was one small step</span>
                {fn.markerStyle === 'superscript'
                  ? <sup className="fn-preview-marker">{previewEntries[0]?.marker}</sup>
                  : <span className="fn-preview-marker">{previewEntries[0]?.marker}</span>}
                <span> for a man.</span>
              </div>
              {!isEndnote && <div className="fn-preview-rule" />}
              {isEndnote && <div className="fn-preview-heading">NOTES</div>}
              {previewEntries.map((e, i) => (
                <div className="fn-preview-entry" key={i}>
                  <span className="fn-preview-label">{e.label}</span>
                  <span className="fn-preview-text">{e.text}</span>
                </div>
              ))}
            </div>
            <div className="fn-hint">
              {printing.length > 0
                ? `${printing.length} of ${notes.length} notes are set to print.`
                : 'No notes are set to print yet — use the Print button on a note.'}
            </div>
          </div>
        </div>

        <div className="dialog-actions">
          <button className="page-setup-reset" onClick={handleReset}>
            Reset Default
          </button>
          <div className="page-setup-spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-primary" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default FootnoteDialog;
