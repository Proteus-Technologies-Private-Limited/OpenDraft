import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import Heading from '@tiptap/extension-heading';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import BulletList from '@tiptap/extension-bullet-list';
import OrderedList from '@tiptap/extension-ordered-list';
import ListItem from '@tiptap/extension-list-item';
import Blockquote from '@tiptap/extension-blockquote';
import HardBreak from '@tiptap/extension-hard-break';
import History from '@tiptap/extension-history';
import Dropcursor from '@tiptap/extension-dropcursor';
import Gapcursor from '@tiptap/extension-gapcursor';
import Placeholder from '@tiptap/extension-placeholder';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { t as translate } from '../i18n';
import { api } from '../services/api';
import { useGoBackTo } from '../hooks/useGoBack';
import { showToast } from './Toast';
import {
  FaBold, FaItalic, FaUnderline, FaListUl, FaListOl,
  FaQuoteLeft, FaArrowLeft, FaSave,
} from 'react-icons/fa';
import Select from './Select';

/**
 * TreatmentEditor — a simplified TipTap editor for prose treatments.
 * Manuscript-format page layout (serif font, double-spaced, 1-inch margins).
 */
const TreatmentEditor: React.FC = () => {
  const { t } = useTranslation(['story', 'common']);
  const { projectId, scriptId } = useParams<{ projectId: string; scriptId: string }>();
  // Pop back to the project rather than pushing another copy of it, or the
  // project's own back control walks straight back in here (issue #66).
  const handleBack = useGoBackTo(projectId ? `/project/${projectId}` : '/projects');

  const [title, setTitle] = useState('Untitled Treatment');
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingRef = useRef(true);

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      Heading.configure({ levels: [1, 2, 3] }),
      Bold,
      Italic,
      Underline,
      BulletList,
      OrderedList,
      ListItem,
      Blockquote,
      HardBreak,
      History,
      Dropcursor,
      Gapcursor,
      Placeholder.configure({
        // A function so the text follows the interface language (the editor is created once).
        placeholder: () => translate('story:treatment.placeholder'),
      }),
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: {
      attributes: {
        class: 'treatment-content',
      },
    },
  });

  // Load existing treatment content
  useEffect(() => {
    if (!projectId || !scriptId || !editor) return;
    let cancelled = false;
    (async () => {
      try {
        // A treatment in a project folder is an .odraft file there (issue
        // #135); pick up a change made to it elsewhere before showing it.
        try {
          const lf = await import('../services/linkedFiles');
          if (lf.linkingSupported()) {
            const sync = await lf.syncScriptWithFile(projectId, scriptId);
            if (sync.kind === 'loaded-from-file' && !cancelled) {
              showToast(translate('story:treatment.changedOutside', { name: lf.basenameOf(sync.path) }), 'info');
            }
          }
        } catch (err) {
          console.warn('[TreatmentEditor] linked file check failed:', err);
        }
        const resp = await api.getScript(projectId, scriptId);
        if (cancelled) return;
        setTitle(resp.meta.title || 'Untitled Treatment');
        const c = resp.content as { type?: string; content?: unknown[] } | null | undefined;
        if (c && c.type === 'doc' && Array.isArray(c.content) && c.content.length > 0) {
          editor.commands.setContent(c as any);
        }
      } catch (err) {
        console.error('[TreatmentEditor] load failed:', err);
        if (!cancelled) showToast(
          err instanceof Error ? err.message : translate('story:treatment.loadFailed'),
          'error',
        );
      } finally {
        loadingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, scriptId, editor]);

  // Debounced autosave
  const save = useCallback(async (newTitle?: string) => {
    if (!projectId || !scriptId || !editor) return;
    if (loadingRef.current) return;
    setSaving(true);
    setSaveStatus('saving');
    try {
      await api.saveScript(projectId, scriptId, {
        title: newTitle ?? title,
        content: editor.getJSON() as Record<string, unknown>,
      });
      setSaveStatus('saved');
    } catch (err) {
      setSaveStatus('error');
      showToast(err instanceof Error ? err.message : translate('story:treatment.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }, [projectId, scriptId, editor, title]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(), 1200);
  }, [save]);

  // Wire editor changes to autosave
  useEffect(() => {
    if (!editor) return;
    const handler = () => scheduleSave();
    editor.on('update', handler);
    return () => { editor.off('update', handler); };
  }, [editor, scheduleSave]);

  // Keyboard shortcut: Cmd/Ctrl+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save(newTitle), 1200);
  };

  const isActive = (type: string, opts?: Record<string, unknown>) =>
    editor ? editor.isActive(type, opts) : false;

  return (
    <div className="treatment-editor-root">
      <div className="treatment-header">
        <button
          className="treatment-back-btn"
          onClick={handleBack}
          title={t('treatment.backToProject')}
        >
          <FaArrowLeft />
        </button>
        <input
          type="text"
          className="treatment-title-input"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder={t('treatment.titlePlaceholder')}
        />
        <div className="treatment-save-status">
          {saveStatus === 'saving' && t('treatment.saving')}
          {saveStatus === 'saved' && t('treatment.saved')}
          {saveStatus === 'error' && t('treatment.saveFailed')}
        </div>
        <button
          className="treatment-save-btn"
          onClick={() => save()}
          disabled={saving || !editor}
          title={t('treatment.saveTitle')}
        >
          <FaSave /> {t('common:save')}
        </button>
      </div>

      <div className="treatment-toolbar">
        <Select
          className="treatment-element-select"
          value={
            isActive('heading', { level: 1 }) ? 'h1' :
            isActive('heading', { level: 2 }) ? 'h2' :
            isActive('heading', { level: 3 }) ? 'h3' :
            isActive('blockquote') ? 'blockquote' :
            'paragraph'
          }
          disabled={!editor}
          onChange={(e) => {
            if (!editor) return;
            const v = e.target.value;
            const chain = editor.chain().focus();
            if (v === 'paragraph') chain.setParagraph().run();
            else if (v === 'h1') chain.toggleHeading({ level: 1 }).run();
            else if (v === 'h2') chain.toggleHeading({ level: 2 }).run();
            else if (v === 'h3') chain.toggleHeading({ level: 3 }).run();
            else if (v === 'blockquote') chain.toggleBlockquote().run();
          }}
        >
          <option value="paragraph">{t('treatment.style.paragraph')}</option>
          <option value="h1">{t('treatment.style.h1')}</option>
          <option value="h2">{t('treatment.style.h2')}</option>
          <option value="h3">{t('treatment.style.h3')}</option>
          <option value="blockquote">{t('treatment.style.blockquote')}</option>
        </Select>
        <button
          className={`treatment-tool-btn${isActive('bold') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!editor}
          title={t('treatment.tool.bold')}
        ><FaBold /></button>
        <button
          className={`treatment-tool-btn${isActive('italic') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!editor}
          title={t('treatment.tool.italic')}
        ><FaItalic /></button>
        <button
          className={`treatment-tool-btn${isActive('underline') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          disabled={!editor}
          title={t('treatment.tool.underline')}
        ><FaUnderline /></button>
        <div className="treatment-tool-sep" />
        <button
          className={`treatment-tool-btn${isActive('bulletList') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          disabled={!editor}
          title={t('treatment.tool.bulletList')}
        ><FaListUl /></button>
        <button
          className={`treatment-tool-btn${isActive('orderedList') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          disabled={!editor}
          title={t('treatment.tool.numberedList')}
        ><FaListOl /></button>
        <button
          className={`treatment-tool-btn${isActive('blockquote') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          disabled={!editor}
          title={t('treatment.tool.blockQuote')}
        ><FaQuoteLeft /></button>
      </div>

      <div className="treatment-page-container">
        <div className="treatment-page">
          {editor ? (
            <EditorContent editor={editor} />
          ) : (
            <div className="treatment-initializing">{t('treatment.initializing')}</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TreatmentEditor;
