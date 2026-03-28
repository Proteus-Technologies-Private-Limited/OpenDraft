import React, { useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';

interface GoToPageProps {
  onGoToPage: (page: number) => void;
}

const GoToPage: React.FC<GoToPageProps> = ({ onGoToPage }) => {
  const { goToPageOpen, setGoToPageOpen, pageCount } = useEditorStore();
  const [pageNum, setPageNum] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (goToPageOpen && inputRef.current) {
      inputRef.current.focus();
      setPageNum('');
    }
  }, [goToPageOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        setGoToPageOpen(true);
      }
      if (e.key === 'Escape' && goToPageOpen) {
        setGoToPageOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [goToPageOpen, setGoToPageOpen]);

  const handleGo = () => {
    const num = parseInt(pageNum, 10);
    if (num >= 1 && num <= pageCount) {
      onGoToPage(num);
      setGoToPageOpen(false);
    }
  };

  if (!goToPageOpen) return null;

  return (
    <div className="dialog-overlay" onClick={() => setGoToPageOpen(false)}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">Go to Page</div>
        <div className="dialog-body">
          <div className="dialog-row">
            <label>Page number (1-{pageCount}):</label>
            <input
              ref={inputRef}
              type="number"
              min={1}
              max={pageCount}
              value={pageNum}
              onChange={(e) => setPageNum(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleGo();
              }}
            />
          </div>
        </div>
        <div className="dialog-actions">
          <button onClick={() => setGoToPageOpen(false)}>Cancel</button>
          <button className="dialog-primary" onClick={handleGo}>
            Go
          </button>
        </div>
      </div>
    </div>
  );
};

export default GoToPage;
