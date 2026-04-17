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
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api';
import { showToast } from './Toast';
import {
  FaBold, FaItalic, FaUnderline, FaListUl, FaListOl,
  FaQuoteLeft, FaArrowLeft, FaSave,
} from 'react-icons/fa';

/**
 * TreatmentEditor — a simplified TipTap editor for prose treatments.
 * Manuscript-format page layout (serif font, double-spaced, 1-inch margins).
 */
const TreatmentEditor: React.FC = () => {
  const { projectId, scriptId } = useParams<{ projectId: string; scriptId: string }>();
  const navigate = useNavigate();

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
        placeholder: 'Start writing your treatment…',
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
          err instanceof Error ? err.message : 'Failed to load treatment',
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
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
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

  const handleBack = () => {
    if (projectId) navigate(`/project/${projectId}`);
    else navigate('/projects');
  };

  const isActive = (type: string, opts?: Record<string, unknown>) =>
    editor ? editor.isActive(type, opts) : false;

  return (
    <div className="treatment-editor-root">
      <div className="treatment-header">
        <button
          className="treatment-back-btn"
          onClick={handleBack}
          title="Back to project"
        >
          <FaArrowLeft />
        </button>
        <input
          type="text"
          className="treatment-title-input"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Treatment title…"
        />
        <div className="treatment-save-status">
          {saveStatus === 'saving' && 'Saving…'}
          {saveStatus === 'saved' && 'Saved'}
          {saveStatus === 'error' && 'Save failed'}
        </div>
        <button
          className="treatment-save-btn"
          onClick={() => save()}
          disabled={saving || !editor}
          title="Save (⌘S)"
        >
          <FaSave /> Save
        </button>
      </div>

      <div className="treatment-toolbar">
        <select
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
          <option value="paragraph">Paragraph</option>
          <option value="h1">Act / Section</option>
          <option value="h2">Sequence / Beat</option>
          <option value="h3">Sub-heading</option>
          <option value="blockquote">Block Quote</option>
        </select>
        <button
          className={`treatment-tool-btn${isActive('bold') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!editor}
          title="Bold"
        ><FaBold /></button>
        <button
          className={`treatment-tool-btn${isActive('italic') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!editor}
          title="Italic"
        ><FaItalic /></button>
        <button
          className={`treatment-tool-btn${isActive('underline') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          disabled={!editor}
          title="Underline"
        ><FaUnderline /></button>
        <div className="treatment-tool-sep" />
        <button
          className={`treatment-tool-btn${isActive('bulletList') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          disabled={!editor}
          title="Bullet list"
        ><FaListUl /></button>
        <button
          className={`treatment-tool-btn${isActive('orderedList') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          disabled={!editor}
          title="Numbered list"
        ><FaListOl /></button>
        <button
          className={`treatment-tool-btn${isActive('blockquote') ? ' active' : ''}`}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          disabled={!editor}
          title="Block quote"
        ><FaQuoteLeft /></button>
      </div>

      <div className="treatment-page-container">
        <div className="treatment-page">
          {editor ? (
            <EditorContent editor={editor} />
          ) : (
            <div className="treatment-initializing">Initializing editor…</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TreatmentEditor;
