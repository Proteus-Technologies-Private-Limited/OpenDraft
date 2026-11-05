import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { listBookmarks } from '../utils/bookmarks';
import { goToBookmark } from './bookmarkActions';

interface GoToPageProps {
  editor: Editor | null;
  onGoToPage: (page: number) => void;
}

const GoToPage: React.FC<GoToPageProps> = ({ editor, onGoToPage }) => {
  const { t } = useTranslation(['editor', 'common']);
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

  // Read when the dialog opens; the script cannot change while it is up.
  const bookmarks = useMemo(
    () => (goToPageOpen && editor ? listBookmarks(editor.state.doc) : []),
    [goToPageOpen, editor],
  );

  if (!goToPageOpen) return null;

  return (
    <div className="dialog-overlay" onClick={() => setGoToPageOpen(false)}>
      <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">{bookmarks.length ? t('goToPage.titleWithBookmarks') : t('goToPage.title')}</div>
        <div className="dialog-body">
          <div className="dialog-row">
            <label>{t('goToPage.pageNumber', { max: pageCount })}</label>
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
          {bookmarks.length > 0 && editor && (
            <div className="dialog-row goto-bookmarks">
              <label>{t('goToPage.orBookmark')}</label>
              <ul className="goto-bookmark-list">
                {bookmarks.map((b) => (
                  <li key={b.pos}>
                    <button
                      onClick={() => { setGoToPageOpen(false); goToBookmark(editor, b.pos); }}
                      title={b.text}
                    >
                      <span className="goto-bookmark-name">{b.name}</span>
                      <span className="goto-bookmark-text">{b.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="dialog-actions">
          <button onClick={() => setGoToPageOpen(false)}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={handleGo}>
            {t('goToPage.go')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default GoToPage;
