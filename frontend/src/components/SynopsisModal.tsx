import React, { useState, useEffect, useRef } from 'react';

// VIBGYOR + black + white + no color (rainbow order)
const SCENE_COLORS = ['#8b5cf6', '#4f46e5', '#2563eb', '#059669', '#eab308', '#f97316', '#ef4444', '#000000', '#ffffff', ''];

interface SynopsisModalProps {
  sceneHeading: string;
  synopsis: string;
  sceneColor?: string;
  onSave: (synopsis: string, color: string) => void;
  onClose: () => void;
}

const SynopsisModal: React.FC<SynopsisModalProps> = ({ sceneHeading, synopsis, sceneColor, onSave, onClose }) => {
  const [text, setText] = useState(synopsis);
  const [color, setColor] = useState(sceneColor || '');
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
    onSave(text, color);
    onClose();
  };

  return (
    <div className="dialog-overlay synopsis-modal-overlay" onClick={onClose}>
      <div className="synopsis-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header synopsis-modal-header">
          <span>Synopsis</span>
        </div>
        <div className="synopsis-modal-body">
          <div className="synopsis-modal-scene">{sceneHeading}</div>
          <textarea
            ref={textareaRef}
            className="synopsis-modal-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a synopsis for this scene..."
          />
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
