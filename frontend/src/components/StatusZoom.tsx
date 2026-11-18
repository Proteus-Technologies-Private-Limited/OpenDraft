/**
 * The zoom slider with Fit width (from the #273 status bar), as a control the
 * writer can place on either bar. It sits at the end of the footer by default.
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorFields } from '../stores/editorStore';
import type { ToolbarLabelMode } from '../utils/toolbarLayout';

/** Lowest and highest zoom the store accepts (stores/editorStore setZoomLevel). */
const ZOOM_MIN = 50;
const ZOOM_MAX = 300;
const ZOOM_STEP = 10;
/** Room left either side of the sheet when fitting it to the pane. */
const FIT_GUTTER_PX = 32;

/**
 * Zoom in the status bar, the way a word processor has it: out, a slider, the
 * percentage (click to type one), in, and Fit width.
 *
 * It drives the same `zoomLevel` the toolbar and View menu do, so the three
 * always agree, and the phone view keeps its own zoom as before because the
 * store files the value under the current layout.
 */
function StatusZoom({ editorMain, pageWidthIn, label = 'icon' }: {
  editorMain: HTMLElement | null;
  pageWidthIn: number;
  /** Icon: the − and + signs; text: their names; both: the two together. */
  label?: ToolbarLabelMode;
}) {
  const { t } = useTranslation('toolbar');
  const { zoomLevel, setZoomLevel } = useEditorFields('zoomLevel', 'setZoomLevel');
  const [editing, setEditing] = useState(false);
  // Only read while typing; seeded from the zoom each time editing starts.
  const [draft, setDraft] = useState(String(zoomLevel));

  const commit = useCallback(() => {
    const value = parseInt(draft, 10);
    if (Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX) setZoomLevel(value);
    else setDraft(String(zoomLevel));
    setEditing(false);
  }, [draft, zoomLevel, setZoomLevel]);

  const fitWidth = useCallback(() => {
    // On the toolbar there is no pane handed down; find the one on screen.
    const pane = editorMain ?? document.querySelector<HTMLElement>('.editor-main');
    if (!pane) {
      console.warn('[StatusBar] Fit width: the editor pane is not mounted');
      return;
    }
    const pagePx = pageWidthIn * 96;
    const room = pane.clientWidth - FIT_GUTTER_PX;
    if (!(pagePx > 0) || !(room > 0)) {
      console.warn('[StatusBar] Fit width: nothing to measure', { pagePx, room });
      return;
    }
    setZoomLevel(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.floor((room / pagePx) * 100))));
  }, [editorMain, pageWidthIn, setZoomLevel]);

  return (
    <span className="status-item status-zoom" role="group" aria-label={t('toolbar.zoom')}>
      <button
        type="button"
        className="status-zoom-btn"
        onClick={() => setZoomLevel(zoomLevel - ZOOM_STEP)}
        disabled={zoomLevel <= ZOOM_MIN}
        title={t('toolbar.zoomOut')}
        aria-label={t('toolbar.zoomOut')}
      >{label !== 'text' && '−'}{label !== 'icon' && <span className="toolbar-btn-label">{t('layout.labels.zoomOut')}</span>}</button>
      <input
        type="range"
        className="status-zoom-slider"
        min={ZOOM_MIN}
        max={ZOOM_MAX}
        step={ZOOM_STEP}
        value={zoomLevel}
        onChange={(e) => setZoomLevel(Number(e.target.value))}
        aria-label={t('toolbar.zoom')}
        aria-valuetext={`${zoomLevel}%`}
      />
      <button
        type="button"
        className="status-zoom-btn"
        onClick={() => setZoomLevel(zoomLevel + ZOOM_STEP)}
        disabled={zoomLevel >= ZOOM_MAX}
        title={t('toolbar.zoomIn')}
        aria-label={t('toolbar.zoomIn')}
      >{label !== 'text' && '+'}{label !== 'icon' && <span className="toolbar-btn-label">{t('layout.labels.zoomIn')}</span>}</button>
      {editing ? (
        <input
          className="status-zoom-input"
          value={draft}
          autoFocus
          inputMode="numeric"
          aria-label={t('toolbar.zoom')}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') { setDraft(String(zoomLevel)); setEditing(false); }
          }}
        />
      ) : (
        <button
          type="button"
          className="status-zoom-value"
          onClick={() => { setDraft(String(zoomLevel)); setEditing(true); }}
          title={t('toolbar.editZoom')}
        >{zoomLevel}%</button>
      )}
      <button
        type="button"
        className="status-zoom-fit"
        onClick={fitWidth}
        title={t('status.zoomFitWidthTitle')}
      >{t('status.zoomFitWidth')}</button>
    </span>
  );
}

export default StatusZoom;
