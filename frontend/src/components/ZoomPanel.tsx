import React, { useState, useRef, useEffect } from 'react';
import { FaSearchPlus, FaSearchMinus, FaTimes } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';

const ZoomPanel: React.FC = () => {
  const { zoomLevel, setZoomLevel, zoomPanelOpen, setZoomPanelOpen } = useEditorStore();
  const [inputValue, setInputValue] = useState(String(zoomLevel));
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setInputValue(String(zoomLevel));
  }, [zoomLevel]);

  if (!zoomPanelOpen) return null;

  const handleInputCommit = () => {
    const val = parseInt(inputValue, 10);
    if (!isNaN(val) && val >= 50 && val <= 200) {
      setZoomLevel(val);
    } else {
      setInputValue(String(zoomLevel));
    }
  };

  return (
    <div className="zoom-panel" ref={panelRef}>
      <button
        className="zoom-panel-btn"
        onClick={() => setZoomLevel(zoomLevel - 10)}
        disabled={zoomLevel <= 50}
      >
        <FaSearchMinus />
      </button>
      <div className="zoom-panel-input-wrap">
        <input
          className="zoom-panel-input"
          type="number"
          min={50}
          max={200}
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
        onClick={() => setZoomLevel(zoomLevel + 10)}
        disabled={zoomLevel >= 200}
      >
        <FaSearchPlus />
      </button>
      <button
        className="zoom-panel-close"
        onClick={() => setZoomPanelOpen(false)}
        title="Close"
      >
        <FaTimes />
      </button>
    </div>
  );
};

export default ZoomPanel;
