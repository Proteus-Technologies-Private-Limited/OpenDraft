import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import { cleanBookmarkName, MAX_BOOKMARK_NAME, setBookmark, uniqueBookmarkName } from '../utils/bookmarks';
import { removeBookmark } from './bookmarkActions';

interface BookmarkDialogProps {
  editor: Editor;
  pos: number;
  initialName: string;
  isNew: boolean;
  onClose: () => void;
}

/** Name a new bookmark, or rename or remove an existing one. */
const BookmarkDialog: React.FC<BookmarkDialogProps> = ({ editor, pos, initialName, isNew, onClose }) => {
  const { t } = useTranslation(['dialogs', 'common']);
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const clean = cleanBookmarkName(name);
  const unique = clean ? uniqueBookmarkName(editor.state.doc, clean, pos) : '';
  const clash = clean && unique !== clean;

  const save = () => {
    if (!clean || clash) return;
    const tr = editor.state.tr;
    if (setBookmark(tr, pos, clean) && tr.docChanged) editor.view.dispatch(tr);
    editor.commands.focus();
    onClose();
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bookmark-dialog-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      >
        <div className="dialog-header" id="bookmark-dialog-title">{isNew ? t('bookmark.addTitle') : t('bookmark.renameTitle')}</div>
        <div className="dialog-body">
          <div className="dialog-row">
            <label htmlFor="bookmark-name-input">{t('bookmark.nameLabel')}</label>
            <input
              id="bookmark-name-input"
              ref={inputRef}
              value={name}
              maxLength={MAX_BOOKMARK_NAME}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              autoComplete="off"
            />
          </div>
          {clash && <p className="bookmark-dialog-error" role="alert">{t('bookmark.nameClash', { name: clean })}</p>}
        </div>
        <div className="dialog-actions">
          {!isNew && (
            <button
              className="bookmark-dialog-remove"
              onClick={() => { removeBookmark(editor, pos); editor.commands.focus(); onClose(); }}
            >
              {t('common:remove')}
            </button>
          )}
          <button onClick={onClose}>{t('common:cancel')}</button>
          <button className="dialog-primary" onClick={save} disabled={!clean || !!clash}>
            {isNew ? t('common:add') : t('common:rename')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BookmarkDialog;
