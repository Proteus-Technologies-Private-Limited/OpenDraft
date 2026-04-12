import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useDelayedUnmount, useSwipeDismiss } from '../hooks/useTouch';
import {
  useEditorStore,
  ELEMENT_LABELS,
  NOTE_COLORS,
  type NoteColor,
  type ElementType,
  type NoteFilter,
} from '../stores/editorStore';
import { useAssetStore, type Asset } from '../stores/assetStore';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import { isTauri } from '../services/platform';

/** Open a URL in the default browser. Uses Tauri invoke on desktop, window.open on web. */
const openInBrowser = (url: string) => {
  if (isTauri()) {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('open_url', { url }).catch((err: unknown) => console.error('Failed to open URL:', err));
    });
  } else {
    window.open(url, '_blank');
  }
};

interface ScriptNotesProps {
  editor: Editor | null;
  style?: React.CSSProperties;
}

/** Check if a string looks like an image URL */
const isImageUrl = (url: string) =>
  /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(url);

/** Check if a string looks like a video URL */
const isVideoUrl = (url: string) =>
  /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url) ||
  /youtube\.com\/watch|youtu\.be\/|vimeo\.com\//i.test(url);

/** Convert YouTube/Vimeo URL to embeddable URL */
const toEmbedUrl = (url: string): string | null => {
  // YouTube
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
  if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
  // Vimeo
  m = url.match(/vimeo\.com\/(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  return null;
};


/**
 * Render note content with media embeds and @asset references.
 * - URLs on their own line that look like images render as <img>
 * - URLs that look like videos render as <video> or iframe embed
 * - @AssetName references render as clickable asset links
 */
const NoteContentDisplay: React.FC<{
  content: string;
  assets: Asset[];
  projectId: string | null;
}> = ({ content, assets, projectId }) => {
  if (!content) return null;

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Image URL on its own line
    if (isImageUrl(line) && /^https?:\/\//.test(line)) {
      elements.push(
        <div key={i} className="note-media-embed">
          <img src={line} alt="" loading="lazy" />
        </div>,
      );
      continue;
    }

    // Video URL on its own line
    if (isVideoUrl(line) && /^https?:\/\//.test(line)) {
      const embedUrl = toEmbedUrl(line);
      if (embedUrl) {
        if (isTauri()) {
          // In Tauri, YouTube/Vimeo iframes don't work (origin restriction).
          // Show as a clickable link that opens in the default browser.
          elements.push(
            <div key={i} className="note-media-embed note-media-video">
              <a
                href={line}
                target="_blank"
                rel="noreferrer"
                className="note-video-link"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); openInBrowser(line); }}
              >
                {line}
              </a>
            </div>,
          );
        } else {
          elements.push(
            <div key={i} className="note-media-embed note-media-video">
              <iframe src={embedUrl} allowFullScreen title="video" />
            </div>,
          );
        }
      } else {
        elements.push(
          <div key={i} className="note-media-embed">
            <video src={line} controls preload="metadata" />
          </div>,
        );
      }
      continue;
    }

    // Parse @asset references inline
    const parts = line.split(/(@\S+)/g);
    const lineElements: React.ReactNode[] = [];
    for (let j = 0; j < parts.length; j++) {
      const part = parts[j];
      if (part.startsWith('@')) {
        const assetName = part.slice(1);
        const asset = assets.find(
          (a) => a.original_name.toLowerCase() === assetName.toLowerCase() ||
                 a.original_name.replace(/\s+/g, '_').toLowerCase() === assetName.toLowerCase(),
        );
        if (asset) {
          const isImg = asset.mime_type.startsWith('image/');
          const url = projectId
            ? api.getAssetUrl(projectId, asset.id)
            : '#';
          if (isImg) {
            lineElements.push(
              <span key={j} className="note-asset-ref">
                <img src={url} alt={asset.original_name} className="note-asset-thumb" loading="lazy" />
                <span className="note-asset-name">{part}</span>
              </span>,
            );
          } else {
            lineElements.push(
              <a key={j} className="note-asset-ref note-asset-link" href={url} target="_blank" rel="noreferrer">
                {part}
              </a>,
            );
          }
        } else {
          lineElements.push(
            <span key={j} className="note-asset-ref note-asset-unresolved">{part}</span>,
          );
        }
      } else {
        // Detect URLs in plain text and render as clickable links
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const textParts = part.split(urlRegex);
        for (let k = 0; k < textParts.length; k++) {
          const tp = textParts[k];
          if (urlRegex.test(tp)) {
            const handleClick = (e: React.MouseEvent) => {
              e.stopPropagation();
              e.preventDefault();
              openInBrowser(tp);
            };
            lineElements.push(
              <a key={`${j}-${k}`} href={tp} target="_blank" rel="noreferrer" className="note-inline-link" onClick={handleClick}>
                {tp}
              </a>,
            );
          } else if (tp) {
            lineElements.push(<span key={`${j}-${k}`}>{tp}</span>);
          }
          // Reset regex lastIndex since we reuse it
          urlRegex.lastIndex = 0;
        }
      }
    }

    elements.push(
      <div key={i} className="note-content-line">
        {lineElements}
      </div>,
    );
  }

  return <div className="note-content-rendered">{elements}</div>;
};

const ScriptNotes: React.FC<ScriptNotesProps> = ({ editor, style }) => {
  const {
    notes,
    scriptNotesOpen,
    scenes,
    updateNote,
    deleteNote,
    toggleScriptNotes,
    noteFilter,
    setNoteFilter,
    generalNotes,
    addGeneralNote,
    updateGeneralNote,
    deleteGeneralNote,
    notesActiveTab: activeTab,
    setNotesActiveTab: setActiveTab,
  } = useEditorStore();

  const { assets } = useAssetStore();
  const { currentProject } = useProjectStore();
  const projectId = currentProject?.id ?? null;

  // Track which note is being edited (shows textarea), null = preview mode for all
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  // Track which general note is being edited
  const [editingGeneralNoteId, setEditingGeneralNoteId] = useState<string | null>(null);

  // @asset autocomplete state
  const [assetQuery, setAssetQuery] = useState<string | null>(null);
  const [assetSuggestions, setAssetSuggestions] = useState<Asset[]>([]);
  const [assetSugIdx, setAssetSugIdx] = useState(0);
  const textareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());

  // Sync external filter changes (from context menu) to panel
  const [localFilter, setLocalFilter] = useState<NoteFilter>(noteFilter);
  useEffect(() => {
    setLocalFilter(noteFilter);
  }, [noteFilter]);

  // Unique context labels and element types from notes for filter chips
  const filterOptions = useMemo(() => {
    const types = new Set<string>();
    const contexts = new Set<string>();
    for (const n of notes) {
      types.add(n.elementType);
      if (n.contextLabel) contexts.add(n.contextLabel);
    }
    return {
      types: Array.from(types).sort(),
      contexts: Array.from(contexts).sort(),
    };
  }, [notes]);

  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      // If filtering to a specific note by ID, only show that one
      if (localFilter.noteId) return n.id === localFilter.noteId;
      if (localFilter.elementType && n.elementType !== localFilter.elementType) return false;
      if (localFilter.contextLabel && n.contextLabel !== localFilter.contextLabel) return false;
      if (localFilter.color && n.color !== localFilter.color) return false;
      return true;
    });
  }, [notes, localFilter]);

  const isFiltered = localFilter.elementType || localFilter.contextLabel || localFilter.color || localFilter.noteId;

  const getSceneName = useCallback(
    (sceneId: string | null) => {
      if (!sceneId) return null;
      const scene = scenes.find((s) => s.id === sceneId);
      return scene ? scene.heading : null;
    },
    [scenes],
  );

  const getNoteColorHex = (colorName: NoteColor): string => {
    const c = NOTE_COLORS.find((nc) => nc.name === colorName);
    return c ? c.hex : NOTE_COLORS[0].hex;
  };

  const handleClearFilter = useCallback(() => {
    const cleared: NoteFilter = { elementType: null, contextLabel: null, color: null, noteId: null };
    setLocalFilter(cleared);
    setNoteFilter(cleared);
  }, [setNoteFilter]);

  const toggleTypeFilter = useCallback(
    (type: string) => {
      const next: NoteFilter = {
        ...localFilter,
        elementType: localFilter.elementType === type ? null : type,
      };
      setLocalFilter(next);
      setNoteFilter(next);
    },
    [localFilter, setNoteFilter],
  );

  const toggleContextFilter = useCallback(
    (ctx: string) => {
      const next: NoteFilter = {
        ...localFilter,
        contextLabel: localFilter.contextLabel === ctx ? null : ctx,
      };
      setLocalFilter(next);
      setNoteFilter(next);
    },
    [localFilter, setNoteFilter],
  );

  const toggleColorFilter = useCallback(
    (color: NoteColor) => {
      const next: NoteFilter = {
        ...localFilter,
        color: localFilter.color === color ? null : color,
      };
      setLocalFilter(next);
      setNoteFilter(next);
    },
    [localFilter, setNoteFilter],
  );

  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null);
  const [pendingDeleteGeneralNoteId, setPendingDeleteGeneralNoteId] = useState<string | null>(null);

  const handleDeleteRequest = useCallback((id: string) => {
    setPendingDeleteNoteId(id);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    const id = pendingDeleteNoteId;
    if (!id) return;
    setPendingDeleteNoteId(null);
    if (editor) {
      const { doc, schema } = editor.state;
      const markType = schema.marks.scriptNote;
      if (markType) {
        editor.chain().focus().command(({ tr }) => {
          doc.descendants((node, pos) => {
            if (!node.isText) return;
            const mark = node.marks.find(
              (m) => m.type === markType && m.attrs.noteId === id,
            );
            if (mark) {
              tr.removeMark(pos, pos + node.nodeSize, mark);
            }
          });
          return true;
        }).run();
      }
    }
    deleteNote(id);
  }, [editor, deleteNote, pendingDeleteNoteId]);

  const handleColorChange = useCallback(
    (id: string, color: NoteColor) => {
      updateNote(id, { color });
      if (editor) {
        const hex = getNoteColorHex(color);
        const { doc, schema } = editor.state;
        const markType = schema.marks.scriptNote;
        if (markType) {
          editor.chain().command(({ tr }) => {
            doc.descendants((node, pos) => {
              if (!node.isText) return;
              const mark = node.marks.find(
                (m) => m.type === markType && m.attrs.noteId === id,
              );
              if (mark) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
                tr.addMark(pos, pos + node.nodeSize, markType.create({ noteId: id, color: hex }));
              }
            });
            return true;
          }).run();
        }
      }
    },
    [editor, updateNote],
  );

  const handleNavigateToNote = useCallback(
    (noteId: string) => {
      if (!editor) return;
      const { doc, schema } = editor.state;
      const markType = schema.marks.scriptNote;
      if (!markType) return;

      let targetPos: number | null = null;
      doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        if (!node.isText) return;
        const mark = node.marks.find(
          (m) => m.type === markType && m.attrs.noteId === noteId,
        );
        if (mark) {
          targetPos = pos;
          return false;
        }
      });

      if (targetPos !== null) {
        editor.chain().focus().setTextSelection(targetPos).run();
        const coords = editor.view.coordsAtPos(targetPos);
        const editorMain = document.querySelector('.editor-main');
        if (editorMain && coords) {
          const rect = editorMain.getBoundingClientRect();
          const scrollTo = editorMain.scrollTop + (coords.top - rect.top) - rect.height / 3;
          editorMain.scrollTo({ top: scrollTo, behavior: 'smooth' });
        }
      }
    },
    [editor],
  );

  // ── General notes handlers ──
  const handleAddGeneralNote = useCallback(() => {
    const id = addGeneralNote({ title: '', content: '', color: 'Yellow' as NoteColor });
    setEditingGeneralNoteId(id);
  }, [addGeneralNote]);

  const handleDeleteGeneralNoteConfirm = useCallback(() => {
    if (!pendingDeleteGeneralNoteId) return;
    deleteGeneralNote(pendingDeleteGeneralNoteId);
    setPendingDeleteGeneralNoteId(null);
    if (editingGeneralNoteId === pendingDeleteGeneralNoteId) setEditingGeneralNoteId(null);
  }, [deleteGeneralNote, pendingDeleteGeneralNoteId, editingGeneralNoteId]);

  // When external filter opens panel to a specific script note, switch to script tab
  useEffect(() => {
    if (noteFilter.noteId || noteFilter.elementType || noteFilter.contextLabel || noteFilter.color) {
      setActiveTab('script');
    }
  }, [noteFilter]);

  /** Handle @asset autocomplete inside textarea */
  const handleTextareaChange = useCallback(
    (noteId: string, value: string) => {
      updateNote(noteId, { content: value });

      // Check for @mention trigger
      const textarea = textareaRefs.current.get(noteId);
      if (!textarea) return;
      const cursor = textarea.selectionStart;
      const before = value.slice(0, cursor);
      const atMatch = before.match(/@(\S*)$/);
      if (atMatch) {
        const query = atMatch[1].toLowerCase();
        setAssetQuery(query);
        const matches = assets.filter(
          (a) =>
            a.original_name.toLowerCase().includes(query) ||
            a.original_name.replace(/\s+/g, '_').toLowerCase().includes(query),
        ).slice(0, 8);
        setAssetSuggestions(matches);
        setAssetSugIdx(0);
      } else {
        setAssetQuery(null);
        setAssetSuggestions([]);
      }
    },
    [updateNote, assets],
  );

  const insertAssetRef = useCallback(
    (noteId: string, asset: Asset) => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return;
      const textarea = textareaRefs.current.get(noteId);
      if (!textarea) return;

      const cursor = textarea.selectionStart;
      const before = note.content.slice(0, cursor);
      const after = note.content.slice(cursor);
      const atMatch = before.match(/@(\S*)$/);
      if (!atMatch) return;

      const prefix = before.slice(0, before.length - atMatch[0].length);
      const ref = `@${asset.original_name.replace(/\s+/g, '_')}`;
      const newContent = prefix + ref + ' ' + after;
      updateNote(noteId, { content: newContent });

      setAssetQuery(null);
      setAssetSuggestions([]);

      // Restore cursor position after insert
      requestAnimationFrame(() => {
        const pos = prefix.length + ref.length + 1;
        textarea.setSelectionRange(pos, pos);
        textarea.focus();
      });
    },
    [notes, updateNote],
  );

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>, noteId: string) => {
      if (assetSuggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setAssetSugIdx((i) => Math.min(i + 1, assetSuggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setAssetSugIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          insertAssetRef(noteId, assetSuggestions[assetSugIdx]);
        } else if (e.key === 'Escape') {
          setAssetQuery(null);
          setAssetSuggestions([]);
        }
      }
    },
    [assetSuggestions, assetSugIdx, insertAssetRef],
  );

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const { shouldRender, animationState } = useDelayedUnmount(scriptNotesOpen, 250);
  const panelRef = useRef<HTMLDivElement>(null);
  useSwipeDismiss(panelRef, { direction: 'right', onDismiss: toggleScriptNotes, enabled: shouldRender });

  if (!shouldRender) return null;

  const panelClass = animationState === 'entered'
    ? 'panel-open' : animationState === 'exiting' ? 'panel-closing' : '';

  return (
    <div ref={panelRef} className={`script-notes-panel ${panelClass}`} style={style}>
      <div className="script-notes-header">
        <span className="script-notes-title">Notes</span>
        <button className="script-notes-close" onClick={toggleScriptNotes} title="Close">
          &times;
        </button>
      </div>

      {/* ── Tab switcher ── */}
      <div className="sn-tabs">
        <button
          className={`sn-tab${activeTab === 'general' ? ' active' : ''}`}
          onClick={() => setActiveTab('general')}
        >
          General{generalNotes.length > 0 ? ` (${generalNotes.length})` : ''}
        </button>
        <button
          className={`sn-tab${activeTab === 'script' ? ' active' : ''}`}
          onClick={() => setActiveTab('script')}
        >
          Script{notes.length > 0 ? ` (${isFiltered ? `${filteredNotes.length}/` : ''}${notes.length})` : ''}
        </button>
      </div>

      {activeTab === 'script' && <>
      {/* ── Multi-dimensional filter bar ── */}
      <div className="script-notes-filters">
        {/* Active filter summary + clear */}
        {isFiltered && (
          <div className="sn-filter-active">
            {localFilter.noteId && (
              <span className="sn-filter-chip" onClick={handleClearFilter}>
                Selected note
                <span className="sn-chip-x">&times;</span>
              </span>
            )}
            {localFilter.elementType && (
              <span
                className="sn-filter-chip"
                onClick={() => toggleTypeFilter(localFilter.elementType!)}
              >
                {ELEMENT_LABELS[localFilter.elementType as ElementType] || localFilter.elementType}
                <span className="sn-chip-x">&times;</span>
              </span>
            )}
            {localFilter.contextLabel && (
              <span
                className="sn-filter-chip sn-chip-context"
                onClick={() => toggleContextFilter(localFilter.contextLabel!)}
              >
                {localFilter.contextLabel}
                <span className="sn-chip-x">&times;</span>
              </span>
            )}
            {localFilter.color && (
              <span
                className="sn-filter-chip"
                onClick={() => toggleColorFilter(localFilter.color!)}
                style={{ borderColor: getNoteColorHex(localFilter.color) }}
              >
                {localFilter.color}
                <span className="sn-chip-x">&times;</span>
              </span>
            )}
            <button className="sn-filter-clear" onClick={handleClearFilter}>
              Show All
            </button>
          </div>
        )}

        {/* Type filter row */}
        {filterOptions.types.length > 1 && (
          <div className="sn-filter-row">
            <span className="sn-filter-label">Type</span>
            <div className="sn-filter-chips">
              {filterOptions.types.map((t) => (
                <button
                  key={t}
                  className={`sn-chip${localFilter.elementType === t ? ' active' : ''}`}
                  onClick={() => toggleTypeFilter(t)}
                >
                  {ELEMENT_LABELS[t as ElementType] || t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Context filter row */}
        {filterOptions.contexts.length > 0 && (
          <div className="sn-filter-row">
            <span className="sn-filter-label">Context</span>
            <div className="sn-filter-chips">
              {filterOptions.contexts.map((c) => (
                <button
                  key={c}
                  className={`sn-chip sn-chip-ctx${localFilter.contextLabel === c ? ' active' : ''}`}
                  onClick={() => toggleContextFilter(c)}
                >
                  {c.length > 25 ? c.slice(0, 25) + '...' : c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Color filter */}
        <div className="sn-filter-row sn-filter-colors">
          {NOTE_COLORS.map((c) => {
            const count = notes.filter((n) => n.color === c.name).length;
            if (count === 0) return null;
            return (
              <button
                key={c.name}
                className={`sn-color-btn${localFilter.color === c.name ? ' active' : ''}`}
                onClick={() => toggleColorFilter(c.name)}
                title={`${c.name} (${count})`}
                style={{ '--swatch-color': c.hex } as React.CSSProperties}
              >
                <span className="swatch" />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Notes list ── */}
      <div className="script-notes-list">
        {filteredNotes.length === 0 ? (
          <div className="script-notes-empty">
            {notes.length === 0
              ? 'No notes yet. Select text in the editor, right-click, and choose "Add Script Note".'
              : 'No notes match this filter.'}
          </div>
        ) : (
          filteredNotes.map((note) => {
            const hex = getNoteColorHex(note.color);
            const sceneName = getSceneName(note.sceneId);
            const elemLabel = ELEMENT_LABELS[note.elementType as ElementType] || note.elementType;
            const isEditing = editingNoteId === note.id;

            return (
              <div
                key={note.id}
                className="note-item"
                style={{ borderLeftColor: hex }}
              >
                <div className="note-item-header">
                  <div className="note-item-context">
                    <span className="note-item-element">{elemLabel}</span>
                    {note.contextLabel && (
                      <span
                        className="note-item-ctx-label"
                        onClick={() => toggleContextFilter(note.contextLabel)}
                        title={`Filter by "${note.contextLabel}"`}
                      >
                        {note.contextLabel}
                      </span>
                    )}
                    {sceneName && (
                      <span className="note-item-scene">{sceneName}</span>
                    )}
                  </div>
                  <span className="note-item-date">{formatDate(note.createdAt)}</span>
                </div>

                {note.anchorText && (
                  <div
                    className="note-item-anchor"
                    onClick={() => handleNavigateToNote(note.id)}
                    title="Click to navigate to this text"
                  >
                    &ldquo;{note.anchorText}&rdquo;
                  </div>
                )}

                {/* Note content: edit mode or rendered preview */}
                {isEditing ? (
                  <div className="note-edit-area">
                    <textarea
                      ref={(el) => {
                        if (el) textareaRefs.current.set(note.id, el);
                      }}
                      className="note-item-content"
                      value={note.content}
                      onChange={(e) => handleTextareaChange(note.id, e.target.value)}
                      onKeyDown={(e) => handleTextareaKeyDown(e, note.id)}
                      onBlur={() => {
                        // Delay to allow suggestion click
                        setTimeout(() => {
                          setEditingNoteId(null);
                          setAssetQuery(null);
                          setAssetSuggestions([]);
                        }, 200);
                      }}
                      placeholder="Write your note... (use @filename to reference assets, paste media URLs on their own line)"
                      rows={3}
                      autoFocus
                    />
                    {assetSuggestions.length > 0 && assetQuery !== null && (
                      <div className="note-asset-dropdown">
                        {assetSuggestions.map((a, idx) => (
                          <div
                            key={a.id}
                            className={`note-asset-option${idx === assetSugIdx ? ' selected' : ''}`}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              insertAssetRef(note.id, a);
                            }}
                          >
                            <span className="note-asset-option-icon">
                              {a.mime_type.startsWith('image/') ? '🖼' : a.mime_type.startsWith('video/') ? '🎬' : '📎'}
                            </span>
                            <span className="note-asset-option-name">{a.original_name}</span>
                            <span className="note-asset-option-tags">
                              {a.tags.slice(0, 2).join(', ')}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="note-item-preview"
                    onClick={() => setEditingNoteId(note.id)}
                    title="Click to edit"
                  >
                    {note.content ? (
                      <NoteContentDisplay
                        content={note.content}
                        assets={assets}
                        projectId={projectId}
                      />
                    ) : (
                      <span className="note-item-placeholder">Click to add note...</span>
                    )}
                  </div>
                )}

                <div className="note-item-actions">
                  <div className="note-item-colors">
                    {NOTE_COLORS.map((c) => (
                      <button
                        key={c.name}
                        className={`note-color-dot${note.color === c.name ? ' active' : ''}`}
                        style={{ background: c.hex }}
                        onClick={() => handleColorChange(note.id, c.name)}
                        title={c.name}
                      />
                    ))}
                  </div>
                  <button
                    className="note-item-delete"
                    onClick={() => handleDeleteRequest(note.id)}
                    title="Delete note"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      {pendingDeleteNoteId && (
        <div className="dialog-overlay" onClick={() => setPendingDeleteNoteId(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Delete Note</div>
            <div className="dialog-body">
              <p style={{ margin: 0 }}>Delete this note? The highlight will also be removed from the script.</p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingDeleteNoteId(null)}>Cancel</button>
              <button className="dialog-primary" style={{ background: '#c0392b' }} onClick={handleDeleteConfirm}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
      </>}

      {/* ── General Notes tab ── */}
      {activeTab === 'general' && (
        <>
          <div className="general-notes-toolbar">
            <button className="general-notes-add-btn" onClick={handleAddGeneralNote}>+ Add Note</button>
          </div>
          <div className="script-notes-list">
            {generalNotes.length === 0 ? (
              <div className="script-notes-empty">
                No general notes yet. Click &ldquo;+ Add Note&rdquo; to create one.
              </div>
            ) : (
              generalNotes.map((gn) => {
                const hex = getNoteColorHex(gn.color);
                const isEditing = editingGeneralNoteId === gn.id;
                return (
                  <div key={gn.id} className="note-item" style={{ borderLeftColor: hex }}>
                    <div className="note-item-header">
                      <span className="note-item-date">{formatDate(gn.createdAt)}</span>
                    </div>
                    {isEditing ? (
                      <>
                        <input
                          className="general-note-title-input"
                          value={gn.title}
                          onChange={(e) => updateGeneralNote(gn.id, { title: e.target.value })}
                          placeholder="Note title..."
                          autoFocus
                        />
                        <textarea
                          className="note-item-content"
                          value={gn.content}
                          onChange={(e) => updateGeneralNote(gn.id, { content: e.target.value })}
                          onBlur={() => setTimeout(() => setEditingGeneralNoteId(null), 200)}
                          placeholder="Write your note..."
                          rows={4}
                        />
                      </>
                    ) : (
                      <div
                        className="note-item-preview"
                        onClick={() => setEditingGeneralNoteId(gn.id)}
                        title="Click to edit"
                      >
                        {gn.title && <div className="general-note-title">{gn.title}</div>}
                        {gn.content ? (
                          <NoteContentDisplay content={gn.content} assets={assets} projectId={projectId} />
                        ) : (
                          <span className="note-item-placeholder">
                            {gn.title ? '' : 'Click to add note...'}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="note-item-actions">
                      <div className="note-item-colors">
                        {NOTE_COLORS.map((c) => (
                          <button
                            key={c.name}
                            className={`note-color-dot${gn.color === c.name ? ' active' : ''}`}
                            style={{ background: c.hex }}
                            onClick={() => updateGeneralNote(gn.id, { color: c.name })}
                            title={c.name}
                          />
                        ))}
                      </div>
                      <button
                        className="note-item-delete"
                        onClick={() => setPendingDeleteGeneralNoteId(gn.id)}
                        title="Delete note"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {pendingDeleteGeneralNoteId && (
            <div className="dialog-overlay" onClick={() => setPendingDeleteGeneralNoteId(null)}>
              <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">Delete Note</div>
                <div className="dialog-body">
                  <p style={{ margin: 0 }}>Delete this general note?</p>
                </div>
                <div className="dialog-actions">
                  <button onClick={() => setPendingDeleteGeneralNoteId(null)}>Cancel</button>
                  <button className="dialog-primary" style={{ background: '#c0392b' }} onClick={handleDeleteGeneralNoteConfirm}>
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ScriptNotes;
