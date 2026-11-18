/**
 * Zoom for either bar: out/in buttons, a slider, or both, with the level,
 * which can be clicked and typed into. The range and step are the store's
 * (setZoomLevel clamps to 50–300%).
 */
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaSearchMinus, FaSearchPlus } from 'react-icons/fa';
import { useEditorFields } from '../../stores/editorStore';
import type { ToolbarLabelMode, ToolbarZoomStyle } from '../../utils/toolbarLayout';

export const ZOOM_MIN = 50;
export const ZOOM_MAX = 300;
export const ZOOM_STEP = 10;

interface Props {
  zoomStyle: ToolbarZoomStyle;
  label: ToolbarLabelMode;
  className?: string;
}

const ZoomControl: React.FC<Props> = ({ zoomStyle, label, className }) => {
  const { t } = useTranslation('toolbar');
  const { zoomLevel, setZoomLevel } = useEditorFields('zoomLevel', 'setZoomLevel');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(zoomLevel));
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  useLayoutEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    wrapRef.current?.querySelector<HTMLButtonElement>('.zoom-label')?.focus();
  }, [editing]);

  const commit = useCallback(() => {
    const value = parseInt(draft, 10);
    if (Number.isFinite(value) && value >= ZOOM_MIN && value <= ZOOM_MAX) setZoomLevel(value);
    setEditing(false);
  }, [draft, setZoomLevel]);

  const showIcon = label !== 'text';
  const showText = label === 'text' || label === 'both';
  const buttons = zoomStyle !== 'slider';
  const slider = zoomStyle !== 'buttons';

  return (
    <div className={`toolbar-group zoom-control${className ? ` ${className}` : ''}`} ref={wrapRef} role="group" aria-label={t('toolbar.zoom')}>
      {buttons && (
        <button
          type="button"
          className="toolbar-btn"
          title={t('toolbar.zoomOut')}
          aria-label={showText ? undefined : t('toolbar.zoomOut')}
          onClick={() => setZoomLevel(zoomLevel - ZOOM_STEP)}
          disabled={zoomLevel <= ZOOM_MIN}
        >
          {showIcon && <FaSearchMinus />}
          {showText && <span className="toolbar-btn-label">{t('layout.labels.zoomOut')}</span>}
        </button>
      )}
      {slider && (
        <input
          type="range"
          className="zoom-slider"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={zoomLevel}
          onChange={(e) => setZoomLevel(Number(e.target.value))}
          aria-label={t('toolbar.zoom')}
          aria-valuetext={`${zoomLevel}%`}
        />
      )}
      {editing ? (
        <input
          ref={inputRef}
          className="zoom-input"
          type="number"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          aria-label={t('toolbar.zoom')}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || (event.key !== 'Enter' && event.key !== 'Escape')) return;
            event.preventDefault();
            returnFocus.current = true;
            if (event.key === 'Enter') commit();
            else setEditing(false);
          }}
          autoFocus
        />
      ) : (
        <button
          type="button"
          aria-label={`${t('toolbar.zoom')}: ${zoomLevel}%`}
          className="zoom-label"
          onClick={() => { setDraft(String(zoomLevel)); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}
          title={t('toolbar.editZoom')}
        >
          {zoomLevel}%
        </button>
      )}
      {buttons && (
        <button
          type="button"
          className="toolbar-btn"
          title={t('toolbar.zoomIn')}
          aria-label={showText ? undefined : t('toolbar.zoomIn')}
          onClick={() => setZoomLevel(zoomLevel + ZOOM_STEP)}
          disabled={zoomLevel >= ZOOM_MAX}
        >
          {showIcon && <FaSearchPlus />}
          {showText && <span className="toolbar-btn-label">{t('layout.labels.zoomIn')}</span>}
        </button>
      )}
    </div>
  );
};

export default ZoomControl;
