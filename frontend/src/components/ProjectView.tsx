import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '../services/api';
import type { ProjectInfo, ScriptMeta, VersionInfo } from '../services/api';
import { parseFountain } from '../utils/fountainParser';
import { parseFDXFull } from '../utils/fdxParser';
import AssetManager from './AssetManager';
import ProjectPropertiesDialog from './ProjectPropertiesDialog';
import { showToast } from './Toast';

const ITEM_COLORS = [
  '#e06060', '#e89b4f', '#f4d35e', '#6abf69',
  '#4a9eff', '#6fa8dc', '#b58ee0', '#9370DB',
  '#e06c9f', '#d4a373', '#95a5a6', '',
];

type TabKey = 'scripts' | 'assets' | 'versions';
type ScriptSortKey = 'custom' | 'title' | 'created' | 'updated' | 'color' | 'size' | 'pages';

// ── Sortable script row ──────────────────────────────────────────────────

interface SortableScriptRowProps {
  script: ScriptMeta;
  projectId: string;
  sortKey: ScriptSortKey;
  onNavigate: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  formatDate: (iso: string) => string;
  formatSize: (bytes: number) => string;
}

const SortableScriptRow: React.FC<SortableScriptRowProps> = ({
  script,
  sortKey,
  onNavigate,
  onPin,
  onColor,
  onDelete,
  formatDate,
  formatSize,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: script.id, disabled: sortKey !== 'custom' });

  const [showColorPicker, setShowColorPicker] = useState(false);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 100 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`project-script-item${script.pinned ? ' pinned' : ''}`}
    >
      {/* Color indicator */}
      {script.color && (
        <div
          className="script-color-indicator"
          style={{ backgroundColor: script.color }}
        />
      )}

      {/* Drag handle */}
      {sortKey === 'custom' && (
        <div className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
          &#x2630;
        </div>
      )}

      <div className="project-script-info" onClick={() => onNavigate(script.id)}>
        <div className="project-script-title">{script.title}</div>
        <div className="project-script-meta">
          <span>Created {formatDate(script.created_at)}</span>
          <span className="project-card-dot">&middot;</span>
          <span>Modified {formatDate(script.updated_at)}</span>
          {script.page_count > 0 && (
            <>
              <span className="project-card-dot">&middot;</span>
              <span>{script.page_count} pg</span>
            </>
          )}
          <span className="project-card-dot">&middot;</span>
          <span>{formatSize(script.size_bytes)}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="script-item-actions">
        <button
          className={`card-action-btn pin-btn${script.pinned ? ' active' : ''}`}
          onClick={() => onPin(script.id, !script.pinned)}
          title={script.pinned ? 'Unpin' : 'Pin to top'}
        >
          &#x1F4CC;
        </button>
        <button
          className="card-action-btn color-btn"
          onClick={() => setShowColorPicker(!showColorPicker)}
          title="Set color"
        >
          <span
            className="color-dot"
            style={{ backgroundColor: script.color || '#666' }}
          />
        </button>
        <button
          className="project-script-delete"
          onClick={() => onDelete(script.id)}
          title="Delete script"
        >
          &#x2715;
        </button>
      </div>

      {showColorPicker && (
        <div className="color-picker-dropdown" onClick={(e) => e.stopPropagation()}>
          {ITEM_COLORS.map((c) => (
            <button
              key={c || 'none'}
              className={`color-picker-swatch${script.color === c ? ' selected' : ''}`}
              style={{ backgroundColor: c || '#555' }}
              onClick={() => { onColor(script.id, c); setShowColorPicker(false); }}
              title={c || 'No color'}
            >
              {!c && <span className="color-none-x">&#x2715;</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Main component ───────────────────────────────────────────────────────

const ProjectView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [scripts, setScripts] = useState<ScriptMeta[]>([]);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('scripts');
  const [loading, setLoading] = useState(true);

  const [showNewScript, setShowNewScript] = useState(false);
  const [newScriptTitle, setNewScriptTitle] = useState('');
  const [creatingScript, setCreatingScript] = useState(false);
  const [showProperties, setShowProperties] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [scriptSortKey, setScriptSortKey] = useState<ScriptSortKey>(() => {
    return (localStorage.getItem('opendraft:scriptSort') as ScriptSortKey) || 'custom';
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const fetchProject = useCallback(async () => {
    if (!projectId) return;
    try {
      const p = await api.getProject(projectId);
      setProject(p);
    } catch {
      navigate('/');
    }
  }, [projectId, navigate]);

  const fetchScripts = useCallback(async () => {
    if (!projectId) return;
    try {
      const s = await api.listScripts(projectId);
      setScripts(s);
    } catch {
      // silently fail
    }
  }, [projectId]);

  const fetchVersions = useCallback(async () => {
    if (!projectId) return;
    try {
      const v = await api.getVersions(projectId);
      setVersions(Array.isArray(v) ? v : []);
    } catch {
      // silently fail
    }
  }, [projectId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchProject(), fetchScripts(), fetchVersions()]).finally(() =>
      setLoading(false),
    );
  }, [fetchProject, fetchScripts, fetchVersions]);

  useEffect(() => {
    localStorage.setItem('opendraft:scriptSort', scriptSortKey);
  }, [scriptSortKey]);

  // ── Sorting ──

  const sortedScripts = React.useMemo(() => {
    const list = [...scripts];
    const compareFn = (a: ScriptMeta, b: ScriptMeta): number => {
      switch (scriptSortKey) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'created':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'updated':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
        case 'color':
          return (a.color || 'zzz').localeCompare(b.color || 'zzz');
        case 'size':
          return b.size_bytes - a.size_bytes;
        case 'pages':
          return b.page_count - a.page_count;
        case 'custom':
        default:
          return a.sort_order - b.sort_order;
      }
    };
    const pinned = list.filter((s) => s.pinned).sort(compareFn);
    const unpinned = list.filter((s) => !s.pinned).sort(compareFn);
    return [...pinned, ...unpinned];
  }, [scripts, scriptSortKey]);

  // ── Handlers ──

  const handleCreateScript = async () => {
    if (!projectId || !newScriptTitle.trim()) return;
    setCreatingScript(true);
    try {
      const resp = await api.createScript(projectId, {
        title: newScriptTitle.trim(),
      });
      setShowNewScript(false);
      setNewScriptTitle('');
      navigate(`/project/${projectId}/edit/${resp.meta.id}`);
    } catch {
      // silently fail
    }
    setCreatingScript(false);
  };

  const handleDeleteScript = (scriptId: string) => {
    setPendingDeleteId(scriptId);
  };

  const confirmDeleteScript = async () => {
    if (!projectId || !pendingDeleteId) return;
    try {
      await api.deleteScript(projectId, pendingDeleteId);
      await fetchScripts();
    } catch (err) {
      showToast(
        `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
    setPendingDeleteId(null);
  };

  const handlePinScript = useCallback(
    async (id: string, pinned: boolean) => {
      if (!projectId) return;
      setScripts((prev) =>
        prev.map((s) => (s.id === id ? { ...s, pinned } : s)),
      );
      try {
        await api.saveScript(projectId, id, { pinned });
      } catch {
        setScripts((prev) =>
          prev.map((s) => (s.id === id ? { ...s, pinned: !pinned } : s)),
        );
      }
    },
    [projectId],
  );

  const handleColorScript = useCallback(
    async (id: string, color: string) => {
      if (!projectId) return;
      setScripts((prev) =>
        prev.map((s) => (s.id === id ? { ...s, color } : s)),
      );
      try {
        await api.saveScript(projectId, id, { color });
      } catch {
        // silently fail
      }
    },
    [projectId],
  );

  const handleScriptDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!projectId) return;
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = sortedScripts.findIndex((s) => s.id === active.id);
      const newIndex = sortedScripts.findIndex((s) => s.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;

      const reordered = [...sortedScripts];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const updated = reordered.map((s, i) => ({ ...s, sort_order: i }));
      setScripts(updated);

      api
        .reorderScripts(
          projectId,
          updated.map((s) => ({ id: s.id, sort_order: s.sort_order })),
        )
        .catch(() => {});
    },
    [projectId, sortedScripts],
  );

  const handleImportScript = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.fountain,.fdx,.txt';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file || !projectId) return;
      const title = file.name.replace(/\.\w+$/, '') || 'Untitled';
      const reader = new FileReader();
      reader.onload = async () => {
        const text = reader.result as string;
        const ext = file.name.split('.').pop()?.toLowerCase();
        let doc;
        if (ext === 'fdx') {
          const result = parseFDXFull(text);
          doc = result.doc;
        } else {
          doc = parseFountain(text);
        }
        try {
          const resp = await api.createScript(projectId, {
            title,
            content: doc,
          });
          await fetchScripts();
          navigate(`/project/${projectId}/edit/${resp.meta.id}`);
        } catch (err) {
          console.error('Failed to import script:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (iso: string): string => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="project-view">
        <div className="project-view-loading">Loading project...</div>
      </div>
    );
  }

  return (
    <div className="project-view">
      <div className="project-view-header">
        <button
          className="project-back-btn"
          onClick={() => navigate('/projects')}
        >
          &#x2190; Projects
        </button>
        <div>
          <h1 className="project-view-title">
            {project?.name || projectId}
          </h1>
          {project && (
            <div className="project-view-meta">
              <span>
                {scripts.length} script{scripts.length !== 1 ? 's' : ''}
              </span>
              <span className="project-card-dot">&middot;</span>
              <span>Created {formatDate(project.created_at)}</span>
              <span className="project-card-dot">&middot;</span>
              <span>Modified {formatDate(project.updated_at)}</span>
            </div>
          )}
        </div>
        <button
          className="project-action-btn"
          onClick={() => setShowProperties(true)}
        >
          Properties
        </button>
      </div>

      {/* Tabs */}
      <div className="project-view-tabs">
        {(['scripts', 'assets', 'versions'] as TabKey[]).map((tab) => (
          <button
            key={tab}
            className={`project-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="project-view-body">
        {activeTab === 'scripts' && (
          <div className="project-scripts-tab">
            <div className="project-scripts-actions">
              <button
                className="project-action-btn"
                onClick={() => setShowNewScript(true)}
              >
                + New Script
              </button>
              <button
                className="project-action-btn"
                onClick={handleImportScript}
              >
                Import
              </button>
              <select
                className="sort-select"
                value={scriptSortKey}
                onChange={(e) =>
                  setScriptSortKey(e.target.value as ScriptSortKey)
                }
              >
                <option value="custom">Custom Order</option>
                <option value="title">Title</option>
                <option value="created">Created</option>
                <option value="updated">Last Modified</option>
                <option value="color">Color</option>
                <option value="size">Size</option>
                <option value="pages">Pages</option>
              </select>
            </div>
            {scripts.length === 0 ? (
              <div className="project-tab-empty">
                No scripts yet. Create or import one to get started.
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleScriptDragEnd}
              >
                <SortableContext
                  items={sortedScripts.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="project-scripts-list">
                    {sortedScripts.map((script) => (
                      <SortableScriptRow
                        key={script.id}
                        script={script}
                        projectId={projectId!}
                        sortKey={scriptSortKey}
                        onNavigate={(id) =>
                          navigate(`/project/${projectId}/edit/${id}`)
                        }
                        onPin={handlePinScript}
                        onColor={handleColorScript}
                        onDelete={handleDeleteScript}
                        formatDate={formatDate}
                        formatSize={formatSize}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>
        )}

        {activeTab === 'assets' && projectId && (
          <AssetManager projectId={projectId} embedded />
        )}

        {activeTab === 'versions' && (
          <div className="project-versions-tab">
            {versions.length === 0 ? (
              <div className="project-tab-empty">
                No version history available.
              </div>
            ) : (
              <div className="project-versions-list">
                {versions.map((v) => (
                  <div key={v.hash} className="project-version-item">
                    <div className="project-version-message">{v.message}</div>
                    <div className="project-version-time">
                      {formatDate(v.date)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* New Script Dialog */}
      {showNewScript && (
        <div
          className="dialog-overlay"
          onClick={() => setShowNewScript(false)}
        >
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">New Script</div>
            <div className="dialog-body">
              <div className="dialog-row">
                <label>Script Title:</label>
                <input
                  type="text"
                  placeholder="Untitled Screenplay"
                  value={newScriptTitle}
                  onChange={(e) => setNewScriptTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateScript();
                    if (e.key === 'Escape') setShowNewScript(false);
                  }}
                  autoFocus
                />
              </div>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setShowNewScript(false)}>Cancel</button>
              <button
                className="dialog-primary"
                onClick={handleCreateScript}
                disabled={creatingScript || !newScriptTitle.trim()}
              >
                {creatingScript ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {pendingDeleteId && (
        <div
          className="dialog-overlay"
          onClick={() => setPendingDeleteId(null)}
        >
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">Delete Script</div>
            <div className="dialog-body">
              <p>
                Are you sure you want to delete this script? This cannot be
                undone.
              </p>
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPendingDeleteId(null)}>Cancel</button>
              <button
                className="dialog-primary"
                style={{ background: '#c0392b' }}
                onClick={confirmDeleteScript}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Properties Dialog */}
      {showProperties && project && (
        <ProjectPropertiesDialog
          project={project}
          onClose={() => setShowProperties(false)}
          onSaved={(updated) => setProject(updated)}
        />
      )}
    </div>
  );
};

export default ProjectView;
