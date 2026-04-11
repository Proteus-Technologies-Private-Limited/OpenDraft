import React, { useState, useEffect, useRef } from 'react';

interface SynopsisModalProps {
  sceneHeading: string;
  synopsis: string;
  onSave: (synopsis: string) => void;
  onClose: () => void;
}

const SynopsisModal: React.FC<SynopsisModalProps> = ({ sceneHeading, synopsis, onSave, onClose }) => {
  const [text, setText] = useState(synopsis);
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
    onSave(text);
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="synopsis-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header synopsis-modal-header">
          <span>Synopsis</span>
          <span className="synopsis-modal-scene">{sceneHeading}</span>
        </div>
        <div className="synopsis-modal-body">
          <textarea
            ref={textareaRef}
            className="synopsis-modal-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a synopsis for this scene..."
          />
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
