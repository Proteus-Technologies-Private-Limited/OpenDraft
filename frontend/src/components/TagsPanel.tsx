import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';

interface TagsPanelProps {
  editor: Editor | null;
}

const TagsPanel: React.FC<TagsPanelProps> = ({ editor }) => {
  const {
    tagCategories,
    tags,
    addTag,
    updateTag,
    deleteTag,
    addTagCategory,
    deleteTagCategory,
    tagsVisible,
    setTagsVisible,
    tagsPanelOpen,
    toggleTagsPanel,
    scenes,
    pendingTagSelection,
    setPendingTagSelection,
    editingTagId,
    setEditingTagId,
  } = useEditorStore();

  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedTagId, setExpandedTagId] = useState<string | null>(null);
  const tagItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // When editingTagId is set from context menu, auto-expand the category and tag, then scroll
  const lastEditingTagRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editingTagId || editingTagId === lastEditingTagRef.current) return;
    lastEditingTagRef.current = editingTagId;
    const tag = tags.find((t) => t.id === editingTagId);
    if (!tag) { setEditingTagId(null); return; }

    setExpandedCats((prev) => {
      const next = new Set(prev);
      next.add(tag.categoryId);
      return next;
    });
    setExpandedTagId(editingTagId);
    setEditingTagId(null);

    // Scroll after React re-renders with the expanded state
    setTimeout(() => {
      const el = tagItemRefs.current.get(editingTagId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const textarea = el.querySelector('.tags-item-notes') as HTMLTextAreaElement | null;
        if (textarea) textarea.focus();
      }
    }, 100);
  }, [editingTagId, tags, setEditingTagId]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6fa8dc');

  // Group tags by category
  const tagsByCategory = useMemo(() => {
    const map = new Map<string, typeof tags>();
    for (const cat of tagCategories) {
      const items = tags.filter((t) => t.categoryId === cat.id);
      if (items.length > 0) map.set(cat.id, items);
    }
    return map;
  }, [tags, tagCategories]);


  const getSceneName = useCallback(
    (sceneId: string | null) => {
      if (!sceneId) return null;
      const scene = scenes.find((s) => s.id === sceneId);
      return scene ? scene.heading : null;
    },
    [scenes],
  );

  const toggleCategory = useCallback((catId: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      return next;
    });
  }, []);

  const handleNavigateToTag = useCallback(
    (tagId: string) => {
      if (!editor) return;
      const { doc, schema } = editor.state;
      const markType = schema.marks.productionTag;
      if (!markType) return;

      let targetPos: number | null = null;
      doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        if (!node.isText) return;
        const mark = node.marks.find(
          (m) => m.type === markType && m.attrs.tagId === tagId,
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

  const handleDeleteTag = useCallback(
    (tagId: string) => {
      // Remove mark from editor
      if (editor) {
        const { doc, schema } = editor.state;
        const markType = schema.marks.productionTag;
        if (markType) {
          editor.chain().command(({ tr }) => {
            doc.descendants((node, pos) => {
              if (!node.isText) return;
              const mark = node.marks.find(
                (m) => m.type === markType && m.attrs.tagId === tagId,
              );
              if (mark) {
                tr.removeMark(pos, pos + node.nodeSize, mark);
              }
            });
            return true;
          }).run();
        }
      }
      deleteTag(tagId);
    },
    [editor, deleteTag],
  );

  /** Apply a pending tag selection to a category */
  const handleApplyPendingTag = useCallback(
    (categoryId: string, categoryColor: string) => {
      if (!editor || !pendingTagSelection) return;
      const { from, to, text, elementType, sceneId } = pendingTagSelection;

      const tagId = addTag({ categoryId, text, notes: '', sceneId, elementType });

      editor.chain().focus()
        .setTextSelection({ from, to })
        .setMark('productionTag', { tagId, categoryId, color: categoryColor })
        .run();

      // Auto-expand the category and the new tag's detail
      setExpandedCats((prev) => {
        const next = new Set(prev);
        next.add(categoryId);
        return next;
      });
      setExpandedTagId(tagId);
      setPendingTagSelection(null);
    },
    [editor, pendingTagSelection, addTag, setPendingTagSelection],
  );

  const handleCancelPending = useCallback(() => {
    setPendingTagSelection(null);
  }, [setPendingTagSelection]);

  const handleAddCategory = useCallback(() => {
    if (!newCatName.trim()) return;
    addTagCategory(newCatName.trim(), newCatColor);
    setNewCatName('');
    setNewCatColor('#6fa8dc');
    setShowAddForm(false);
  }, [newCatName, newCatColor, addTagCategory]);

  if (!tagsPanelOpen) return null;

  return (
    <div className="tags-panel">
      <div className="tags-panel-header">
        <span className="tags-panel-title">Production Tags</span>
        <span className="tags-panel-count">{tags.length}</span>
        <button
          className={`tags-visibility-btn${tagsVisible ? ' active' : ''}`}
          onClick={() => setTagsVisible(!tagsVisible)}
          title={tagsVisible ? 'Hide tag highlights' : 'Show tag highlights'}
        >
          {tagsVisible ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3C4.36 3 1.26 5.28 0 8.5c1.26 3.22 4.36 5.5 8 5.5s6.74-2.28 8-5.5C14.74 5.28 11.64 3 8 3zm0 9.17c-1.84 0-3.33-1.49-3.33-3.33S6.16 5.5 8 5.5s3.33 1.49 3.33 3.33S9.84 12.17 8 12.17zm0-5.34a2 2 0 100 4 2 2 0 000-4z"/></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.36 11.35l2.06 2.06-.71.71L.65 0.06l.71-.71 2.68 2.68C5.19 1.38 6.55 1 8 1c3.64 0 6.74 2.28 8 5.5a9.77 9.77 0 01-2.64 3.85zM8 3.5c-1.1 0-2.12.53-2.75 1.4l1.18 1.18A2 2 0 018 4.83a2 2 0 012 2c0 .23-.04.44-.1.65l1.18 1.18c.87-.63 1.4-1.65 1.4-2.75A3.33 3.33 0 008 3.5zm-4.65.82L5.12 6.1a3.33 3.33 0 004.28 4.28l1.25 1.25C9.56 12.22 8.82 12.5 8 12.5c-3.64 0-6.74-2.28-8-5.5a9.77 9.77 0 013.35-3.68z"/></svg>
          )}
        </button>
        <button className="tags-panel-close" onClick={toggleTagsPanel} title="Close">
          &times;
        </button>
      </div>

      {/* Pending tag selection — pick a category */}
      {pendingTagSelection && (
        <div className="tags-pending">
          <div className="tags-pending-header">
            <span>Tag: &ldquo;{pendingTagSelection.text.slice(0, 40)}{pendingTagSelection.text.length > 40 ? '...' : ''}&rdquo;</span>
            <button className="tags-pending-cancel" onClick={handleCancelPending}>&times;</button>
          </div>
          <div className="tags-pending-label">Select a category:</div>
          <div className="tags-pending-list">
            {tagCategories.map((cat) => (
              <div
                key={cat.id}
                className="tags-pending-item"
                onClick={() => handleApplyPendingTag(cat.id, cat.color)}
              >
                <span className="tags-category-swatch" style={{ background: cat.color }} />
                <span>{cat.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="tags-panel-list">
        {tagCategories.length === 0 ? (
          <div className="tags-panel-empty">
            No categories available.
          </div>
        ) : (
          <>
            {/* All categories — show every category, even those with 0 tags */}
            {tagCategories.map((cat) => {
              const items = tagsByCategory.get(cat.id) || [];
              const isExpanded = expandedCats.has(cat.id);
              return (
                <div key={cat.id} className={`tags-category-section${items.length === 0 ? ' tags-cat-empty' : ''}`}>
                  <div
                    className="tags-category-header"
                    onClick={() => items.length > 0 && toggleCategory(cat.id)}
                  >
                    <span className="tags-category-swatch" style={{ background: cat.color }} />
                    <span className="tags-category-name">{cat.name}</span>
                    {items.length > 0 && (
                      <span className="tags-category-count">{items.length}</span>
                    )}
                    {!cat.isBuiltIn && (
                      <button
                        className="tags-item-delete"
                        onClick={(e) => { e.stopPropagation(); deleteTagCategory(cat.id); }}
                        title="Delete custom category"
                      >
                        &times;
                      </button>
                    )}
                    {items.length > 0 && (
                      <span className={`tags-category-chevron${isExpanded ? ' expanded' : ''}`}>&#9662;</span>
                    )}
                  </div>
                  {isExpanded && items.length > 0 && (
                    <div className="tags-category-items">
                      {items.map((tag) => {
                        const sceneName = getSceneName(tag.sceneId);
                        const isTagExpanded = expandedTagId === tag.id;
                        return (
                          <div
                            key={tag.id}
                            className={`tags-item-wrap${expandedTagId === tag.id ? ' tags-item-editing' : ''}`}
                            ref={(el) => { if (el) tagItemRefs.current.set(tag.id, el); }}
                          >
                            <div className="tags-item">
                              <span
                                className="tags-item-text"
                                onClick={() => handleNavigateToTag(tag.id)}
                                title="Click to navigate"
                              >
                                {tag.text}
                              </span>
                              {tag.notes && !isTagExpanded && (
                                <span className="tags-item-has-notes" title="Has notes">*</span>
                              )}
                              {sceneName && (
                                <span className="tags-item-scene">{sceneName}</span>
                              )}
                              <button
                                className="tags-item-expand"
                                onClick={() => setExpandedTagId(isTagExpanded ? null : tag.id)}
                                title={isTagExpanded ? 'Collapse' : 'Details'}
                              >
                                {isTagExpanded ? '▴' : '▾'}
                              </button>
                              <button
                                className="tags-item-delete"
                                onClick={() => handleDeleteTag(tag.id)}
                                title="Remove tag"
                              >
                                &times;
                              </button>
                            </div>
                            {isTagExpanded && (
                              <div className="tags-item-detail">
                                <textarea
                                  className="tags-item-notes"
                                  value={tag.notes}
                                  onChange={(e) => updateTag(tag.id, { notes: e.target.value })}
                                  placeholder="Add details: description, requirements, budget notes..."
                                  rows={3}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

          </>
        )}
      </div>

      {/* Add custom category */}
      {showAddForm ? (
        <div className="tags-add-form">
          <input
            type="text"
            className="tags-add-input"
            placeholder="Category name..."
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
            autoFocus
          />
          <input
            type="color"
            className="tags-add-color"
            value={newCatColor}
            onChange={(e) => setNewCatColor(e.target.value)}
          />
          <button className="tags-add-ok" onClick={handleAddCategory}>Add</button>
          <button className="tags-add-cancel" onClick={() => setShowAddForm(false)}>Cancel</button>
        </div>
      ) : (
        <button className="tags-add-btn" onClick={() => setShowAddForm(true)}>
          + Add Category
        </button>
      )}
    </div>
  );
};

export default TagsPanel;
