import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';

interface TagsPanelProps {
  editor: Editor | null;
}

/** An occurrence of a tag entity found by scanning the document. */
interface TagOccurrence {
  tagId: string;
  text: string;
  from: number;
  to: number;
  sceneId: string | null;
  sceneName: string | null;
  elementType: string;
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
    pendingTagSelection,
    setPendingTagSelection,
    editingTagId,
    setEditingTagId,
  } = useEditorStore();

  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [expandedTagId, setExpandedTagId] = useState<string | null>(null);
  const tagItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Pending-selection step: null → pick category → pick entity or create new
  const [pendingCategoryId, setPendingCategoryId] = useState<string | null>(null);
  const [newEntityName, setNewEntityName] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6fa8dc');

  // ── Scan document for tag occurrences ─────────────────────────────────

  const occurrences = useMemo((): TagOccurrence[] => {
    if (!editor) return [];
    const { doc, schema } = editor.state;
    const markType = schema.marks.productionTag;
    if (!markType) return [];

    const result: TagOccurrence[] = [];

    // Pre-build scene index: for each node offset → which scene it falls in
    const sceneRanges: Array<{ id: string; name: string; from: number }> = [];
    let sceneIdx = 0;
    doc.descendants((node, pos) => {
      if (node.type.name === 'sceneHeading') {
        sceneRanges.push({
          id: `scene-${sceneIdx}`,
          name: node.textContent || 'Untitled Scene',
          from: pos,
        });
        sceneIdx++;
      }
    });

    const getScene = (pos: number) => {
      let scene: { id: string; name: string } | null = null;
      for (const s of sceneRanges) {
        if (s.from <= pos) scene = { id: s.id, name: s.name };
        else break;
      }
      return scene;
    };

    doc.descendants((node, pos) => {
      if (!node.isText) return;
      for (const mark of node.marks) {
        if (mark.type === markType && mark.attrs.tagId) {
          const scene = getScene(pos);
          // Determine element type from parent node
          const resolved = doc.resolve(pos);
          const parentType = resolved.parent.type.name;
          result.push({
            tagId: mark.attrs.tagId as string,
            text: node.textContent,
            from: pos,
            to: pos + node.nodeSize,
            sceneId: scene?.id ?? null,
            sceneName: scene?.name ?? null,
            elementType: parentType,
          });
        }
      }
    });

    return result;
  }, [editor, editor?.state.doc]);

  // Group occurrences by tagId
  const occurrencesByTag = useMemo(() => {
    const map = new Map<string, TagOccurrence[]>();
    for (const occ of occurrences) {
      const list = map.get(occ.tagId);
      if (list) list.push(occ);
      else map.set(occ.tagId, [occ]);
    }
    return map;
  }, [occurrences]);

  // ── Auto-expand when editingTagId is set from context menu ────────────

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

    setTimeout(() => {
      const el = tagItemRefs.current.get(editingTagId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const textarea = el.querySelector('.tags-item-notes') as HTMLTextAreaElement | null;
        if (textarea) textarea.focus();
      }
    }, 100);
  }, [editingTagId, tags, setEditingTagId]);

  // Reset pending category when pending selection changes
  useEffect(() => {
    setPendingCategoryId(null);
    setNewEntityName('');
  }, [pendingTagSelection]);

  // ── Group tags by category ────────────────────────────────────────────

  const tagsByCategory = useMemo(() => {
    const map = new Map<string, typeof tags>();
    for (const cat of tagCategories) {
      const items = tags.filter((t) => t.categoryId === cat.id);
      if (items.length > 0) map.set(cat.id, items);
    }
    return map;
  }, [tags, tagCategories]);


  const toggleCategory = useCallback((catId: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }, []);

  // ── Navigate to a specific occurrence ─────────────────────────────────

  const handleNavigateToOccurrence = useCallback(
    (pos: number) => {
      if (!editor) return;
      editor.chain().focus().setTextSelection(pos).run();
      const coords = editor.view.coordsAtPos(pos);
      const editorMain = document.querySelector('.editor-main');
      if (editorMain && coords) {
        const rect = editorMain.getBoundingClientRect();
        const scrollTo = editorMain.scrollTop + (coords.top - rect.top) - rect.height / 3;
        editorMain.scrollTo({ top: scrollTo, behavior: 'smooth' });
      }
    },
    [editor],
  );

  // Navigate to first occurrence of an entity
  const handleNavigateToTag = useCallback(
    (tagId: string) => {
      const occs = occurrencesByTag.get(tagId);
      if (occs && occs.length > 0) {
        handleNavigateToOccurrence(occs[0].from);
      }
    },
    [occurrencesByTag, handleNavigateToOccurrence],
  );

  // ── Remove a single occurrence (mark) ─────────────────────────────────

  const handleRemoveOccurrence = useCallback(
    (tagId: string, from: number, to: number) => {
      if (!editor) return;
      const { schema } = editor.state;
      const markType = schema.marks.productionTag;
      if (!markType) return;

      editor.chain().command(({ tr }) => {
        // Remove mark in the given range
        tr.doc.nodesBetween(from, to, (node, pos) => {
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

      // If this was the last occurrence, also remove the entity
      const remaining = occurrencesByTag.get(tagId);
      if (!remaining || remaining.length <= 1) {
        deleteTag(tagId);
      }
    },
    [editor, occurrencesByTag, deleteTag],
  );

  // ── Delete an entire entity (all occurrences) ─────────────────────────

  const handleDeleteEntity = useCallback(
    (tagId: string) => {
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

  // ── Pending tag flow: step 1 = pick category, step 2 = pick or create entity ─

  const handlePickCategory = useCallback((catId: string) => {
    setPendingCategoryId(catId);
    setNewEntityName(pendingTagSelection?.text || '');
  }, [pendingTagSelection]);

  /** Apply pending selection to an EXISTING entity */
  const handleAddToExistingEntity = useCallback(
    (entity: typeof tags[0]) => {
      if (!editor || !pendingTagSelection) return;
      const { from, to } = pendingTagSelection;
      const cat = tagCategories.find((c) => c.id === entity.categoryId);
      const color = cat?.color || '#9370DB';

      editor.chain().focus()
        .setTextSelection({ from, to })
        .setMark('productionTag', { tagId: entity.id, categoryId: entity.categoryId, color })
        .run();

      // Expand entity in panel
      setExpandedCats((prev) => {
        const next = new Set(prev);
        next.add(entity.categoryId);
        return next;
      });
      setExpandedTagId(entity.id);
      setPendingTagSelection(null);
      setPendingCategoryId(null);
    },
    [editor, pendingTagSelection, tagCategories, setPendingTagSelection],
  );

  /** Create a NEW entity from pending selection */
  const handleCreateNewEntity = useCallback(
    (categoryId: string) => {
      if (!editor || !pendingTagSelection) return;
      const { from, to, text, elementType, sceneId } = pendingTagSelection;
      const cat = tagCategories.find((c) => c.id === categoryId);
      const color = cat?.color || '#9370DB';
      const entityName = newEntityName.trim() || text;

      const tagId = addTag({ categoryId, text, name: entityName, notes: '', sceneId, elementType });

      editor.chain().focus()
        .setTextSelection({ from, to })
        .setMark('productionTag', { tagId, categoryId, color })
        .run();

      setExpandedCats((prev) => {
        const next = new Set(prev);
        next.add(categoryId);
        return next;
      });
      setExpandedTagId(tagId);
      setPendingTagSelection(null);
      setPendingCategoryId(null);
    },
    [editor, pendingTagSelection, tagCategories, newEntityName, addTag, setPendingTagSelection],
  );

  const handleCancelPending = useCallback(() => {
    setPendingTagSelection(null);
    setPendingCategoryId(null);
  }, [setPendingTagSelection]);

  const handleAddCategory = useCallback(() => {
    if (!newCatName.trim()) return;
    addTagCategory(newCatName.trim(), newCatColor);
    setNewCatName('');
    setNewCatColor('#6fa8dc');
    setShowAddForm(false);
  }, [newCatName, newCatColor, addTagCategory]);

  if (!tagsPanelOpen) return null;

  // Entities in the currently-selected pending category
  const pendingCatEntities = pendingCategoryId
    ? tags.filter((t) => t.categoryId === pendingCategoryId)
    : [];

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

      {/* ── Pending tag selection ──────────────────────────────────────── */}
      {pendingTagSelection && !pendingCategoryId && (
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
                onClick={() => handlePickCategory(cat.id)}
              >
                <span className="tags-category-swatch" style={{ background: cat.color }} />
                <span>{cat.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2: pick existing entity or create new ────────────────── */}
      {pendingTagSelection && pendingCategoryId && (
        <div className="tags-pending">
          <div className="tags-pending-header">
            <span>
              {tagCategories.find((c) => c.id === pendingCategoryId)?.name}
              {' '}&rarr; &ldquo;{pendingTagSelection.text.slice(0, 30)}{pendingTagSelection.text.length > 30 ? '...' : ''}&rdquo;
            </span>
            <button className="tags-pending-cancel" onClick={handleCancelPending}>&times;</button>
          </div>

          {/* Create new entity */}
          <div className="tags-entity-create">
            <div className="tags-pending-label">Create new:</div>
            <div className="tags-entity-create-row">
              <input
                className="tags-entity-name-input"
                type="text"
                value={newEntityName}
                onChange={(e) => setNewEntityName(e.target.value)}
                placeholder="Entity name..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newEntityName.trim()) {
                    handleCreateNewEntity(pendingCategoryId);
                  }
                }}
              />
              <button
                className="tags-entity-create-btn"
                onClick={() => handleCreateNewEntity(pendingCategoryId)}
                disabled={!newEntityName.trim()}
              >
                Create
              </button>
            </div>
          </div>

          {/* Existing entities in this category */}
          {pendingCatEntities.length > 0 && (
            <>
              <div className="tags-pending-label tags-pending-separator">Or add to existing:</div>
              <div className="tags-pending-list">
                {pendingCatEntities.map((entity) => {
                  const occCount = occurrencesByTag.get(entity.id)?.length || 0;
                  return (
                    <div
                      key={entity.id}
                      className="tags-pending-item tags-entity-pick"
                      onClick={() => handleAddToExistingEntity(entity)}
                    >
                      <span className="tags-entity-pick-name">{entity.name}</span>
                      <span className="tags-entity-pick-count">{occCount}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <button
            className="tags-pending-back"
            onClick={() => setPendingCategoryId(null)}
          >
            &larr; Back to categories
          </button>
        </div>
      )}

      {/* ── Main tag list: entities grouped by category ───────────────── */}
      <div className="tags-panel-list">
        {tagCategories.length === 0 ? (
          <div className="tags-panel-empty">No categories available.</div>
        ) : (
          tagCategories.map((cat) => {
            const entities = tagsByCategory.get(cat.id) || [];
            const isExpanded = expandedCats.has(cat.id);
            // Count total occurrences across all entities in this category
            const totalOccs = entities.reduce(
              (sum, e) => sum + (occurrencesByTag.get(e.id)?.length || 0),
              0,
            );
            return (
              <div key={cat.id} className={`tags-category-section${entities.length === 0 ? ' tags-cat-empty' : ''}`}>
                <div
                  className="tags-category-header"
                  onClick={() => entities.length > 0 && toggleCategory(cat.id)}
                >
                  <span className="tags-category-swatch" style={{ background: cat.color }} />
                  <span className="tags-category-name">{cat.name}</span>
                  {entities.length > 0 && (
                    <span className="tags-category-count" title={`${entities.length} entities, ${totalOccs} occurrences`}>
                      {entities.length}
                    </span>
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
                  {entities.length > 0 && (
                    <span className={`tags-category-chevron${isExpanded ? ' expanded' : ''}`}>&#9662;</span>
                  )}
                </div>

                {isExpanded && entities.length > 0 && (
                  <div className="tags-category-items">
                    {entities.map((entity) => {
                      const entityOccs = occurrencesByTag.get(entity.id) || [];
                      const isEntityExpanded = expandedTagId === entity.id;
                      return (
                        <div
                          key={entity.id}
                          className={`tags-item-wrap${isEntityExpanded ? ' tags-item-editing' : ''}`}
                          ref={(el) => { if (el) tagItemRefs.current.set(entity.id, el); }}
                        >
                          {/* Entity header */}
                          <div className="tags-item">
                            <span
                              className="tags-item-text tags-entity-name"
                              onClick={() => handleNavigateToTag(entity.id)}
                              title="Click to navigate to first occurrence"
                            >
                              {entity.name}
                            </span>
                            <span className="tags-entity-occ-count" title={`${entityOccs.length} occurrence${entityOccs.length !== 1 ? 's' : ''}`}>
                              {entityOccs.length}
                            </span>
                            {entity.notes && !isEntityExpanded && (
                              <span className="tags-item-has-notes" title="Has notes">*</span>
                            )}
                            <button
                              className="tags-item-expand"
                              onClick={() => setExpandedTagId(isEntityExpanded ? null : entity.id)}
                              title={isEntityExpanded ? 'Collapse' : 'Details'}
                            >
                              {isEntityExpanded ? '\u25B4' : '\u25BE'}
                            </button>
                            <button
                              className="tags-item-delete"
                              onClick={() => handleDeleteEntity(entity.id)}
                              title="Delete entity and all occurrences"
                            >
                              &times;
                            </button>
                          </div>

                          {/* Expanded detail: name edit, notes, occurrences */}
                          {isEntityExpanded && (
                            <div className="tags-item-detail">
                              <div className="tags-entity-name-row">
                                <label className="tags-detail-label">Name</label>
                                <input
                                  className="tags-entity-name-edit"
                                  type="text"
                                  value={entity.name}
                                  onChange={(e) => updateTag(entity.id, { name: e.target.value })}
                                />
                              </div>
                              <textarea
                                className="tags-item-notes"
                                value={entity.notes}
                                onChange={(e) => updateTag(entity.id, { notes: e.target.value })}
                                placeholder="Add details: description, requirements, budget notes..."
                                rows={3}
                              />
                              {entityOccs.length > 0 && (
                                <div className="tags-occ-list">
                                  <div className="tags-detail-label">Occurrences ({entityOccs.length})</div>
                                  {entityOccs.map((occ, i) => (
                                    <div key={`${occ.from}-${i}`} className="tags-occ-item">
                                      <span
                                        className="tags-occ-text"
                                        onClick={() => handleNavigateToOccurrence(occ.from)}
                                        title="Navigate to this occurrence"
                                      >
                                        &ldquo;{occ.text.slice(0, 40)}{occ.text.length > 40 ? '...' : ''}&rdquo;
                                      </span>
                                      {occ.sceneName && (
                                        <span className="tags-occ-scene">{occ.sceneName.slice(0, 30)}</span>
                                      )}
                                      <button
                                        className="tags-occ-remove"
                                        onClick={() => handleRemoveOccurrence(occ.tagId, occ.from, occ.to)}
                                        title="Remove this occurrence"
                                      >
                                        &times;
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
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
