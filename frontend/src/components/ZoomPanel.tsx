import React, { useState, useRef, useEffect } from 'react';
import { FaSearchPlus, FaSearchMinus, FaTimes } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../stores/editorStore';

const ZoomPanel: React.FC = () => {
  const { t } = useTranslation(['common', 'toolbar']);
  const { zoomLevel, setZoomLevel, zoomPanelOpen, setZoomPanelOpen } = useEditorStore();
  const [inputValue, setInputValue] = useState(String(zoomLevel));
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(String(zoomLevel));
  }, [zoomLevel]);

  useEffect(() => {
    if (!zoomPanelOpen) return;
    const panel = panelRef.current;
    const opener = document.activeElement;
    // Keyboard entry gets initial focus; a tap need not summon a soft keyboard.
    if (opener instanceof HTMLElement && CSS.supports('selector(:focus-visible)') && opener.matches(':focus-visible')) panel?.querySelector('input')?.focus();
    return () => {
      queueMicrotask(() => {
        if (opener instanceof HTMLElement && opener.isConnected &&
          (document.activeElement === document.body || panel?.contains(document.activeElement))) opener.focus({ preventScroll: true });
      });
    };
  }, [zoomPanelOpen]);

  if (!zoomPanelOpen) return null;

  const handleInputCommit = () => {
    const val = parseInt(inputValue, 10);
    if (!isNaN(val) && val >= 50 && val <= 300) {
      setZoomLevel(val);
    } else {
      setInputValue(String(zoomLevel));
    }
  };

  return (
    <div className="zoom-panel" id="zoom-panel" role="group" aria-label={t('toolbar:toolbar.zoom')} ref={panelRef}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setZoomPanelOpen(false); }
      }}>
      <button
        className="zoom-panel-btn"
        aria-label={t('toolbar:toolbar.zoomOut')}
        onClick={() => setZoomLevel(zoomLevel - 10)}
        disabled={zoomLevel <= 50}
      >
        <FaSearchMinus />
      </button>
      <div className="zoom-panel-input-wrap">
        <input
          className="zoom-panel-input"
          aria-label={t('toolbar:toolbar.zoom')}
          type="number"
          min={50}
          max={300}
          step={10}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleInputCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleInputCommit();
          }}
        />
        <span className="zoom-panel-pct">%</span>
      </div>
      <button
        className="zoom-panel-btn"
        aria-label={t('toolbar:toolbar.zoomIn')}
        onClick={() => setZoomLevel(zoomLevel + 10)}
        disabled={zoomLevel >= 300}
      >
        <FaSearchPlus />
      </button>
      <button
        className="zoom-panel-close"
        onClick={() => setZoomPanelOpen(false)}
        title={t('close')}
      >
        <FaTimes />
      </button>
    </div>
  );
};

export default ZoomPanel;
