import React, { useState, useEffect, useRef } from 'react';
import { formatSceneDuration, getTimingColor } from '../utils/scriptTiming';

// VIBGYOR + black + white + no color (rainbow order)
const SCENE_COLORS = ['#8b5cf6', '#4f46e5', '#2563eb', '#059669', '#eab308', '#f97316', '#ef4444', '#000000', '#ffffff', ''];

interface SynopsisModalProps {
  sceneHeading: string;
  synopsis: string;
  sceneColor?: string;
  pageLength?: number;
  autoTimingSeconds?: number;
  timingOverride?: number | null;
  onSave: (synopsis: string, color: string, timingOverride?: number | null) => void;
  onClose: () => void;
}

const SynopsisModal: React.FC<SynopsisModalProps> = ({ sceneHeading, synopsis, sceneColor, pageLength, autoTimingSeconds, timingOverride: initialOverride, onSave, onClose }) => {
  const [text, setText] = useState(synopsis);
  const [color, setColor] = useState(sceneColor || '');
  const [timingMode, setTimingMode] = useState<'auto' | 'manual'>(initialOverride != null ? 'manual' : 'auto');
  const [manualMinutes, setManualMinutes] = useState(() => {
    if (initialOverride != null) return String(Math.floor(initialOverride / 60));
    return '';
  });
  const [manualSeconds, setManualSeconds] = useState(() => {
    if (initialOverride != null) return String(Math.round(initialOverride % 60));
    return '';
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSave = () => {
    let override: number | null = null;
    if (timingMode === 'manual') {
      const m = parseInt(manualMinutes || '0', 10);
      const s = parseInt(manualSeconds || '0', 10);
      if (m > 0 || s > 0) override = m * 60 + s;
    }
    onSave(text, color, override);
    onClose();
  };

  const finalSeconds = timingMode === 'manual'
    ? (parseInt(manualMinutes || '0', 10) * 60 + parseInt(manualSeconds || '0', 10))
    : (autoTimingSeconds || 0);

  return (
    <div className="dialog-overlay synopsis-modal-overlay" onClick={onClose}>
      <div className="synopsis-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header synopsis-modal-header">
          <span>Synopsis</span>
        </div>
        <div className="synopsis-modal-body">
          <div className="synopsis-modal-scene">{sceneHeading}</div>
          {(pageLength != null || autoTimingSeconds != null) && (
            <div className="synopsis-modal-meta">
              {pageLength != null && pageLength > 0 && (
                <span className="synopsis-meta-item">
                  {Number(pageLength.toFixed(1))} {pageLength <= 1 ? 'page' : 'pages'}
                </span>
              )}
              {finalSeconds > 0 && (
                <span className="synopsis-meta-item" style={{ color: getTimingColor(finalSeconds) }}>
                  {formatSceneDuration(finalSeconds)}
                  {timingMode === 'manual' && ' (manual)'}
                </span>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            className="synopsis-modal-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a synopsis for this scene..."
          />
          {/* Timing editor */}
          <div className="synopsis-timing-section">
            <span className="synopsis-color-label">Scene Duration</span>
            <div className="synopsis-timing-controls">
              <label className="synopsis-timing-radio">
                <input type="radio" name="timing" checked={timingMode === 'auto'} onChange={() => setTimingMode('auto')} />
                Auto{autoTimingSeconds ? ` (${formatSceneDuration(autoTimingSeconds)})` : ''}
              </label>
              <label className="synopsis-timing-radio">
                <input type="radio" name="timing" checked={timingMode === 'manual'} onChange={() => {
                  setTimingMode('manual');
                  if (!manualMinutes && !manualSeconds && autoTimingSeconds) {
                    setManualMinutes(String(Math.floor(autoTimingSeconds / 60)));
                    setManualSeconds(String(Math.round(autoTimingSeconds % 60)));
                  }
                }} />
                Manual
              </label>
              {timingMode === 'manual' && (
                <div className="synopsis-timing-inputs">
                  <input
                    type="number"
                    className="synopsis-timing-input"
                    value={manualMinutes}
                    onChange={(e) => setManualMinutes(e.target.value)}
                    placeholder="0"
                    min="0"
                    max="99"
                  />
                  <span className="synopsis-timing-sep">m</span>
                  <input
                    type="number"
                    className="synopsis-timing-input"
                    value={manualSeconds}
                    onChange={(e) => setManualSeconds(e.target.value)}
                    placeholder="0"
                    min="0"
                    max="59"
                  />
                  <span className="synopsis-timing-sep">s</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="synopsis-color-picker">
          <span className="synopsis-color-label">Scene Color</span>
          <div className="synopsis-color-swatches">
            {SCENE_COLORS.map((c) => (
              <button
                key={c || 'none'}
                className={`synopsis-color-swatch${color === c ? ' active' : ''}`}
                style={c ? { background: c } : undefined}
                onClick={() => setColor(c)}
                title={c || 'None'}
              />
            ))}
            <label className="synopsis-color-custom" title="Custom color">
              <input
                type="color"
                value={color || '#000000'}
                onChange={(e) => setColor(e.target.value)}
              />
              <span>+</span>
            </label>
          </div>
        </div>
        <div className="dialog-footer">
          <button className="dialog-btn" onClick={onClose}>Cancel</button>
          <button className="dialog-btn dialog-btn-primary" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
};

export default SynopsisModal;
