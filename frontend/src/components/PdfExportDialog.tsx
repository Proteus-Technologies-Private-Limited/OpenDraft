/**
 * File → Export → PDF: what goes into the file.
 *
 * The exporter always had the flags — title page, scene numbers, watermark —
 * but only the menu and the saved document settings could reach them. This
 * dialog puts the ones a writer asks for at export time in one place, plus the
 * two things the file needs: a range of scenes, and one scene per page.
 */
import React, { useMemo, useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
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
}

interface Props {
  onClose: () => void;
  onExport: (choice: PdfExportChoice) => void;
}

const PdfExportDialog: React.FC<Props> = ({ onClose, onExport }) => {
  const scenes = useEditorStore((s) => s.scenes);
  const includeTitlePageInOutput = useEditorStore((s) => s.includeTitlePageInOutput);
  const sceneNumbersVisible = useEditorStore((s) => s.sceneNumbersVisible);

  const lastIndex = Math.max(0, scenes.length - 1);
  const [mode, setMode] = useState<'range' | 'pick'>('range');
  const [fromIndex, setFromIndex] = useState(0);
  const [toIndex, setToIndex] = useState(lastIndex);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(scenes.map((_, index) => index)));
  const [pickQuery, setPickQuery] = useState('');
  const [includeTitlePage, setIncludeTitlePage] = useState(includeTitlePageInOutput);
  const [pageNumbers, setPageNumbers] = useState(true);
  const [sceneNumbers, setSceneNumbers] = useState(sceneNumbersVisible);
  const [oneScenePerPage, setOneScenePerPage] = useState(false);
  const [watermark, setWatermark] = useState(false);
  const [watermarkText, setWatermarkText] = useState('CONFIDENTIAL');

  const options = useMemo(() => scenes.map((scene, index) => ({
    value: String(index),
    label: `${scene.sceneNumber ?? index + 1}. ${scene.heading}`,
  })), [scenes]);

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
    });
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box pdf-export-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdf-export-title"
      >
        <div className="dialog-header" id="pdf-export-title">Export PDF</div>
        <div className="dialog-body pdf-export-body">
          {scenes.length > 0 ? (
            <div className="pdf-export-section">
              <div className="pdf-export-mode" role="group" aria-label="Which scenes to export">
                <button
                  type="button"
                  className={mode === 'range' ? 'active' : ''}
                  onClick={() => setMode('range')}
                >
                  Range
                </button>
                <button
                  type="button"
                  className={mode === 'pick' ? 'active' : ''}
                  onClick={() => setMode('pick')}
                >
                  Pick scenes
                </button>
              </div>

              {mode === 'range' ? (
                <div className="pdf-export-range">
                  <label>
                    <span>From</span>
                    <Select value={String(fromIndex)} onChange={(e) => changeFrom(e.target.value)}>
                      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                  </label>
                  <label>
                    <span>To</span>
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
                    placeholder="Search scenes…"
                    value={pickQuery}
                    onChange={(e) => setPickQuery(e.target.value)}
                    aria-label="Search scenes"
                  />
                  <div className="pdf-export-pick-actions">
                    <span>
                      {picked.size} of {scenes.length} selected
                      {visibleOptions.length !== scenes.length ? ` \u00b7 ${visibleOptions.length} shown` : ''}
                    </span>
                    <button type="button" onClick={selectVisible} title="Select all shown">All</button>
                    <button type="button" onClick={clearVisible} title="Clear all shown">None</button>
                  </div>
                  <div className="pdf-export-pick-list">
                    {visibleOptions.length === 0 ? (
                      <p className="pdf-export-no-match">No scenes match &ldquo;{pickQuery}&rdquo;.</p>
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
            <p className="pdf-export-empty">No scenes yet. The whole script will be exported.</p>
          )}

          <div className="pdf-export-checks">
            <label className="pdf-export-check">
              <input type="checkbox" checked={includeTitlePage} onChange={(e) => setIncludeTitlePage(e.target.checked)} />
              <span>Title page</span>
            </label>
            <label className="pdf-export-check">
              <input type="checkbox" checked={pageNumbers} onChange={(e) => setPageNumbers(e.target.checked)} />
              <span>Page numbers</span>
            </label>
            <label className="pdf-export-check">
              <input type="checkbox" checked={sceneNumbers} onChange={(e) => setSceneNumbers(e.target.checked)} />
              <span>Scene numbers</span>
            </label>
            <label className="pdf-export-check">
              <input type="checkbox" checked={oneScenePerPage} onChange={(e) => setOneScenePerPage(e.target.checked)} />
              <span>One scene per page</span>
            </label>
            <label className="pdf-export-check">
              <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} />
              <span>Watermark</span>
            </label>
          </div>

          {watermark && (
            <div className="pdf-export-field">
              <span>Watermark text</span>
              <input
                type="text"
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
                placeholder="CONFIDENTIAL"
                autoFocus
              />
            </div>
          )}

          <p className="pdf-export-hint">
            A range exports those scenes; Pick scenes exports any combination.
            Either way the pages start again at 1, and One scene per page starts
            every scene on a fresh sheet.
          </p>
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="dialog-primary" onClick={exportNow} disabled={nothingPicked || (watermark && !watermarkText.trim())}>
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
};

export default PdfExportDialog;
