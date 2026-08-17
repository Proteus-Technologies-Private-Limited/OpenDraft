import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  useEditorStore,
  DEFAULT_PAGE_LAYOUT,
  resolveHeaderFooter,
  resolveHFFields,
} from '../stores/editorStore';
import type { PageLayout, HeaderFooterContent } from '../stores/editorStore';

export type HeaderFooterBand = 'header' | 'footer';

interface HeaderFooterDialogProps {
  onClose: () => void;
  /** Which band to put the caret in when the dialog opens — set when the user
   *  arrives here from the "Header & Footer Settings…" affordance on an
   *  in-place band rather than from the menu. */
  focusBand?: HeaderFooterBand;
}

/** Insertable dynamic fields, in the order Final Draft lists them. */
const FIELDS: Array<{ token: string; label: string; hint: string }> = [
  { token: '{page}', label: 'Page #', hint: 'The number printed on this page' },
  { token: '{pages}', label: 'Total Pages', hint: 'The number on the last page' },
  { token: '{title}', label: 'Title', hint: 'The document title' },
  { token: '{date}', label: 'Date', hint: "Today's date" },
  { token: '{revision}', label: 'Revision', hint: 'The current revision colour' },
];

function ptToIn(pt: number): number {
  return +(pt / 72).toFixed(3);
}

function inToPt(inches: number): number {
  return Math.round(inches * 72);
}

const POSITIONS: Array<{ key: keyof HeaderFooterContent; label: string }> = [
  { key: 'left', label: 'Left' },
  { key: 'center', label: 'Center' },
  { key: 'right', label: 'Right' },
];

const HeaderFooterDialog: React.FC<HeaderFooterDialogProps> = ({ onClose, focusBand }) => {
  const { pageLayout, setPageLayout, documentTitle, revisionColor, pageCount } = useEditorStore();

  // Work on a full, gap-free copy so a document saved before any of these
  // fields existed edits as though it had the defaults all along.
  const [layout, setLayout] = useState<PageLayout>(() => ({
    ...pageLayout,
    ...resolveHeaderFooter(pageLayout),
  }));

  // The input the caret was last in, so an "Insert" button knows where to go.
  const lastFocused = useRef<{ band: HeaderFooterBand; pos: keyof HeaderFooterContent } | null>(
    focusBand ? { band: focusBand, pos: 'right' } : null,
  );
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const refKey = (band: HeaderFooterBand, pos: keyof HeaderFooterContent) => `${band}.${pos}`;

  const hf = resolveHeaderFooter(layout);

  const setField = useCallback(
    <K extends keyof PageLayout>(key: K, value: PageLayout[K]) => {
      setLayout((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const setBandField = useCallback(
    (band: HeaderFooterBand, pos: keyof HeaderFooterContent, value: string) => {
      const key = band === 'header' ? 'headerContent' : 'footerContent';
      setLayout((prev) => ({ ...prev, [key]: { ...prev[key], [pos]: value } }));
    },
    [],
  );

  /** Insert a token at the caret of the last-focused slot, defaulting to the
   *  header's right slot — where the page number lives by convention. */
  const insertField = useCallback(
    (token: string) => {
      const target = lastFocused.current ?? { band: 'header' as const, pos: 'right' as const };
      const input = inputRefs.current[refKey(target.band, target.pos)];
      const key = target.band === 'header' ? 'headerContent' : 'footerContent';
      setLayout((prev) => {
        const current = prev[key][target.pos] ?? '';
        const start = input?.selectionStart ?? current.length;
        const end = input?.selectionEnd ?? current.length;
        const next = current.slice(0, start) + token + current.slice(end);
        // Restore the caret after the inserted token once React has repainted.
        requestAnimationFrame(() => {
          try {
            input?.focus();
            input?.setSelectionRange(start + token.length, start + token.length);
          } catch {
            /* the input may have unmounted — the value is still committed */
          }
        });
        return { ...prev, [key]: { ...prev[key], [target.pos]: next } };
      });
    },
    [],
  );

  // "Show on first page" is a view of the start-page number rather than its own
  // stored flag: the first script page carries `startingPageNumber`, so the band
  // shows there exactly when it starts at or before that number.
  const firstPrinted = hf.startingPageNumber;
  const showsOnFirst = (band: HeaderFooterBand): boolean =>
    (band === 'header' ? hf.headerStartPage : hf.footerStartPage) <= firstPrinted;

  const toggleFirstPage = useCallback(
    (band: HeaderFooterBand, checked: boolean) => {
      const key = band === 'header' ? 'headerStartPage' : 'footerStartPage';
      setLayout((prev) => {
        const first = resolveHeaderFooter(prev).startingPageNumber;
        return { ...prev, [key]: checked ? first : first + 1 };
      });
    },
    [],
  );

  const handleApply = useCallback(() => {
    setPageLayout(layout);
    onClose();
  }, [layout, setPageLayout, onClose]);

  const handleReset = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      headerContent: { ...DEFAULT_PAGE_LAYOUT.headerContent },
      footerContent: { ...DEFAULT_PAGE_LAYOUT.footerContent },
      headerStartPage: DEFAULT_PAGE_LAYOUT.headerStartPage,
      footerStartPage: DEFAULT_PAGE_LAYOUT.footerStartPage,
      startingPageNumber: DEFAULT_PAGE_LAYOUT.startingPageNumber,
      headerMargin: DEFAULT_PAGE_LAYOUT.headerMargin,
      footerMargin: DEFAULT_PAGE_LAYOUT.footerMargin,
    }));
  }, []);

  // Preview the first two script pages — the pair that shows what the start-page
  // and starting-number settings actually do.
  const preview = useMemo(() => {
    const total = Math.max(1, pageCount || 1) + hf.startingPageNumber - 1;
    return [firstPrinted, firstPrinted + 1].map((printed) => ({
      printed,
      header:
        printed >= hf.headerStartPage
          ? (['left', 'center', 'right'] as const).map((p) =>
              resolveHFFields(hf.headerContent[p], printed, total, documentTitle, revisionColor),
            )
          : null,
      footer:
        printed >= hf.footerStartPage
          ? (['left', 'center', 'right'] as const).map((p) =>
              resolveHFFields(hf.footerContent[p], printed, total, documentTitle, revisionColor),
            )
          : null,
    }));
  }, [hf, firstPrinted, pageCount, documentTitle, revisionColor]);

  const renderBand = (band: HeaderFooterBand) => {
    const content = band === 'header' ? hf.headerContent : hf.footerContent;
    const startKey = band === 'header' ? 'headerStartPage' : 'footerStartPage';
    const marginKey = band === 'header' ? 'headerMargin' : 'footerMargin';
    const startValue = band === 'header' ? hf.headerStartPage : hf.footerStartPage;
    const marginLabel = band === 'header' ? 'Distance from top (in)' : 'Distance from bottom (in)';

    return (
      <div className="hf-section">
        <div className="hf-section-title">{band === 'header' ? 'Header' : 'Footer'}</div>
        <div className="hf-slot-row">
          {POSITIONS.map(({ key, label }) => (
            <label key={key} className="hf-slot">
              <span className="hf-slot-label">{label}</span>
              <input
                ref={(el) => {
                  inputRefs.current[refKey(band, key)] = el;
                }}
                value={content[key]}
                placeholder="—"
                onFocus={() => {
                  lastFocused.current = { band, pos: key };
                }}
                onChange={(e) => setBandField(band, key, e.target.value)}
                autoFocus={focusBand === band && key === 'right'}
              />
            </label>
          ))}
        </div>
        <label className="hf-check">
          <input
            type="checkbox"
            checked={showsOnFirst(band)}
            onChange={(e) => toggleFirstPage(band, e.target.checked)}
          />
          <span>Show on first page</span>
        </label>
        <div className="hf-row-pair">
          <div className="hf-row">
            <label>Start showing on page</label>
            <input
              type="number"
              step="1"
              min="1"
              max="9999"
              value={startValue}
              onChange={(e) => setField(startKey, Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </div>
          <div className="hf-row">
            <label>{marginLabel}</label>
            <input
              type="number"
              step="0.05"
              min="0"
              max="2"
              value={ptToIn(layout[marginKey])}
              onChange={(e) => setField(marginKey, inToPt(parseFloat(e.target.value) || 0))}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box hf-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Header and Footer"
      >
        <div className="dialog-header">Header &amp; Footer</div>
        <div className="dialog-body">
          <div className="hf-fields">
            <span className="hf-fields-label">Insert field</span>
            {FIELDS.map((f) => (
              <button
                key={f.token}
                type="button"
                className="hf-field-btn"
                title={`${f.token} — ${f.hint}`}
                onMouseDown={(e) => e.preventDefault() /* keep the caret in the input */}
                onClick={() => insertField(f.token)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {renderBand('header')}
          {renderBand('footer')}

          <div className="hf-section">
            <div className="hf-section-title">Page Numbering</div>
            <div className="hf-row">
              <label>Start numbering at</label>
              <input
                type="number"
                step="1"
                min="1"
                max="9999"
                value={hf.startingPageNumber}
                onChange={(e) =>
                  setField('startingPageNumber', Math.max(1, parseInt(e.target.value, 10) || 1))
                }
              />
            </div>
            <div className="hf-hint">
              The number printed on the first script page. The title page is never numbered and
              never counted. Raise this when the opening sheet should read as a later page — a
              synopsis on the first sheet, for instance, makes the script start at 2.
            </div>
          </div>

          <div className="hf-section">
            <div className="hf-section-title">Preview</div>
            <div className="hf-preview">
              {preview.map((p) => (
                <div key={p.printed} className="hf-preview-page">
                  <div className="hf-preview-band">
                    {p.header
                      ? p.header.map((t, i) => (
                          <span key={i} className={`hf-preview-slot hf-preview-slot-${i}`}>
                            {t}
                          </span>
                        ))
                      : null}
                  </div>
                  <div className="hf-preview-body" aria-hidden="true" />
                  <div className="hf-preview-band">
                    {p.footer
                      ? p.footer.map((t, i) => (
                          <span key={i} className={`hf-preview-slot hf-preview-slot-${i}`}>
                            {t}
                          </span>
                        ))
                      : null}
                  </div>
                  <div className="hf-preview-caption">
                    {p.printed === firstPrinted ? 'First script page' : `Page ${p.printed}`}
                  </div>
                </div>
              ))}
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

export default HeaderFooterDialog;
