/**
 * File → Export → PDF: what goes into the file.
 *
 * The exporter always had the flags — title page, scene numbers, watermark —
 * but only the menu and the saved document settings could reach them. This
 * dialog puts the ones a writer asks for at export time in one place, plus the
 * two things the file needs: a range of scenes, and one scene per page.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ModalOverlay } from './ModalOverlay';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import Select from './Select';

export interface PdfExportChoice {
  /** "range" exports from → to; "pick" exports exactly `selectedScenes`. */
  mode: 'range' | 'pick';
  /** 0-based scene indices; inclusive. Used in range mode. */
  fromIndex: number;
  toIndex: number;
  /** 0-based scene indices in pick mode. */
  selectedScenes: number[];
  includeTitlePage: boolean;
  pageNumbers: boolean;
  sceneNumbers: boolean;
  oneScenePerPage: boolean;
  watermark: boolean;
  watermarkText: string;
  /** Print text colours and highlights (#226). */
  textColors: boolean;
}

interface Props {
  /**
   * The scene headings of the document being exported, captured from the same
   * JSON the exporter will lay out. A pending suggested heading is not in it,
   * so the numbers here cannot shift against the file.
   */
  scenes: string[];
  onClose: () => void;
  onExport: (choice: PdfExportChoice) => void;
}

const PdfExportDialog: React.FC<Props> = ({ scenes, onClose, onExport }) => {
  const { t } = useTranslation(['tools', 'common']);
  const includeTitlePageInOutput = useEditorStore((s) => s.includeTitlePageInOutput);
  const sceneNumbersVisible = useEditorStore((s) => s.sceneNumbersVisible);

  const lastIndex = Math.max(0, scenes.length - 1);
  const [mode, setMode] = useState<'range' | 'pick'>('range');
  const [fromIndex, setFromIndex] = useState(0);
  const [toIndex, setToIndex] = useState(lastIndex);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(scenes.map((_, index) => index)));
  const [pickQuery, setPickQuery] = useState('');
  const pickListRef = useRef<HTMLDivElement | null>(null);
  const [includeTitlePage, setIncludeTitlePage] = useState(includeTitlePageInOutput);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [sceneNumbers, setSceneNumbers] = useState(sceneNumbersVisible);
  const [oneScenePerPage, setOneScenePerPage] = useState(false);
  const [watermark, setWatermark] = useState(false);
  // i18n-ignore: watermark text is written into the PDF, so it stays as it always was
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL');
  // Opens on the writer's last answer; saved when they export, not on every
  // tick, so a dialog they cancel leaves the remembered choice alone.
  const rememberedTextColors = useSettingsStore((s) => s.pdfTextColors);
  const setPdfTextColors = useSettingsStore((s) => s.setPdfTextColors);
  const [textColors, setTextColors] = useState(rememberedTextColors);

  const options = useMemo(() => scenes.map((heading, index) => ({
    value: String(index),
    label: `${index + 1}. ${heading || t('pdfExport.untitledScene')}`,
  })), [scenes, t]);

  /** The pick list narrowed by the search field. All / None act on what is
   *  shown, so "None" after searching clears only the matches. */
  const visibleOptions = useMemo(() => {
    const query = pickQuery.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.label.toLowerCase().includes(query));
  }, [options, pickQuery]);
  const visibleIndices = useMemo(
    () => visibleOptions.map((option) => Number(option.value)),
    [visibleOptions],
  );

  // A narrowed list starts at its first match. Leaving the old offset would put
  // the first results above the top edge of a long script's list.
  useEffect(() => {
    if (pickListRef.current) pickListRef.current.scrollTop = 0;
  }, [pickQuery]);

  const selectVisible = () => {
    setPicked((current) => new Set([...current, ...visibleIndices]));
  };

  const clearVisible = () => {
    setPicked((current) => {
      const next = new Set(current);
      for (const index of visibleIndices) next.delete(index);
      return next;
    });
  };

  const changeFrom = (value: string) => {
    const next = Number(value);
    setFromIndex(next);
    if (next > toIndex) setToIndex(next);
  };

  const changeTo = (value: string) => {
    const next = Number(value);
    setToIndex(next);
    if (next < fromIndex) setFromIndex(next);
  };

  const togglePick = (index: number) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const nothingPicked = mode === 'pick' && picked.size === 0;

  const exportNow = () => {
    if (textColors !== rememberedTextColors) setPdfTextColors(textColors);
    onExport({
      mode,
      fromIndex,
      toIndex,
      selectedScenes: [...picked].sort((a, b) => a - b),
      includeTitlePage,
      pageNumbers,
      sceneNumbers,
      oneScenePerPage,
      watermark,
      watermarkText,
      textColors,
    });
  };

  return (
    <ModalOverlay className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box pdf-export-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-export-title"
      >
        <div className="dialog-header" id="pdf-export-title">{t('pdfExport.title')}</div>
        <div className="dialog-body pdf-export-body">
          {scenes.length > 0 ? (
            <div className="pdf-export-section">
              <div className="pdf-export-mode" role="group" aria-label={t('pdfExport.whichScenes')}>
                <button
                  type="button"
                  className={mode === 'range' ? 'active' : ''}
                  onClick={() => setMode('range')}
                >
                  {t('pdfExport.range')}
                </button>
                <button
                  type="button"
                  className={mode === 'pick' ? 'active' : ''}
                  onClick={() => setMode('pick')}
                >
                  {t('pdfExport.pickScenes')}
                </button>
              </div>

              {mode === 'range' ? (
                <div className="pdf-export-range">
                  <label>
                    <span>{t('pdfExport.from')}</span>
                    <Select value={String(fromIndex)} onChange={(e) => changeFrom(e.target.value)}>
                      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </label>
                  <label>
                    <span>{t('pdfExport.to')}</span>
                    <Select value={String(toIndex)} onChange={(e) => changeTo(e.target.value)}>
                      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </label>
                </div>
              ) : (
                <div className="pdf-export-picks">
                  <input
                    className="pdf-export-search"
                    type="text"
                    placeholder={t('pdfExport.searchScenesPlaceholder')}
                    value={pickQuery}
                    onChange={(e) => setPickQuery(e.target.value)}
                    aria-label={t('pdfExport.searchScenes')}
                  />
                  <div className="pdf-export-pick-actions">
                    <span>
                      {t('pdfExport.selectedCount', { selected: picked.size, total: scenes.length })}
                      {visibleOptions.length !== scenes.length ? ` \u00b7 ${t('pdfExport.shownCount', { count: visibleOptions.length })}` : ''}
                    </span>
                    <button type="button" onClick={selectVisible} title={t('pdfExport.selectAllShown')}>{t('pdfExport.all')}</button>
                    <button type="button" onClick={clearVisible} title={t('pdfExport.clearAllShown')}>{t('common:none')}</button>
                  </div>
                  <div className="pdf-export-pick-list" ref={pickListRef}>
                    {visibleOptions.length === 0 ? (
                      <p className="pdf-export-no-match">{t('pdfExport.noMatch', { query: pickQuery })}</p>
                    ) : visibleOptions.map((option) => {
                      const index = Number(option.value);
                      return (
                        <label key={option.value} className="pdf-export-check">
                          <input
                            type="checkbox"
                            checked={picked.has(index)}
                            onChange={() => togglePick(index)}
                          />
                          <span>{option.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="pdf-export-empty">{t('pdfExport.noScenes')}</p>
          )}

          <div className="pdf-export-checks">
            <label className="pdf-export-check">
              <input type="checkbox" checked={includeTitlePage} onChange={(e) => setIncludeTitlePage(e.target.checked)} />
              <span>{t('pdfExport.titlePage')}</span>
            </label>
            <label className="pdf-export-check">
              <input type="checkbox" checked={pageNumbers} onChange={(e) => setPageNumbers(e.target.checked)} />
              <span>{t('pdfExport.pageNumbers')}</span>
            </label>
            <label className="pdf-export-check">
              <input type="checkbox" checked={sceneNumbers} onChange={(e) => setSceneNumbers(e.target.checked)} />
              <span>{t('pdfExport.sceneNumbers')}</span>
            </label>
            <label className="pdf-export-check">
              <input type="checkbox" checked={oneScenePerPage} onChange={(e) => setOneScenePerPage(e.target.checked)} />
              <span>{t('pdfExport.oneScenePerPage')}</span>
            </label>
            <label className="pdf-export-check">
              <input type="checkbox" checked={textColors} onChange={(e) => setTextColors(e.target.checked)} />
              <span>{t('pdfExport.textColors')}</span>
            </label>
            <label className="pdf-export-check">
              <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} />
              <span>{t('pdfExport.watermark')}</span>
            </label>
          </div>

          {watermark && (
            <div className="pdf-export-field">
              <span>{t('pdfExport.watermarkText')}</span>
              <input
                type="text"
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
                placeholder="CONFIDENTIAL" /* i18n-ignore: example of text written into the PDF */
                autoFocus
              />
            </div>
          )}

          <p className="pdf-export-hint">
            {t('pdfExport.hint')}
          </p>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={exportNow} disabled={nothingPicked || (watermark && !watermarkText.trim())}>
            {t('pdfExport.export')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default PdfExportDialog;
